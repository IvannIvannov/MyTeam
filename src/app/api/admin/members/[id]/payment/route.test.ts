import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), updatePlayerStatusAfterPayment: vi.fn(),
  prisma: {
    player: { findUnique: vi.fn() },
    paymentLog: { findFirst: vi.fn() },
    paymentWaiver: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["admin"] }) }));
vi.mock("@/lib/memberPayment", () => ({ updatePlayerStatusAfterPayment: mocks.updatePlayerStatusAfterPayment }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn().mockResolvedValue({ sent: 0 }) }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: vi.fn() }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.player.findUnique.mockResolvedValue({ id: "player", fullName: "Player", paymentAmount: "25.50", firstBillingMonth: null, cards: [], club: { paymentWorkflow: "calendar_month", defaultPaymentAmount: "40.00" } });
  mocks.prisma.paymentLog.findFirst.mockResolvedValue(null);
  mocks.prisma.paymentWaiver.findFirst.mockResolvedValue(null);
  mocks.create.mockImplementation(({ data }) => ({ id: "log", paidAt: new Date(), ...data }));
  mocks.prisma.$transaction.mockImplementation((callback) => callback({ paymentLog: { create: mocks.create } }));
});

const request = (amount?: unknown) => new NextRequest("http://localhost/api/admin/members/player/payment", {
  method: "POST", headers: { "Content-Type": "application/json", cookie: "admin_session=test" },
  body: JSON.stringify({ paidFor: "2026-10-01T00:00:00Z", amount }),
});
const context = { params: Promise.resolve({ id: "player" }) };

it("snapshots the personal fee and ignores an amount supplied by the browser", async () => {
  const response = await POST(request("1.00"), context);
  expect(response.status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: "25.50", currency: "EUR" }) });
  expect((await response.json()).payment.amount).toBe("25.50");
});

it("snapshots the club fee when no personal fee is set, without requiring amount entry", async () => {
  mocks.prisma.player.findUnique.mockResolvedValue({ id: "player", fullName: "Player", paymentAmount: "0.00", firstBillingMonth: null, cards: [], club: { paymentWorkflow: "calendar_month", defaultPaymentAmount: "40.00" } });
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: "40.00", currency: "EUR" }) });
});
