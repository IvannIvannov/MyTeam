import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { getClubSubscriptionSummary } from "./clubSubscriptionSummary";
import { GET } from "@/app/api/admin/clubs/[id]/subscription/route";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { club: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
const id = "00000000-0000-0000-0000-000000000001";
const params = { params: Promise.resolve({ id }) };
const request = (suffix = "", cookie = true) => new NextRequest(`http://localhost/api/admin/clubs/${id}/subscription${suffix}`, { headers: cookie ? { cookie: "admin_session=test" } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ roles: ["coach"], sub: "coach" });
  mocks.findUnique.mockResolvedValue({ billingStatus: "active", platformSubscription: {
    mode: "paid", trialEndDate: null, firstBillingMonth: "2026-10", fees: [{ effectiveMonth: "2026-10", amount: new Prisma.Decimal(10) }],
    payments: [{ months: [{ month: "2026-10", amount: new Prisma.Decimal(10) }] }],
  } });
});
it("requires a session and rejects coach-group views", async () => {
  expect((await GET(request("", false), params)).status).toBe(401);
  expect((await GET(request("?coachGroupId=group"), params)).status).toBe(403);
  expect(mocks.findUnique).not.toHaveBeenCalled();
});
it("allows club coach sessions and projects only subscription accounting data", async () => {
  const response = await GET(request(), params);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.paidMonths).toEqual([{ month: "2026-10", amount: "10.00" }]);
  expect(Object.keys(body).sort()).toEqual(["firstBillingMonth", "mode", "paidMonths", "summary", "trialEndDate"]);
  expect(JSON.stringify(body)).not.toMatch(/createdBy|actorId|note|changes/);
  const selection = mocks.findUnique.mock.calls[0][0].select.platformSubscription.select;
  expect(selection.payments.where).toEqual({ voidedAt: null });
  expect(selection.payments.select).toEqual({ months: { select: { month: true, amount: true } } });
});
it("does not show subscriptions for demo clubs", async () => {
  mocks.findUnique.mockResolvedValue({ billingStatus: "demo", platformSubscription: null });
  expect(await getClubSubscriptionSummary(id)).toBeNull();
});
it("shows unlimited trials and missing clubs without exposing internal data", async () => {
  mocks.findUnique.mockResolvedValue({ billingStatus: "active", platformSubscription: { mode: "trial", trialEndDate: null, firstBillingMonth: null, fees: [], payments: [] } });
  expect(await getClubSubscriptionSummary(id)).toMatchObject({ mode: "trial", trialEndDate: null, paidMonths: [], summary: { status: "trial" } });
  mocks.findUnique.mockResolvedValue(null);
  expect(await getClubSubscriptionSummary(id)).toBeNull();
});
