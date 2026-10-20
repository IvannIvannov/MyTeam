import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { buildNotificationPayload } from "@/lib/push/templates";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";
import { publishMemberUpdated } from "@/lib/memberEvents";
import {
  addMonths,
  compareYearMonth,
  getFirstUnpaidYM,
  getRollingThirtyDayPaymentWindow,
  normalizeToDayStart,
  normalizeToMonthStart,
  resolveRollingThirtyDayStatus,
  resolveStatusFromSettledMonths,
  toMonthKey,
  toYearMonth,
  type YearMonth,
} from "@/lib/paymentStatus";
import { updatePlayerStatusAfterPayment } from "@/lib/memberPayment";
import { resolveMemberFee, feeConflictMessage } from "@/lib/memberFee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ymToDate(ym: YearMonth): Date {
  return new Date(Date.UTC(ym.year, ym.month, 1));
}

function formatPaidMonthLabel(date: Date): string {
  return date.toLocaleDateString("bg-BG", {
    month: "long",
    year: "numeric",
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { cardCode } = await params;
    const normalizedCardCode = cardCode.trim().toUpperCase();
    const body = await request.json().catch(() => ({}));
    const paidForRaw = (body as { paidFor?: unknown }).paidFor;
    const remainingTrainingsRaw = (body as { remainingTrainings?: unknown }).remainingTrainings;

    if (!paidForRaw) {
      return NextResponse.json({ error: "paidFor is required" }, { status: 400 });
    }

    const parsedPaidFor = new Date(String(paidForRaw));
    if (Number.isNaN(parsedPaidFor.getTime())) {
      return NextResponse.json(
        { error: "paidFor must be a valid date" },
        { status: 400 },
      );
    }

    const card = await prisma.card.findFirst({
      where: {
        cardCode: normalizedCardCode,
        isActive: true,
      },
      select: {
        playerId: true,
        player: {
          select: {
            firstBillingMonth: true,
            paymentAmount: true,
            billingCoachGroupId: true,
            coachGroups: { select: { id: true, name: true, paymentAmount: true } },
            remainingTrainingCredits: true,
            club: {
              select: { paymentWorkflow: true, defaultPaymentAmount: true },
            },
          },
        },
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const playerFirstBillingMonth =
      card.player.firstBillingMonth ?? normalizeToMonthStart(new Date());
    const isRollingThirtyDay = card.player.club.paymentWorkflow === "rolling_30_days";
    const isTrainingCredits = card.player.club.paymentWorkflow === "training_credits";
    const isTrainingCreditsThirtyDay = card.player.club.paymentWorkflow === "training_credits_30_days";

    const [existingLogs, existingWaivers] = await Promise.all([
      prisma.paymentLog.findMany({
        where: { playerId: card.playerId },
        select: { paidFor: true },
        orderBy: { paidFor: "asc" },
      }),
      prisma.paymentWaiver.findMany({
        where: { playerId: card.playerId },
        select: { waivedFor: true },
      }),
    ]);

    let monthsToCreate: Date[] = [];

    let remainingTrainingCreditsUpdate: number | undefined;

    if (isTrainingCredits || isTrainingCreditsThirtyDay) {
      const parsedRemainingTrainings = Number(remainingTrainingsRaw);
      if (!Number.isInteger(parsedRemainingTrainings) || parsedRemainingTrainings < 1 || parsedRemainingTrainings > 999) {
        return NextResponse.json(
          { error: "remainingTrainings must be a whole number greater than 0" },
          { status: 400 },
        );
      }

      const paidForDate = normalizeToDayStart(parsedPaidFor);
      if (isTrainingCreditsThirtyDay) {
        const activeWindow = getRollingThirtyDayPaymentWindow({
          paidDates: existingLogs.map((log) => log.paidFor),
        });
        if (activeWindow && activeWindow.remainingDays > 0 && card.player.remainingTrainingCredits > 0) {
          return NextResponse.json(
            {
              error: `Subscription is still active. Remaining trainings: ${card.player.remainingTrainingCredits}, remaining days: ${activeWindow.remainingDays}.`,
              remainingTrainings: card.player.remainingTrainingCredits,
              remainingDays: activeWindow.remainingDays,
              paidUntil: activeWindow.paidUntil,
            },
            { status: 400 },
          );
        }
      }

      remainingTrainingCreditsUpdate = parsedRemainingTrainings;
      monthsToCreate = [paidForDate];
    } else if (isRollingThirtyDay) {
      const paidForDate = normalizeToDayStart(parsedPaidFor);

      const activeWindow = getRollingThirtyDayPaymentWindow({
        paidDates: existingLogs.map((log) => log.paidFor),
      });
      if (activeWindow && activeWindow.remainingDays > 0) {
        return NextResponse.json(
          {
            error: `Membership is already paid for ${activeWindow.remainingDays} more ${activeWindow.remainingDays === 1 ? "day" : "days"}.`,
            remainingDays: activeWindow.remainingDays,
            paidUntil: activeWindow.paidUntil,
          },
          { status: 400 },
        );
      }

      monthsToCreate = [paidForDate];
    } else {
      const paidForDate = normalizeToMonthStart(parsedPaidFor);
      const firstBillingYM = toYearMonth(playerFirstBillingMonth);
      const targetYM = toYearMonth(paidForDate);

      if (compareYearMonth(targetYM, firstBillingYM) < 0) {
        return NextResponse.json(
          { error: "Cannot record payment before billing start month" },
          { status: 400 },
        );
      }

      const paidSet = new Set(existingLogs.map((log) => toMonthKey(toYearMonth(log.paidFor))));
      const waivedSet = new Set(existingWaivers.map((row) => toMonthKey(toYearMonth(row.waivedFor))));

      const firstUnpaidYM: YearMonth = getFirstUnpaidYM(
        existingLogs.map((log) => log.paidFor),
        existingWaivers.map((row) => row.waivedFor),
        firstBillingYM,
      ) ?? firstBillingYM;

      if (compareYearMonth(targetYM, firstUnpaidYM) < 0) {
        return NextResponse.json(
          { error: "Selected month is before the next unpaid month" },
          { status: 400 },
        );
      }

      let cursor = firstUnpaidYM;
      while (compareYearMonth(cursor, targetYM) <= 0) {
        if (!paidSet.has(toMonthKey(cursor)) && !waivedSet.has(toMonthKey(cursor))) {
          monthsToCreate.push(ymToDate(cursor));
        }
        cursor = addMonths(cursor, 1);
      }
    }

    if (monthsToCreate.length === 0) {
      return NextResponse.json({ error: "This period is already paid" }, { status: 400 });
    }

    const fee = resolveMemberFee(card.player, card.player.club.defaultPaymentAmount);
    if (fee.source === "conflict") return NextResponse.json({ error: feeConflictMessage }, { status: 409 });
    const amount = fee.amount;
    if (amount === null) {
      return NextResponse.json({ error: "Няма конфигурирана сума за плащане." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.paymentLog.createMany({
        data: monthsToCreate.map((date) => ({
          playerId: card.playerId,
          paidFor: date,
          recordedBy: "member",
          amount,
          currency: "EUR",
        })),
      });

      await updatePlayerStatusAfterPayment({
        tx,
        playerId: card.playerId,
        remainingTrainingCredits: remainingTrainingCreditsUpdate,
      });
    });

    const player = await prisma.player.findUnique({
      where: { id: card.playerId },
      select: {
        id: true,
        fullName: true,
        cards: {
          where: { isActive: true },
          select: { cardCode: true },
          take: 1,
        },
      },
    });

    let pushResult = { total: 0, sent: 0, failed: 0, deactivated: 0 };
    if (player) {
      const targetCardCode = player.cards[0]?.cardCode ?? normalizedCardCode;
      const firstPaidDate = monthsToCreate[0];
      const lastPaidDate = monthsToCreate[monthsToCreate.length - 1];
      const trainerMessage =
        monthsToCreate.length > 1
          ? `Благодарим Ви! Вие успешно заплатихте членския си внос за периода ${formatPaidMonthLabel(firstPaidDate)} - ${formatPaidMonthLabel(lastPaidDate)}.`
          : `Благодарим Ви! Вие успешно заплатихте месечния си членски внос за ${formatPaidMonthLabel(firstPaidDate)}.`;
      const payload = buildNotificationPayload({
        type: "trainer_message",
        memberName: player.fullName.trim(),
        trainerMessage,
        url: `/member/${targetCardCode}`,
      });

      try {
        await saveMemberNotificationHistory(player.id, "trainer_message", payload);
        pushResult = await sendPushToMember(player.id, payload);
      } catch (pushError) {
        // Payment should remain successful even if notification delivery fails.
        console.error("Member payment notification error:", pushError);
      }
    }

    const createdPayments = await prisma.paymentLog.findMany({
      where: {
        playerId: card.playerId,
        paidFor: {
          in: monthsToCreate,
        },
      },
      orderBy: { paidFor: "asc" },
      select: {
        id: true,
        paidFor: true,
        paidAt: true,
      },
    });

    publishMemberUpdated(normalizedCardCode, "status-updated");
    publishMemberUpdated(normalizedCardCode, "payment-history-updated");

    return NextResponse.json({
      success: true,
      createdCount: createdPayments.length,
      payments: createdPayments,
      push: pushResult,
    });
  } catch (error) {
    console.error("Member payment creation error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { cardCode } = await params;
    const normalizedCardCode = cardCode.trim().toUpperCase();
    const body = await request.json().catch(() => ({}));
    const paidForValues = Array.isArray((body as { paidFor?: unknown }).paidFor)
      ? (body as { paidFor: unknown[] }).paidFor
      : [];

    const parsedPaidForDates = paidForValues
      .map((value) => new Date(String(value)))
      .filter((date) => !Number.isNaN(date.getTime()));

    const card = await prisma.card.findFirst({
      where: {
        cardCode: normalizedCardCode,
        isActive: true,
      },
      select: {
        playerId: true,
        player: {
          select: {
            id: true,
            fullName: true,
            firstBillingMonth: true,
            club: {
              select: { paymentWorkflow: true },
            },
            cards: {
              where: { isActive: true },
              select: { cardCode: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const isRollingThirtyDay = card.player.club.paymentWorkflow === "rolling_30_days";
    const paidForDates = parsedPaidForDates.map((date) =>
      isRollingThirtyDay ? normalizeToDayStart(date) : normalizeToMonthStart(date),
    );
    const uniqueDates = Array.from(
      new Map(paidForDates.map((date) => [date.toISOString(), date])).values(),
    );

    if (uniqueDates.length === 0) {
      return NextResponse.json(
        { error: isRollingThirtyDay ? "Select at least one valid payment date" : "Select at least one valid paid month" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const logsToDelete = await tx.paymentLog.findMany({
        where: {
          playerId: card.playerId,
          paidFor: {
            in: uniqueDates,
          },
        },
        select: { paidFor: true },
        orderBy: { paidFor: "asc" },
      });

      const deleted = await tx.paymentLog.deleteMany({
        where: {
          playerId: card.playerId,
          paidFor: {
            in: uniqueDates,
          },
        },
      });

      const [remainingLogs, remainingWaivers] = await Promise.all([
        tx.paymentLog.findMany({
          where: { playerId: card.playerId },
          select: { paidFor: true, paidAt: true },
          orderBy: { paidAt: "desc" },
        }),
        tx.paymentWaiver.findMany({
          where: { playerId: card.playerId },
          select: { waivedFor: true },
        }),
      ]);

      const nextStatus = isRollingThirtyDay
        ? resolveRollingThirtyDayStatus({
            paidDates: remainingLogs.map((log) => log.paidFor),
            firstBillingDate: card.player.firstBillingMonth,
          })
        : resolveStatusFromSettledMonths({
            paidDates: remainingLogs.map((log) => log.paidFor),
            waivedDates: remainingWaivers.map((waiver) => waiver.waivedFor),
            firstBillingMonth: toYearMonth(
              card.player.firstBillingMonth ?? normalizeToMonthStart(new Date()),
            ),
          });

      await tx.player.update({
        where: { id: card.playerId },
        data: {
          status: nextStatus,
          lastPaymentDate: remainingLogs[0]?.paidAt ?? null,
        },
      });

      return {
        deletedCount: deleted.count,
        removedMonths: logsToDelete.map((log) => log.paidFor),
        status: nextStatus,
        lastPaymentDate: remainingLogs[0]?.paidAt ?? null,
      };
    });

    let pushResult = { total: 0, sent: 0, failed: 0, deactivated: 0 };
    if (result.deletedCount > 0) {
      const targetCardCode = card.player.cards[0]?.cardCode ?? normalizedCardCode;
      const monthLabels = result.removedMonths.map(formatPaidMonthLabel);
      const removedMonthsText =
        monthLabels.length > 1
          ? `${monthLabels.slice(0, -1).join(", ")} и ${monthLabels[monthLabels.length - 1]}`
          : monthLabels[0] ?? "";
      const trainerMessage =
        monthLabels.length > 1
          ? `Плащанията за месеците ${removedMonthsText} бяха премахнати от вашия профил.`
          : `Плащането за месец ${removedMonthsText} беше премахнато от вашия профил.`;
      const payload = buildNotificationPayload({
        type: "trainer_message",
        memberName: card.player.fullName.trim(),
        trainerMessage,
        url: `/member/${targetCardCode}`,
      });

      try {
        await saveMemberNotificationHistory(card.player.id, "trainer_message", payload);
        pushResult = await sendPushToMember(card.player.id, payload);
      } catch (pushError) {
        // Payment deletion should remain successful even if notification delivery fails.
        console.error("Member payment deletion notification error:", pushError);
      }
    }

    publishMemberUpdated(normalizedCardCode, "status-updated");
    publishMemberUpdated(normalizedCardCode, "payment-history-updated");

    return NextResponse.json({
      success: true,
      ...result,
      push: pushResult,
    });
  } catch (error) {
    console.error("Member payment deletion error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
