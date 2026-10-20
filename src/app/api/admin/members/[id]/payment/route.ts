import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { buildNotificationPayload } from "@/lib/push/templates";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";
import { publishMemberUpdated } from "@/lib/memberEvents";
import {
  normalizeToDayStart,
  normalizeToMonthStart,
  getRollingThirtyDayPaymentWindow,
  toYearMonth,
  compareYearMonth,
} from "@/lib/paymentStatus";
import { updatePlayerStatusAfterPayment } from "@/lib/memberPayment";
import { resolveMemberFee, feeConflictMessage } from "@/lib/memberFee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const paidFor = (body as { paidFor?: unknown }).paidFor;
    const remainingTrainingsRaw = (body as { remainingTrainings?: unknown }).remainingTrainings;

    if (!paidFor) {
      return NextResponse.json(
        { error: "paidFor is required" },
        { status: 400 }
      );
    }

    const parsedPaidFor = new Date(String(paidFor));
    if (isNaN(parsedPaidFor.getTime())) {
      return NextResponse.json(
        { error: "paidFor must be a valid date" },
        { status: 400 }
      );
    }

    // Check if player exists
    const player = await prisma.player.findUnique({
      where: { id },
      include: {
        coachGroups: { select: { id: true, name: true, paymentAmount: true } },
        paymentLogs: {
          orderBy: { paidFor: "desc" },
          take: 1,
        },
        cards: {
          where: { isActive: true },
          select: { cardCode: true },
          take: 1,
        },
        club: {
          select: { paymentWorkflow: true, defaultPaymentAmount: true },
        },
      },
    });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    const fee = resolveMemberFee(player, player.club.defaultPaymentAmount);
    if (fee.source === "conflict") return NextResponse.json({ error: feeConflictMessage }, { status: 409 });
    const amount = fee.amount;
    if (amount === null) {
      return NextResponse.json({ error: "Payment amount is not configured." }, { status: 400 });
    }

    const isRollingThirtyDay = player.club.paymentWorkflow === "rolling_30_days";
    const isTrainingCredits = player.club.paymentWorkflow === "training_credits";
    const isTrainingCreditsThirtyDay = player.club.paymentWorkflow === "training_credits_30_days";
    const paidForDate = isRollingThirtyDay || isTrainingCredits || isTrainingCreditsThirtyDay
      ? normalizeToDayStart(parsedPaidFor)
      : normalizeToMonthStart(parsedPaidFor);

    if (player.firstBillingMonth && !isRollingThirtyDay && !isTrainingCredits && !isTrainingCreditsThirtyDay) {
      if (compareYearMonth(toYearMonth(paidForDate), toYearMonth(player.firstBillingMonth)) < 0) {
        return NextResponse.json(
          { error: "Cannot record payment before billing start month" },
          { status: 400 },
        );
      }
    }

    let remainingTrainingCreditsUpdate: number | undefined;
    if (isTrainingCredits || isTrainingCreditsThirtyDay) {
      const parsedRemainingTrainings = Number(remainingTrainingsRaw);
      if (!Number.isInteger(parsedRemainingTrainings) || parsedRemainingTrainings < 1 || parsedRemainingTrainings > 999) {
        return NextResponse.json(
          { error: "remainingTrainings must be a whole number greater than 0" },
          { status: 400 },
        );
      }
      remainingTrainingCreditsUpdate = parsedRemainingTrainings;
    }

    if (isRollingThirtyDay) {
      const activeWindow = getRollingThirtyDayPaymentWindow({
        paidDates: player.paymentLogs.map((log) => log.paidFor),
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
    }

    if (isTrainingCreditsThirtyDay) {
      const activeWindow = getRollingThirtyDayPaymentWindow({
        paidDates: player.paymentLogs.map((log) => log.paidFor),
      });
      if (activeWindow && activeWindow.remainingDays > 0 && player.remainingTrainingCredits > 0) {
        return NextResponse.json(
          {
            error: `Subscription is still active. Remaining trainings: ${player.remainingTrainingCredits}, remaining days: ${activeWindow.remainingDays}.`,
            remainingTrainings: player.remainingTrainingCredits,
            remainingDays: activeWindow.remainingDays,
            paidUntil: activeWindow.paidUntil,
          },
          { status: 400 },
        );
      }
    }

    // Check if this month/year is already paid
    const existingPayment = await prisma.paymentLog.findFirst({
      where: {
        playerId: id,
        paidFor: paidForDate,
      },
    });
    const existingWaiver = await prisma.paymentWaiver.findFirst({
      where: {
        playerId: id,
        waivedFor: paidForDate,
      },
      select: { id: true },
    });

    if (existingPayment && !isTrainingCredits && !isTrainingCreditsThirtyDay) {
      return NextResponse.json(
        { error: `Този период (${paidForDate.toLocaleDateString("bg-BG")}) вече е платен` },
        { status: 400 }
      );
    }

    if (existingWaiver) {
      return NextResponse.json(
        { error: "Cannot record payment for a waived month. Remove pause first." },
        { status: 400 }
      );
    }

    const paymentLog = await prisma.$transaction(async (tx) => {
      const createdPayment = await tx.paymentLog.create({
        data: {
          playerId: id,
          paidFor: paidForDate,
          recordedBy: "admin",
          amount,
          currency: "EUR",
        },
      });

      await updatePlayerStatusAfterPayment({
        tx,
        playerId: id,
        remainingTrainingCredits: remainingTrainingCreditsUpdate,
        paymentRecordedAt: createdPayment.paidAt,
      });

      return createdPayment;
    });

    const memberUrl = player.cards[0]?.cardCode
      ? `/member/${player.cards[0].cardCode}`
      : "/";
    const paidForLabel = paidForDate.toLocaleDateString("bg-BG", {
      day: isRollingThirtyDay ? "2-digit" : undefined,
      month: "long",
      year: "numeric",
    });

    const pushPayload = buildNotificationPayload({
      type: "trainer_message",
      memberName: player.fullName.trim(),
      trainerMessage: `Плащането за месец ${paidForLabel} е отчетено успешно.`,
      url: memberUrl,
    });

    let pushResult = { total: 0, sent: 0, failed: 0, deactivated: 0 };
    try {
      pushResult = await sendPushToMember(player.id, pushPayload);
      if (pushResult.sent > 0) {
        await saveMemberNotificationHistory(player.id, "trainer_message", pushPayload);
      }
    } catch (pushError) {
      // Payment should not fail because push delivery failed.
      console.error("Payment push send error:", pushError);
    }

    const targetCardCode = player.cards[0]?.cardCode;
    if (targetCardCode) {
      publishMemberUpdated(targetCardCode, "status-updated");
      publishMemberUpdated(targetCardCode, "payment-history-updated");
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: paymentLog.id,
        paidFor: paymentLog.paidFor,
        paidAt: paymentLog.paidAt,
        amount: paymentLog.amount,
        currency: paymentLog.currency,
      },
      push: pushResult,
    });

  } catch (error) {
    console.error("Payment creation error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Get all payment logs and waived months for this player
    const [paymentLogs, waivedMonths] = await Promise.all([
      prisma.paymentLog.findMany({
        where: { playerId: id },
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          paidFor: true,
          paidAt: true,
          recordedBy: true,
          amount: true,
          currency: true,
        },
      }),
      prisma.paymentWaiver.findMany({
        where: { playerId: id },
        orderBy: { waivedFor: "desc" },
        select: {
          id: true,
          waivedFor: true,
          reason: true,
          createdBy: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      payments: paymentLogs,
      waivedMonths,
    });

  } catch (error) {
    console.error("Payment fetch error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
