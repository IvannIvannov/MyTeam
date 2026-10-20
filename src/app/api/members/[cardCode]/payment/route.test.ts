import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  prisma: {
    card: { findFirst: vi.fn() }, player: { findUnique: vi.fn() },
    paymentLog: { findMany: vi.fn() }, paymentWaiver: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["admin"] }) }));
vi.mock("@/lib/memberPayment", () => ({ updatePlayerStatusAfterPayment: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn() }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: vi.fn() }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.card.findFirst.mockResolvedValue({ playerId: "player", player: {
    firstBillingMonth: new Date("2026-01-01T00:00:00Z"), paymentAmount: "25.50",
    club: { paymentWorkflow: "calendar_month", defaultPaymentAmount: "40.00" },
  } });
  mocks.prisma.paymentLog.findMany.mockResolvedValue([]);
  mocks.prisma.paymentWaiver.findMany.mockResolvedValue([{ waivedFor: new Date("2026-02-01T00:00:00Z") }]);
  mocks.prisma.player.findUnique.mockResolvedValue(null);
  mocks.prisma.$transaction.mockImplementation((callback) => callback({ paymentLog: { createMany: mocks.createMany } }));
});

it("saves the personal monthly fee on every covered month and skips exempt months", async () => {
  const request = new NextRequest("http://localhost/api/members/CARD/payment", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: "admin_session=test" },
    body: JSON.stringify({ paidFor: "2026-03-01T00:00:00Z" }),
  });
  expect((await POST(request, { params: Promise.resolve({ cardCode: "CARD" }) })).status).toBe(200);
  expect(mocks.createMany).toHaveBeenCalledWith({ data: [
    { playerId: "player", paidFor: new Date("2026-01-01T00:00:00Z"), recordedBy: "member", amount: "25.50", currency: "EUR" },
    { playerId: "player", paidFor: new Date("2026-03-01T00:00:00Z"), recordedBy: "member", amount: "25.50", currency: "EUR" },
  ] });
});
