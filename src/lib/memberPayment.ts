import { type PaymentWorkflow } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publishMemberUpdated } from "@/lib/memberEvents";
import {
  addMonths,
  compareYearMonth,
  getFirstUnpaidYM,
  getRollingThirtyDayPaymentWindow,
  normalizeToDayStart,
  normalizeToMonthStart,
  resolvePaymentStatus,
  toMonthKey,
  toYearMonth,
  type YearMonth,
} from "@/lib/paymentStatus";
import { buildNotificationPayload } from "@/lib/push/templates";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";

type PaymentPlayer = {
  id: string;
  fullName: string;
  firstBillingMonth: Date | null;
  remainingTrainingCredits: number;
  club: {
    paymentWorkflow: PaymentWorkflow;
  };
  cards?: Array<{ cardCode: string }>;
};

export type ResolvedMemberPayment = {
  playerId: string;
  paidDates: Date[];
  paidFor: Date;
  paidThrough: Date | null;
  trainingCredits: number | null;
  workflow: PaymentWorkflow;
};

type MemberPaymentTx = Pick<typeof prisma, "player" | "paymentLog" | "paymentWaiver">;

export async function updatePlayerStatusAfterPayment(input: {
  tx: MemberPaymentTx;
  playerId: string;
  remainingTrainingCredits?: number | null;
  paymentRecordedAt?: Date;
}) {
  const player = await input.tx.player.findUnique({
    where: { id: input.playerId },
    select: {
      firstBillingMonth: true,
      remainingTrainingCredits: true,
      club: { select: { paymentWorkflow: true } },
      paymentLogs: { select: { paidFor: true } },
      paymentWaivers: { select: { waivedFor: true } },
    },
  });

  if (!player) {
    throw new Error("Player not found");
  }

  const remainingTrainingCredits =
    input.remainingTrainingCredits ?? player.remainingTrainingCredits;
  const status = resolvePaymentStatus({
    workflow: player.club.paymentWorkflow,
    paidDates: player.paymentLogs.map((log) => log.paidFor),
    waivedDates: player.paymentWaivers.map((waiver) => waiver.waivedFor),
    remainingTrainingCredits,
    firstBillingMonth: player.firstBillingMonth
      ? toYearMonth(player.firstBillingMonth)
      : null,
    firstBillingDate: player.firstBillingMonth,
  });

  await input.tx.player.update({
    where: { id: input.playerId },
    data: {
      status,
      lastPaymentDate: input.paymentRecordedAt ?? new Date(),
      ...(input.remainingTrainingCredits !== null &&
      input.remainingTrainingCredits !== undefined
        ? { remainingTrainingCredits: input.remainingTrainingCredits }
        : {}),
    },
  });

  return status;
}

function ymToDate(ym: YearMonth): Date {
  return new Date(Date.UTC(ym.year, ym.month, 1));
}

function formatPaidMonthLabel(date: Date): string {
  return date.toLocaleDateString("bg-BG", {
    month: "long",
    year: "numeric",
  });
}

function isTrainingCreditWorkflow(workflow: PaymentWorkflow): boolean {
  return workflow === "training_credits" || workflow === "training_credits_30_days";
}

function getPaymentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid payment";
}

export async function resolveMemberPaymentIntent(input: {
  player: PaymentPlayer;
  paidFor: Date;
  remainingTrainings?: number | null;
}): Promise<ResolvedMemberPayment> {
  const workflow = input.player.club.paymentWorkflow;
  const isRollingThirtyDay = workflow === "rolling_30_days";
  const isTrainingCredits = workflow === "training_credits";
  const isTrainingCreditsThirtyDay = workflow === "training_credits_30_days";

  const [existingLogs, existingWaivers] = await Promise.all([
    prisma.paymentLog.findMany({
      where: { playerId: input.player.id },
      select: { paidFor: true },
      orderBy: { paidFor: "asc" },
    }),
    prisma.paymentWaiver.findMany({
      where: { playerId: input.player.id },
      select: { waivedFor: true },
    }),
  ]);

  let paidDates: Date[] = [];
  let trainingCredits: number | null = null;

  if (isTrainingCredits || isTrainingCreditsThirtyDay) {
    const parsedRemainingTrainings = Number(input.remainingTrainings);
    if (!Number.isInteger(parsedRemainingTrainings) || parsedRemainingTrainings < 1 || parsedRemainingTrainings > 999) {
      throw new Error("remainingTrainings must be a whole number greater than 0");
    }

    const paidForDate = normalizeToDayStart(input.paidFor);
    if (isTrainingCreditsThirtyDay) {
      const activeWindow = getRollingThirtyDayPaymentWindow({
        paidDates: existingLogs.map((log) => log.paidFor),
      });
      if (activeWindow && activeWindow.remainingDays > 0 && input.player.remainingTrainingCredits > 0) {
        throw new Error(
          `Subscription is still active. Remaining trainings: ${input.player.remainingTrainingCredits}, remaining days: ${activeWindow.remainingDays}.`,
        );
      }
    }

    paidDates = [paidForDate];
    trainingCredits = parsedRemainingTrainings;
  } else if (isRollingThirtyDay) {
    const paidForDate = normalizeToDayStart(input.paidFor);
    const activeWindow = getRollingThirtyDayPaymentWindow({
      paidDates: existingLogs.map((log) => log.paidFor),
    });
    if (activeWindow && activeWindow.remainingDays > 0) {
      throw new Error(
        `Membership is already paid for ${activeWindow.remainingDays} more ${activeWindow.remainingDays === 1 ? "day" : "days"}.`,
      );
    }

    paidDates = [paidForDate];
  } else {
    const paidForDate = normalizeToMonthStart(input.paidFor);
    const playerFirstBillingMonth = input.player.firstBillingMonth ?? normalizeToMonthStart(new Date());
    const firstBillingYM = toYearMonth(playerFirstBillingMonth);
    const targetYM = toYearMonth(paidForDate);

    if (compareYearMonth(targetYM, firstBillingYM) < 0) {
      throw new Error("Cannot record payment before billing start month");
    }

    const paidSet = new Set(existingLogs.map((log) => toMonthKey(toYearMonth(log.paidFor))));
    const waivedSet = new Set(existingWaivers.map((row) => toMonthKey(toYearMonth(row.waivedFor))));
    const firstUnpaidYM = getFirstUnpaidYM(
      existingLogs.map((log) => log.paidFor),
      existingWaivers.map((row) => row.waivedFor),
      firstBillingYM,
    ) ?? firstBillingYM;

    if (compareYearMonth(targetYM, firstUnpaidYM) < 0) {
      throw new Error("Selected month is before the next unpaid month");
    }

    let cursor = firstUnpaidYM;
    while (compareYearMonth(cursor, targetYM) <= 0) {
      if (!paidSet.has(toMonthKey(cursor)) && !waivedSet.has(toMonthKey(cursor))) {
        paidDates.push(ymToDate(cursor));
      }
      cursor = addMonths(cursor, 1);
    }
  }

  if (paidDates.length === 0) {
    throw new Error("This period is already paid");
  }

  return {
    playerId: input.player.id,
    paidDates,
    paidFor: paidDates[0],
    paidThrough: paidDates.length > 1 ? paidDates[paidDates.length - 1] : null,
    trainingCredits,
    workflow,
  };
}

export async function finalizeResolvedMemberPayment(input: {
  tx: MemberPaymentTx;
  playerId: string;
  paidDates: Date[];
  recordedBy: string;
  amountPerPeriod: string;
  currency: string;
  trainingCredits?: number | null;
}): Promise<{ paymentLogIds: string[] }> {
  const player = await input.tx.player.findUnique({
    where: { id: input.playerId },
    select: {
      remainingTrainingCredits: true,
      club: { select: { paymentWorkflow: true } },
    },
  });

  if (!player) {
    throw new Error("Player not found");
  }

  const workflow = player.club.paymentWorkflow;
  const isTrainingCredits = isTrainingCreditWorkflow(workflow);
  const isRollingThirtyDay = workflow === "rolling_30_days";

  if (isTrainingCredits) {
    const trainingCredits = Number(input.trainingCredits);
    if (!Number.isInteger(trainingCredits) || trainingCredits < 1 || trainingCredits > 999) {
      throw new Error("remainingTrainings must be a whole number greater than 0");
    }

    if (workflow === "training_credits_30_days") {
      const existingLogs = await input.tx.paymentLog.findMany({
        where: { playerId: input.playerId },
        select: { paidFor: true },
      });
      const activeWindow = getRollingThirtyDayPaymentWindow({
        paidDates: existingLogs.map((log) => log.paidFor),
      });
      if (activeWindow && activeWindow.remainingDays > 0 && player.remainingTrainingCredits > 0) {
        throw new Error(
          `Subscription is still active. Remaining trainings: ${player.remainingTrainingCredits}, remaining days: ${activeWindow.remainingDays}.`,
        );
      }
    }
  }

  if (isRollingThirtyDay) {
    const existingLogs = await input.tx.paymentLog.findMany({
      where: { playerId: input.playerId },
      select: { paidFor: true },
    });
    const activeWindow = getRollingThirtyDayPaymentWindow({
      paidDates: existingLogs.map((log) => log.paidFor),
    });
    if (activeWindow && activeWindow.remainingDays > 0) {
      throw new Error(
        `Membership is already paid for ${activeWindow.remainingDays} more ${activeWindow.remainingDays === 1 ? "day" : "days"}.`,
      );
    }
  }

  if (!isTrainingCredits) {
    const existingPayment = await input.tx.paymentLog.findFirst({
      where: {
        playerId: input.playerId,
        paidFor: { in: input.paidDates },
      },
      select: { id: true },
    });
    if (existingPayment) {
      throw new Error("This period is already paid");
    }
  }

  const existingWaiver = await input.tx.paymentWaiver.findFirst({
    where: {
      playerId: input.playerId,
      waivedFor: { in: input.paidDates },
    },
    select: { id: true },
  });
  if (existingWaiver) {
    throw new Error("Cannot record payment for a waived month. Remove pause first.");
  }

  const paymentLogs = [];
  for (const paidFor of input.paidDates) {
    paymentLogs.push(
      await input.tx.paymentLog.create({
        data: {
          playerId: input.playerId,
          paidFor,
          recordedBy: input.recordedBy,
          amount: input.amountPerPeriod,
          currency: input.currency,
        },
        select: { id: true },
      }),
    );
  }

  await updatePlayerStatusAfterPayment({
    tx: input.tx,
    playerId: input.playerId,
    remainingTrainingCredits: input.trainingCredits,
  });

  return { paymentLogIds: paymentLogs.map((log) => log.id) };
}

export async function sendMemberPaymentNotification(input: {
  playerId: string;
  paidDates: Date[];
  cardCode: string;
}) {
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
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

  if (!player || input.paidDates.length === 0) {
    return { total: 0, sent: 0, failed: 0, deactivated: 0 };
  }

  const targetCardCode = player.cards[0]?.cardCode ?? input.cardCode;
  const firstPaidDate = input.paidDates[0];
  const lastPaidDate = input.paidDates[input.paidDates.length - 1];
  const trainerMessage =
    input.paidDates.length > 1
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
    return await sendPushToMember(player.id, payload);
  } catch (pushError) {
    console.error("Member payment notification error:", pushError);
    return { total: 0, sent: 0, failed: 0, deactivated: 0 };
  }
}

export function publishPaymentUpdates(cardCode: string) {
  publishMemberUpdated(cardCode, "status-updated");
  publishMemberUpdated(cardCode, "payment-history-updated");
}

export function memberPaymentErrorResponse(error: unknown) {
  return { error: getPaymentErrorMessage(error) };
}
