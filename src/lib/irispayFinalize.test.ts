import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAndApplyIrisPayment } from "./irispayFinalize";
import { deactivateIrisPayment, getIrisPaymentStatus } from "@/lib/irispay";
import {
  finalizeResolvedMemberPayment,
  sendMemberPaymentNotification,
} from "@/lib/memberPayment";

const mocks = vi.hoisted(() => ({
  deactivateIrisPayment: vi.fn(),
  getIrisPaymentStatus: vi.fn(),
  finalizeResolvedMemberPayment: vi.fn(),
  publishPaymentUpdates: vi.fn(),
  sendMemberPaymentNotification: vi.fn(),
  prisma: {
    irisPayment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/irispay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/irispay")>();
  return {
    ...actual,
    deactivateIrisPayment: mocks.deactivateIrisPayment,
    getIrisPaymentStatus: mocks.getIrisPaymentStatus,
  };
});

vi.mock("@/lib/memberPayment", () => ({
  finalizeResolvedMemberPayment: mocks.finalizeResolvedMemberPayment,
  publishPaymentUpdates: mocks.publishPaymentUpdates,
  sendMemberPaymentNotification: mocks.sendMemberPaymentNotification,
}));

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "iris-1",
    clubId: "club-1",
    playerId: "player-1",
    paymentHash: "hash-1",
    accountId: null,
    paymentLink: "https://paybyclick.irispay.bg/#/payment/link/hash-1",
    shortPaymentLink: null,
    orderId: "order-1",
    amount: { toString: () => "20.00" },
    currency: "EUR",
    paidFor: new Date("2026-09-01T00:00:00.000Z"),
    paidThrough: null,
    trainingCredits: null,
    status: "WAITING",
    paymentLogId: null,
    rawCreatePayload: {
      paymentHash: "hash-1",
      paymentLink: "https://paybyclick.irispay.bg/#/payment/link/hash-1",
      createOptions: { repayable: true },
    },
    rawStatusPayload: null,
    rawWebhookPayload: null,
    confirmedAt: null,
    linkDeactivatedAt: null,
    linkDeactivationError: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    player: {
      cards: [{ cardCode: "CARD1" }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIrisPaymentStatus.mockResolvedValue({
    status: "CONFIRMED", paymentHash: "hash-1",
    attempts: [
      { status: "FAILED", attemptPaymentHash: "attempt-1", payerIban: null,
        payerBank: null, payerName: null, date: "2026-10-15T10:00:00Z" },
      { status: "CONFIRMED", attemptPaymentHash: "attempt-2", payerIban: "iban",
        payerBank: "bank", payerName: "payer", date: "2026-10-15T10:01:00Z" },
    ],
  });
  mocks.deactivateIrisPayment.mockResolvedValue(null);
  mocks.prisma.irisPayment.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...makePayment(),
    ...data,
  }));
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    irisPayment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue(makePayment({ status: "CONFIRMED", paymentLogId: "log-1" })),
    },
  }));
  mocks.finalizeResolvedMemberPayment.mockResolvedValue({ paymentLogIds: ["log-1"] });
  mocks.sendMemberPaymentNotification.mockResolvedValue({ total: 1, sent: 1, failed: 0, deactivated: 0 });
});

describe("verifyAndApplyIrisPayment link deactivation", () => {
  it.each(["WAITING", "FAILED"])("persists reusable %s attempts without crediting or deactivating", async (status) => {
    const payload = {
      status, paymentHash: "hash-1",
      attempts: [{ status, attemptPaymentHash: "attempt-1", payerIban: null,
        payerBank: null, payerName: null, date: "2026-10-15T10:00:00Z" }],
    };
    mocks.prisma.irisPayment.findUnique.mockResolvedValueOnce(makePayment());
    mocks.getIrisPaymentStatus.mockResolvedValueOnce(payload);

    const result = await verifyAndApplyIrisPayment({ orderId: "order-1" });

    expect(getIrisPaymentStatus).toHaveBeenCalledWith("hash-1", true);
    expect(result.status).toBe(status);
    expect(mocks.prisma.irisPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status, rawStatusPayload: payload }),
    }));
    expect(deactivateIrisPayment).not.toHaveBeenCalled();
    expect(finalizeResolvedMemberPayment).not.toHaveBeenCalled();
  });

  it("stores the unit amount for each month of a multi-month online payment", async () => {
    mocks.prisma.irisPayment.findUnique
      .mockResolvedValueOnce(makePayment({ amount: { toString: () => "51.00" }, paidThrough: new Date("2026-10-01T00:00:00Z") }))
      .mockResolvedValueOnce(makePayment({ status: "CONFIRMED", paymentLogId: "log-1" }));
    await verifyAndApplyIrisPayment({ orderId: "order-1" });
    expect(finalizeResolvedMemberPayment).toHaveBeenCalledWith(expect.objectContaining({
      paidDates: [new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")],
      amountPerPeriod: "25.50", currency: "EUR",
    }));
  });
  it("uses exact quoted months across a waived gap and the stored checkout amount", async () => {
    const dates = ["2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"];
    mocks.prisma.irisPayment.findUnique
      .mockResolvedValueOnce(makePayment({ amount: { toString: () => "170.00" }, paidFor: new Date(dates[0]), paidThrough: new Date(dates[1]), quotedPaidDates: dates }))
      .mockResolvedValueOnce(makePayment({ status: "CONFIRMED", paymentLogId: "log-1" }));
    await verifyAndApplyIrisPayment({ orderId: "order-1" });
    expect(finalizeResolvedMemberPayment).toHaveBeenCalledWith(expect.objectContaining({
      paidDates: dates.map((date) => new Date(date)), amountPerPeriod: "85.00",
    }));
  });
  it("deactivates a verified CONFIRMED reusable payment before finalization completes", async () => {
    mocks.prisma.irisPayment.findUnique
      .mockResolvedValueOnce(makePayment())
      .mockResolvedValueOnce(makePayment({ status: "CONFIRMED", paymentLogId: "log-1", linkDeactivatedAt: new Date() }));

    const result = await verifyAndApplyIrisPayment({ orderId: "order-1" });

    expect(getIrisPaymentStatus).toHaveBeenCalledWith("hash-1", true);
    expect(deactivateIrisPayment).toHaveBeenCalledWith("hash-1");
    expect(mocks.prisma.irisPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "iris-1" },
      data: expect.objectContaining({
        linkDeactivationError: null,
        linkDeactivatedAt: expect.any(Date),
      }),
    }));
    expect(finalizeResolvedMemberPayment).toHaveBeenCalledTimes(1);
    expect(finalizeResolvedMemberPayment).toHaveBeenCalledWith(expect.objectContaining({ amountPerPeriod: "20.00", currency: "EUR" }));
    expect(result).toEqual(expect.objectContaining({ status: "CONFIRMED", alreadyFinalized: false }));
  });

  it("does not deactivate a non-repayable payment", async () => {
    mocks.prisma.irisPayment.findUnique
      .mockResolvedValueOnce(makePayment({
        rawCreatePayload: { paymentHash: "hash-1", createOptions: { repayable: false } },
      }))
      .mockResolvedValueOnce(makePayment({ status: "CONFIRMED", paymentLogId: "log-1" }));

    await verifyAndApplyIrisPayment({ orderId: "order-1" });

    expect(getIrisPaymentStatus).toHaveBeenCalledWith("hash-1", false);
    expect(deactivateIrisPayment).not.toHaveBeenCalled();
    expect(finalizeResolvedMemberPayment).toHaveBeenCalledTimes(1);
  });

  it("stores deactivation failure but still finalizes a successful payment", async () => {
    mocks.deactivateIrisPayment.mockRejectedValueOnce(new Error("Inactive endpoint unavailable"));
    mocks.prisma.irisPayment.findUnique
      .mockResolvedValueOnce(makePayment())
      .mockResolvedValueOnce(makePayment({ status: "CONFIRMED", paymentLogId: "log-1" }));

    await verifyAndApplyIrisPayment({ orderId: "order-1" });

    expect(mocks.prisma.irisPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "iris-1" },
      data: { linkDeactivationError: "Inactive endpoint unavailable" },
    }));
    expect(finalizeResolvedMemberPayment).toHaveBeenCalledTimes(1);
    expect(sendMemberPaymentNotification).toHaveBeenCalledTimes(1);
  });

  it("retries deactivation for an already-finalized reusable payment", async () => {
    mocks.prisma.irisPayment.findUnique.mockResolvedValueOnce(makePayment({
      status: "CONFIRMED",
      paymentLogId: "log-1",
      linkDeactivatedAt: null,
    }));

    const result = await verifyAndApplyIrisPayment({ orderId: "order-1" });

    expect(deactivateIrisPayment).toHaveBeenCalledWith("hash-1");
    expect(getIrisPaymentStatus).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(finalizeResolvedMemberPayment).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: "CONFIRMED", alreadyFinalized: true }));
  });

  it("does not create duplicate payment logs when a concurrent call already finalized the payment", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txFindUnique = vi.fn().mockResolvedValue({ status: "CONFIRMED", paymentLogId: "log-1" });
    mocks.prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      irisPayment: {
        updateMany,
        findUnique: txFindUnique,
        update: vi.fn(),
      },
    }));
    mocks.prisma.irisPayment.findUnique
      .mockResolvedValueOnce(makePayment())
      .mockResolvedValueOnce(makePayment({ status: "CONFIRMED", paymentLogId: "log-1" }));

    const result = await verifyAndApplyIrisPayment({ orderId: "order-1" });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "iris-1", paymentLogId: null },
    }));
    expect(finalizeResolvedMemberPayment).not.toHaveBeenCalled();
    expect(sendMemberPaymentNotification).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: "CONFIRMED", alreadyFinalized: true }));
  });
});
