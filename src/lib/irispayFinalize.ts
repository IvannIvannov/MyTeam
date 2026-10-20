import { Prisma, type IrisPayment } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  deactivateIrisPayment,
  getIrisPaymentStatus,
  isReusableIrisCreatePayload,
  normalizeIrisStatus,
} from "@/lib/irispay";
import {
  finalizeResolvedMemberPayment,
  publishPaymentUpdates,
  sendMemberPaymentNotification,
} from "@/lib/memberPayment";

type IrisPaymentWithPlayer = IrisPayment & {
  player: {
    cards: Array<{ cardCode: string }>;
  };
};

type IrisPaymentForDeactivation = Pick<
  IrisPayment,
  "id" | "paymentHash" | "rawCreatePayload" | "linkDeactivatedAt"
>;

export function buildPaidDates(payment: IrisPayment): Date[] {
  if (payment.quotedPaidDates !== null && payment.quotedPaidDates !== undefined) {
    const raw = payment.quotedPaidDates;
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((value) => typeof value !== "string" || Number.isNaN(new Date(value).getTime()))) {
      throw new Error("Invalid quoted payment periods");
    }
    const dates = (raw as string[]).map((value) => new Date(value));
    if (new Set(dates.map((date) => date.toISOString())).size !== dates.length) throw new Error("Duplicate quoted payment periods");
    return dates;
  }
  if (payment.paidThrough && payment.paidThrough.getTime() !== payment.paidFor.getTime()) {
    const dates: Date[] = [];
    const cursor = new Date(payment.paidFor);
    const end = payment.paidThrough;
    while (cursor.getTime() <= end.getTime()) {
      dates.push(new Date(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return dates;
  }
  return [payment.paidFor];
}

function getSafeDeactivationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "IRISPay link deactivation failed";
  return message.replace(/\s+/g, " ").trim().slice(0, 1000) || "IRISPay link deactivation failed";
}

async function deactivateReusableIrisLink(payment: IrisPaymentForDeactivation) {
  if (
    !payment.paymentHash ||
    payment.linkDeactivatedAt ||
    !isReusableIrisCreatePayload(payment.rawCreatePayload)
  ) {
    return { attempted: false, succeeded: false };
  }

  try {
    await deactivateIrisPayment(payment.paymentHash);
    await prisma.irisPayment.update({
      where: { id: payment.id },
      data: {
        linkDeactivatedAt: new Date(),
        linkDeactivationError: null,
      },
    });
    return { attempted: true, succeeded: true };
  } catch (error) {
    const safeError = getSafeDeactivationError(error);
    console.error("IRISPay link deactivation failed:", safeError);
    await prisma.irisPayment.update({
      where: { id: payment.id },
      data: { linkDeactivationError: safeError },
    }).catch((updateError) => {
      console.error("IRISPay link deactivation error persistence failed:", getSafeDeactivationError(updateError));
    });
    return { attempted: true, succeeded: false, error: safeError };
  }
}

export async function verifyAndApplyIrisPayment(input: {
  orderId: string;
  webhookPayload?: Record<string, unknown>;
}) {
  const pendingPayment = await prisma.irisPayment.findUnique({
    where: { orderId: input.orderId },
    include: {
      player: {
        select: {
          cards: {
            where: { isActive: true },
            select: { cardCode: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!pendingPayment) {
    throw new Error("IRIS payment transaction not found");
  }

  if (!pendingPayment.paymentHash) {
    throw new Error("IRIS payment hash is missing");
  }

  if (pendingPayment.status === "CONFIRMED" && pendingPayment.paymentLogId) {
    await deactivateReusableIrisLink(pendingPayment);
    return {
      status: "CONFIRMED" as const,
      alreadyFinalized: true,
      irisPayment: pendingPayment,
    };
  }

  // Use the options saved at creation, even if the current environment setting changes.
  const statusPayload = await getIrisPaymentStatus(
    pendingPayment.paymentHash,
    isReusableIrisCreatePayload(pendingPayment.rawCreatePayload),
  );
  const verifiedStatus = normalizeIrisStatus(statusPayload.status);
  if (!verifiedStatus) {
    throw new Error("IRISPay returned an unknown payment status");
  }

  if (verifiedStatus !== "CONFIRMED") {
    const updated = await prisma.irisPayment.update({
      where: { id: pendingPayment.id },
      data: {
        status: verifiedStatus,
        rawStatusPayload: statusPayload,
        ...(input.webhookPayload ? { rawWebhookPayload: input.webhookPayload } : {}),
      },
      include: {
        player: {
          select: {
            cards: {
              where: { isActive: true },
              select: { cardCode: true },
              take: 1,
            },
          },
        },
      },
    });
    return {
      status: verifiedStatus,
      alreadyFinalized: false,
      irisPayment: updated,
    };
  }

  await deactivateReusableIrisLink(pendingPayment);

  const paidDates = buildPaidDates(pendingPayment);
  const finalized = await prisma.$transaction(async (tx) => {
    const claim = await tx.irisPayment.updateMany({
      where: {
        id: pendingPayment.id,
        paymentLogId: null,
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        rawStatusPayload: statusPayload,
        ...(input.webhookPayload ? { rawWebhookPayload: input.webhookPayload } : {}),
      },
    });

    if (claim.count === 0) {
      const currentPayment = await tx.irisPayment.findUnique({
        where: { id: pendingPayment.id },
        select: {
          status: true,
          paymentLogId: true,
        },
      });
      if (currentPayment?.status === "CONFIRMED" && currentPayment.paymentLogId) {
        return {
          alreadyFinalized: true,
          paymentLogId: currentPayment.paymentLogId,
        };
      }
      if (!currentPayment) {
        throw new Error("IRIS payment transaction not found");
      }
      throw new Error("IRIS payment could not be finalized");
    }

    const totalAmount = new Prisma.Decimal(pendingPayment.amount.toString());
    const amountPerPeriod = totalAmount.div(paidDates.length).toFixed(2);
    if (!new Prisma.Decimal(amountPerPeriod).mul(paidDates.length).equals(totalAmount)) {
      throw new Error("IRIS payment amount cannot be allocated exactly across the covered periods");
    }
    const result = await finalizeResolvedMemberPayment({
      tx,
      playerId: pendingPayment.playerId,
      paidDates,
      recordedBy: "irispay",
      amountPerPeriod,
      currency: pendingPayment.currency,
      trainingCredits: pendingPayment.trainingCredits,
    });

    const primaryPaymentLogId = result.paymentLogIds[0] ?? null;
    await tx.irisPayment.update({
      where: { id: pendingPayment.id },
      data: {
        paymentLogId: primaryPaymentLogId,
        rawStatusPayload: statusPayload,
        ...(input.webhookPayload ? { rawWebhookPayload: input.webhookPayload } : {}),
      },
    });

    return {
      alreadyFinalized: false,
      paymentLogId: primaryPaymentLogId,
    };
  }, { isolationLevel: "Serializable" });

  const cardCode = (pendingPayment as IrisPaymentWithPlayer).player.cards[0]?.cardCode;
  if (cardCode) {
    publishPaymentUpdates(cardCode);
    if (!finalized.alreadyFinalized) {
      await sendMemberPaymentNotification({
        playerId: pendingPayment.playerId,
        paidDates,
        cardCode,
      });
    }
  }

  const updatedPayment = await prisma.irisPayment.findUnique({
    where: { id: pendingPayment.id },
    include: {
      player: {
        select: {
          cards: {
            where: { isActive: true },
            select: { cardCode: true },
            take: 1,
          },
        },
      },
    },
  });

  return {
    status: "CONFIRMED" as const,
    alreadyFinalized: finalized.alreadyFinalized,
    irisPayment: updatedPayment ?? pendingPayment,
  };
}
