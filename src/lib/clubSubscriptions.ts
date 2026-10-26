import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publishAdminNotificationCreated } from "@/lib/adminNotificationEvents";
import type { PushNotificationPayload } from "@/lib/push/types";
import { sendPushToClubAdmins } from "@/lib/push/adminService";
import {
  SubscriptionError, UUID_PATTERN, amountCents, earliestFeeChangeMonth, feeForMonth, isDate, isMonth,
  localToday, money, parseSubscriptionSetup, summarizeSubscription,
  type ClubSubscriptionView, type SubscriptionSetup,
} from "@/lib/clubSubscriptionDomain";

type Transaction = Omit<typeof prisma, "$extends" | "$transaction" | "$connect" | "$disconnect" | "$on" | "$use">;
const subscriptionInclude = {
  fees: { orderBy: { effectiveMonth: "asc" as const } },
  changes: { orderBy: { createdAt: "desc" as const } },
  payments: { orderBy: { createdAt: "desc" as const }, include: { months: { orderBy: { month: "asc" as const } } } },
};

export async function initializeClubSubscription(tx: Transaction, clubId: string, setup: SubscriptionSetup, actorId: string) {
  await tx.clubSubscription.create({ data: {
    clubId, mode: setup.mode,
    trialEndDate: setup.mode === "trial" ? setup.trialEndDate : null,
    firstBillingMonth: setup.mode === "paid" ? setup.firstBillingMonth : null,
    ...(setup.mode === "paid" ? { fees: { create: { effectiveMonth: setup.firstBillingMonth, amount: setup.amount } } } : {}),
    changes: { create: { actorId, action: "setup", details: setup } },
  } });
  if (setup.mode === "contract") return null;
  const notice = setup.mode === "trial"
    ? subscriptionMessage(clubId, "Пробен период за MyTeam", `Активиран е безплатен пробен период ${trialDescription(setup.trialEndDate)}. Промяната не начислява такси автоматично.`)
    : subscriptionMessage(clubId, "Платен абонамент за MyTeam", `Активиран е платен абонамент. Месечна такса: ${setup.amount} EUR. Първи месец за плащане: ${setup.firstBillingMonth}.`);
  await saveSubscriptionNotification(tx, clubId, notice);
  return notice;
}

export async function listClubSubscriptions(): Promise<ClubSubscriptionView[]> {
  const clubs = await prisma.club.findMany({
    orderBy: { name: "asc" }, select: { id: true, name: true, billingStatus: true, platformSubscription: { include: subscriptionInclude } },
  });
  const today = localToday();
  return clubs.map((club) => {
    const stored = club.platformSubscription;
    const subscription = stored ? {
      mode: stored.mode, trialEndDate: stored.trialEndDate, firstBillingMonth: stored.firstBillingMonth, version: stored.version,
      changes: (stored.changes ?? []).map((change) => ({ id: change.id, actorId: change.actorId, action: change.action, details: change.details, createdAt: change.createdAt.toISOString() })),
      fees: stored.fees.map((fee) => ({ effectiveMonth: fee.effectiveMonth, amount: fee.amount.toFixed(2) })),
      payments: stored.payments.map((payment) => ({
        id: payment.id, paidOn: payment.paidOn, note: payment.note, total: payment.total.toFixed(2),
        createdBy: payment.createdBy, createdAt: payment.createdAt.toISOString(),
        voidedAt: payment.voidedAt?.toISOString() ?? null, voidedBy: payment.voidedBy,
        months: payment.months.map((month) => ({ month: month.month, amount: month.amount.toFixed(2) })),
      })),
    } : null;
    return { id: club.id, name: club.name, billingStatus: club.billingStatus, subscription,
      summary: summarizeSubscription(club.billingStatus, subscription, today) };
  });
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new SubscriptionError("Невалиден идентификатор.");
}

function parsePayment(body: Record<string, unknown>) {
  assertUuid(body.paymentId);
  if (!Array.isArray(body.months) || !body.months.length || body.months.length > 120 || !body.months.every(isMonth)) {
    throw new SubscriptionError("Изберете от 1 до 120 валидни месеца.");
  }
  const months = [...new Set(body.months as string[])].sort();
  if (months.length !== body.months.length) throw new SubscriptionError("Повтарящи се месеци.");
  if (!isDate(body.paidOn) || body.paidOn > localToday()) throw new SubscriptionError("Невалидна дата на плащане.");
  if (body.note != null && (typeof body.note !== "string" || body.note.length > 1000)) throw new SubscriptionError("Бележката може да е до 1000 символа.");
  return { paymentId: body.paymentId, months, paidOn: body.paidOn, note: typeof body.note === "string" ? body.note.trim() || null : null,
    total: money(amountCents(body.expectedTotal, 12)) };
}

function subscriptionMessage(clubId: string, title: string, body: string): PushNotificationPayload {
  return { title, body, url: `/admin/members?clubId=${encodeURIComponent(clubId)}` };
}

function trialDescription(endDate: string | null): string {
  return endDate ? `до ${endDate.split("-").reverse().join(".")} включително` : "без крайна дата";
}

export async function changeClubSubscription(clubId: string, body: Record<string, unknown>, actorId: string) {
  assertUuid(clubId);
  const notification = await prisma.$transaction(async (tx): Promise<PushNotificationPayload | null> => {
    // All subscription and activation writers lock this same club row first.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clubs WHERE id = ${clubId}::uuid FOR UPDATE`;
    if (!rows.length) throw new SubscriptionError("Клубът не е намерен.", 404);
    const club = await tx.club.findUniqueOrThrow({ where: { id: clubId }, select: { billingStatus: true } });
    if (club.billingStatus !== "active") throw new SubscriptionError("Първо активирайте таксуването на клуба.", 409);
    const subscription = await tx.clubSubscription.findUnique({ where: { clubId }, include: subscriptionInclude });
    if (!subscription) throw new SubscriptionError("Абонаментът не е настроен.", 409);

    if (subscription.mode === "contract" && body.action !== "contract") throw new SubscriptionError("Таксуването на клуб с договор се управлява извън приложението.", 409);

    const payment = body.action === "payment" ? parsePayment(body) : null;
    if (payment) {
      const previous = await tx.clubSubscriptionPayment.findUnique({ where: { id: payment.paymentId }, include: { months: { orderBy: { month: "asc" } } } });
      if (previous) {
        if (previous.clubId !== clubId || previous.createdBy !== actorId || previous.paidOn !== payment.paidOn || previous.note !== payment.note || previous.total.toFixed(2) !== payment.total || previous.months.map((m) => m.month).join() !== payment.months.join()) {
          throw new SubscriptionError("Идентификаторът на плащането вече е използван.", 409);
        }
        return null; // A retry never records or reopens a payment twice, including after voiding.
      }
    }
    if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== subscription.version) {
      throw new SubscriptionError("Данните са променени. Обновете страницата и опитайте отново.", 409);
    }

    let notice: PushNotificationPayload | null = null;
    let details: Prisma.InputJsonValue;
    switch (body.action) {
      case "contract": {
        if (subscription.mode === "contract") return null;
        details = { previousMode: subscription.mode, previousTrialEndDate: subscription.trialEndDate, previousFirstBillingMonth: subscription.firstBillingMonth };
        await tx.clubSubscription.update({ where: { clubId }, data: { mode: "contract", trialEndDate: null, firstBillingMonth: null } });
        break;
      }
      case "trial": {
        if (subscription.mode !== "trial") throw new SubscriptionError("Платен абонамент не може да се върне към пробен период.");
        const setup = parseSubscriptionSetup({ mode: "trial", trialEndDate: body.trialEndDate });
        if (setup.mode !== "trial") throw new SubscriptionError("Невалиден пробен период.");
        if (setup.trialEndDate === subscription.trialEndDate) return null;
        await tx.clubSubscription.update({ where: { clubId }, data: { trialEndDate: setup.trialEndDate } });
        details = { before: subscription.trialEndDate, after: setup.trialEndDate };
        notice = subscriptionMessage(clubId, "Промяна на пробния период за MyTeam",
          `Безплатният пробен период се променя от „${trialDescription(subscription.trialEndDate)}“ на „${trialDescription(setup.trialEndDate)}“. ` +
          "Промяната не начислява такси автоматично.");
        break;
      }
      case "start_paid": {
        if (subscription.mode !== "trial") throw new SubscriptionError("Клубът вече е с платен абонамент.", 409);
        const setup = parseSubscriptionSetup({ mode: "paid", firstBillingMonth: body.firstBillingMonth, amount: body.amount });
        if (setup.mode !== "paid") throw new SubscriptionError("Невалиден абонамент.");
        await tx.clubSubscription.update({ where: { clubId }, data: { mode: "paid", trialEndDate: null, firstBillingMonth: setup.firstBillingMonth,
          fees: { create: { effectiveMonth: setup.firstBillingMonth, amount: setup.amount } } } });
        details = { previousTrialEndDate: subscription.trialEndDate, ...setup };
        notice = subscriptionMessage(clubId, "Платен абонамент за MyTeam",
          `Безплатният пробен период е заменен с платен абонамент. Месечна такса: ${setup.amount} EUR. Първи месец за плащане: ${setup.firstBillingMonth}.`);
        break;
      }
      case "fee": {
        if (subscription.mode !== "paid" || !isMonth(body.effectiveMonth) || body.effectiveMonth < subscription.firstBillingMonth!) throw new SubscriptionError("Невалиден месец за промяна на таксата.");
        const earliest = earliestFeeChangeMonth(subscription.firstBillingMonth!, subscription.payments);
        if (body.effectiveMonth < earliest) throw new SubscriptionError(`Таксата може да се променя най-рано от ${earliest}, след последния платен месец.`);
        const amount = money(amountCents(body.amount));
        if (amountCents(amount) <= 0) throw new SubscriptionError("Таксата трябва да е по-голяма от нула.");
        const oldAmount = feeForMonth(subscription.fees.map((f) => ({ effectiveMonth: f.effectiveMonth, amount: f.amount.toFixed(2) })), body.effectiveMonth)!;
        if (oldAmount === amount) return null;
        await tx.clubSubscriptionFee.upsert({ where: { clubId_effectiveMonth: { clubId, effectiveMonth: body.effectiveMonth } },
          create: { clubId, effectiveMonth: body.effectiveMonth, amount }, update: { amount } });
        details = { oldAmount, newAmount: amount, effectiveMonth: body.effectiveMonth };
        notice = subscriptionMessage(clubId, "Промяна на абонамента за MyTeam",
          `Месечната такса се променя от ${oldAmount} EUR на ${amount} EUR, считано от ${body.effectiveMonth}.`);
        break;
      }
      case "payment": {
        if (subscription.mode !== "paid" || !payment) throw new SubscriptionError("Плащания се записват само за платени абонаменти.");
        const liveMonths = new Set(subscription.payments.filter((p) => !p.voidedAt).flatMap((p) => p.months.map((m) => m.month)));
        const fees = subscription.fees.map((f) => ({ effectiveMonth: f.effectiveMonth, amount: f.amount.toFixed(2) }));
        const months = payment.months.map((month) => {
          if (month < subscription.firstBillingMonth! || liveMonths.has(month)) throw new SubscriptionError("Месецът е платен или е преди началото на абонамента.", 409);
          return { clubId, month, amount: feeForMonth(fees, month)! };
        });
        const total = money(months.reduce((sum, month) => sum + amountCents(month.amount), 0));
        if (total !== payment.total) throw new SubscriptionError("Сумата е променена. Обновете страницата.", 409);
        await tx.clubSubscriptionPayment.create({ data: { id: payment.paymentId, clubId, paidOn: payment.paidOn, note: payment.note, total, createdBy: actorId, months: { create: months } } });
        details = { ...payment, total };
        notice = subscriptionMessage(clubId, "Платен абонамент за MyTeam — получено плащане",
          `Отбелязано е плащане на ${payment.paidOn.split("-").reverse().join(".")} за абонамента за MyTeam. Сума: ${total} EUR. Платени месеци: ${payment.months.join(", ")}.`);
        break;
      }
      case "void": {
        assertUuid(body.paymentId);
        const previous = subscription.payments.find((p) => p.id === body.paymentId);
        if (!previous) throw new SubscriptionError("Плащането не е намерено.", 404);
        if (previous.voidedAt) return null;
        const voidedAt = new Date();
        await tx.clubSubscriptionPayment.update({ where: { id: previous.id }, data: { voidedAt, voidedBy: actorId, months: { updateMany: { where: {}, data: { voidedAt } } } } });
        details = { paymentId: previous.id, total: previous.total.toFixed(2), months: previous.months.map((m) => m.month) };
        notice = subscriptionMessage(clubId, "Анулирано плащане за MyTeam",
          `Администраторът анулира плащане от ${previous.paidOn.split("-").reverse().join(".")} за ${previous.total.toFixed(2)} EUR. Отново неплатени месеци: ${previous.months.map((m) => m.month).sort().join(", ")}.`);
        break;
      }
      default: throw new SubscriptionError("Невалидно действие.");
    }
    await tx.clubSubscription.update({ where: { clubId }, data: { version: { increment: 1 }, changes: { create: { actorId, action: body.action, details } } } });
    if (notice) {
      // Persist the inbox message atomically, independently of registered push devices.
      // myteam_message appears under the modal's Admin filter and stays in the main club scope.
      await saveSubscriptionNotification(tx, clubId, notice);
    }
    return notice;
  }, { timeout: 15000 });

  return deliverSubscriptionNotification(clubId, notification);
}

export async function saveSubscriptionNotification(tx: Transaction, clubId: string, notice: PushNotificationPayload) {
  await tx.adminNotification.create({ data: {
    clubId, type: "myteam_message", coachGroupId: null, playerId: null,
    title: notice.title, body: notice.body, url: notice.url,
  } });
}

/** Call only after the transaction storing the subscription and message commits. */
export async function deliverSubscriptionNotification(clubId: string, notification: PushNotificationPayload | null) {
  if (!notification) return { ok: true };
  // Publish and deliver only after both the accounting change and inbox message commit.
  try { publishAdminNotificationCreated(clubId); }
  catch (error) { console.error("Club subscription notification event failed:", error); }
  try {
    const result = await sendPushToClubAdmins(clubId, notification, null);
    return { ok: true, notification: result, warning: result.failed ? "Промяната и съобщението са запазени, но част от push известията не са доставени." : undefined };
  } catch (error) {
    console.error("Club subscription push failed:", error);
    return { ok: true, warning: "Промяната и съобщението са запазени, но push известието не е доставено." };
  }
}
