import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { changeClubSubscription } from "./clubSubscriptions";
import { summarizeSubscription } from "./clubSubscriptionDomain";
import { GET } from "@/app/api/admin/subscriptions/route";
import { POST } from "@/app/api/admin/subscriptions/[clubId]/route";
import { POST as activate } from "@/app/api/admin/clubs/[id]/activate-billing/route";

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  club: { findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  player: { updateMany: vi.fn() },
  clubSubscription: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  clubSubscriptionFee: { upsert: vi.fn() },
  clubSubscriptionPayment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  adminNotification: { create: vi.fn() },
  events: vi.fn(), push: vi.fn(), auth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: mocks.push }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/adminNotificationEvents", () => ({ publishAdminNotificationCreated: mocks.events }));

const clubId = "00000000-0000-0000-0000-000000000001";
const paymentId = "00000000-0000-0000-0000-000000000010";
const otherPaymentId = "00000000-0000-0000-0000-000000000011";
const decimal = (s: string) => new Prisma.Decimal(s);
type StoredPayment = { id: string; clubId: string; paidOn: string; note: string | null; total: Prisma.Decimal; createdBy: string; voidedAt: Date | null; voidedBy: string | null; months: { month: string; amount: Prisma.Decimal; voidedAt: Date | null }[] };
let state: { mode: string; trialEndDate: string | null; firstBillingMonth: string | null; version: number; fees: { effectiveMonth: string; amount: Prisma.Decimal }[]; payments: StoredPayment[] };
let billingStatus: "active" | "demo";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
  billingStatus = "active";
  state = { mode: "paid", trialEndDate: null, firstBillingMonth: "2026-09", version: 1, fees: [{ effectiveMonth: "2026-09", amount: decimal("10") }], payments: [] };
  mocks.adminNotification.create.mockResolvedValue({ id: "notification" });
  mocks.auth.mockResolvedValue({ roles: ["admin"], sub: "admin" });
  mocks.$transaction.mockImplementation(async (callback) => callback(mocks));
  mocks.$queryRaw.mockResolvedValue([{ id: clubId }]);
  mocks.club.findUniqueOrThrow.mockImplementation(async () => ({ billingStatus, defaultPaymentAmount: decimal("60"), platformSubscription: { clubId } }));
  mocks.clubSubscription.findUnique.mockImplementation(async () => ({ ...state, fees: state.fees.map((f) => ({ ...f })), payments: state.payments.map((p) => ({ ...p, months: p.months.map((m) => ({ ...m })) })) }));
  mocks.clubSubscription.update.mockImplementation(async ({ data }) => {
    if (data.version) state.version += data.version.increment;
    if (data.mode) state.mode = data.mode;
    if ("trialEndDate" in data) state.trialEndDate = data.trialEndDate;
    if (data.firstBillingMonth) state.firstBillingMonth = data.firstBillingMonth;
    if (data.fees) state.fees.push({ ...data.fees.create, amount: decimal(data.fees.create.amount) });
    return state;
  });
  mocks.clubSubscriptionFee.upsert.mockImplementation(async ({ create, update, where }) => {
    const fee = state.fees.find((f) => f.effectiveMonth === where.clubId_effectiveMonth.effectiveMonth);
    if (fee) fee.amount = decimal(update.amount);
    else state.fees.push({ effectiveMonth: create.effectiveMonth, amount: decimal(create.amount) });
  });
  mocks.clubSubscriptionPayment.findUnique.mockImplementation(async ({ where }) => state.payments.find((p) => p.id === where.id) ?? null);
  mocks.clubSubscriptionPayment.create.mockImplementation(async ({ data }) => {
    state.payments.push({ ...data, total: decimal(data.total), voidedAt: null, voidedBy: null, months: data.months.create.map((m: { month: string; amount: string }) => ({ ...m, amount: decimal(m.amount), voidedAt: null })) });
  });
  mocks.clubSubscriptionPayment.update.mockImplementation(async ({ where, data }) => {
    const payment = state.payments.find((p) => p.id === where.id)!;
    payment.voidedAt = data.voidedAt; payment.voidedBy = data.voidedBy;
    payment.months.forEach((m) => { m.voidedAt = data.months.updateMany.data.voidedAt; });
  });
  mocks.push.mockResolvedValue({ total: 2, sent: 2, failed: 0, deactivated: 0 });
  mocks.club.findMany.mockResolvedValue([]);
  mocks.player.updateMany.mockResolvedValue({ count: 3 });
  mocks.club.update.mockResolvedValue({ id: clubId, billingStatus: "active" });
});
afterEach(() => vi.useRealTimers());
const pay = (extra = {}) => ({ action: "payment", expectedVersion: state.version, paymentId, months: ["2026-09", "2026-11"], paidOn: "2026-10-24", note: "Bank transfer", expectedTotal: "20.00", ...extra });
const change = (body: Record<string, unknown>) => changeClubSubscription(clubId, body, "admin");

function request(body?: unknown, cookie = true) {
  return new NextRequest(`http://localhost/api/admin/subscriptions/${clubId}`, { method: body === undefined ? "GET" : "POST", headers: { ...(cookie ? { cookie: "admin_session=test" } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("subscription payments and fee history", () => {
  it("records selected months and retries the same payment without duplicating it", async () => {
    const input = pay();
    await change(input);
    await change(input); // Original version is deliberately stale on the retry.
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0].months.map((m) => m.month)).toEqual(["2026-09", "2026-11"]);
    expect(state.payments[0].createdBy).toBe("admin");
    expect(state.version).toBe(2);
    expect(mocks.clubSubscription.update.mock.calls[0][0].data.changes.create).toMatchObject({ actorId: "admin", action: "payment" });
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it("rejects overlapping months, changed quotes, and reused keys with different contents", async () => {
    await expect(change(pay({ expectedTotal: "19.00" }))).rejects.toThrow(/Сумата/);
    expect(state.payments).toHaveLength(0);
    await change(pay());
    await expect(change(pay({ paymentId: otherPaymentId }))).rejects.toThrow(/Месецът е платен/);
    await expect(change(pay({ note: "Changed" }))).rejects.toThrow(/вече е използван/);
    expect(state.payments).toHaveLength(1);
  });
  it("rejects a stale concurrent writer even when its selected months do not overlap", async () => {
    const first = pay();
    const second = pay({ paymentId: otherPaymentId, months: ["2026-10"], expectedTotal: "10.00" });
    await change(first);
    await expect(change(second)).rejects.toThrow(/Данните са променени/);
    expect(mocks.$queryRaw).toHaveBeenCalledTimes(2);
    expect(state.payments).toHaveLength(1);
  });
  it("rejects fee changes through the latest paid month, including gaps and year rollover", async () => {
    await change(pay({ months: ["2026-12"], expectedTotal: "10.00" }));
    for (const effectiveMonth of ["2026-10", "2026-12"]) {
      await expect(change({ action: "fee", expectedVersion: 2, amount: "15", effectiveMonth })).rejects.toThrow(/2027-01/);
    }
    expect(mocks.clubSubscriptionFee.upsert).not.toHaveBeenCalled();
    await change({ action: "fee", expectedVersion: 2, amount: "15", effectiveMonth: "2027-01" });
    expect(state.fees[1].effectiveMonth).toBe("2027-01");
  });
  it("allows fee changes for reopened months after a payment is voided", async () => {
    await change(pay({ months: ["2026-12"], expectedTotal: "10.00" }));
    await change({ action: "void", expectedVersion: 2, paymentId });
    await change({ action: "fee", expectedVersion: 3, amount: "15", effectiveMonth: "2026-09" });
    expect(state.fees[0].amount.toFixed(2)).toBe("15.00");
  });
  it("retains paid snapshots after a future fee revision and notifies only the main club scope", async () => {
    await change(pay());
    await change({ action: "fee", expectedVersion: 2, amount: "15", effectiveMonth: "2026-12" });
    expect(state.payments[0].total.toFixed(2)).toBe("20.00");
    expect(state.payments[0].months[0].amount.toFixed(2)).toBe("10.00");
    expect(mocks.push).toHaveBeenLastCalledWith(clubId, {
      title: "Промяна на абонамента за MyTeam", body: "Месечната такса се променя от 10.00 EUR на 15.00 EUR, считано от 2026-12.", url: `/admin/members?clubId=${clubId}`,
    }, null);
  });
  it("voids a payment, reopens its months, and permits a new payment for them", async () => {
    const original = pay();
    await change(original);
    await change({ action: "void", expectedVersion: 2, paymentId });
    expect(state.payments[0].voidedBy).toBe("admin");
    expect(state.payments[0].months.every((m) => m.voidedAt)).toBe(true);
    await change(original); // Retrying an old request never revives the voided payment.
    expect(state.payments).toHaveLength(1);
    await change(pay({ paymentId: otherPaymentId }));
    expect(state.payments).toHaveLength(2);
    expect(state.payments[0].voidedAt).not.toBeNull();
  });
  it("rejects months before subscription start, duplicate months, and future payment dates", async () => {
    await expect(change(pay({ months: ["2026-08"], expectedTotal: "10" }))).rejects.toThrow(/преди началото/);
    await expect(change(pay({ months: ["2026-09", "2026-09"] }))).rejects.toThrow(/Повтарящи/);
    await expect(change(pay({ paidOn: "2026-10-25" }))).rejects.toThrow(/дата/);
    expect(state.payments).toHaveLength(0);
  });
  it("accepts multi-month totals greater than the maximum individual monthly fee", async () => {
    state.fees[0].amount = decimal("99999999.99");
    await change(pay({ expectedTotal: "199999999.98" }));
    expect(state.payments[0].total.toFixed(2)).toBe("199999999.98");
  });
  it("reports push failure while preserving the committed fee", async () => {
    mocks.push.mockResolvedValue({ total: 1, sent: 0, failed: 1, deactivated: 0 });
    expect(await change({ action: "fee", expectedVersion: 1, amount: "20", effectiveMonth: "2026-11" })).toMatchObject({ ok: true, warning: expect.any(String) });
    expect(state.fees[1].amount.toFixed(2)).toBe("20.00");
    expect(state.version).toBe(2);
  });
  it("does not notify or write a revision when a fee remains the same", async () => {
    await change({ action: "fee", expectedVersion: 1, amount: "10.00", effectiveMonth: "2026-11" });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(state.version).toBe(1);
  });
});

describe("trial setup and activation eligibility", () => {
  it("allows manual trial extension and paid conversion with change notifications", async () => {
    state.mode = "trial"; state.firstBillingMonth = null; state.fees = [];
    await change({ action: "trial", expectedVersion: 1, trialEndDate: "2026-12-31" });
    expect(state.trialEndDate).toBe("2026-12-31");
    await change({ action: "start_paid", expectedVersion: 2, firstBillingMonth: "2027-01", amount: "15.50" });
    expect(state).toMatchObject({ mode: "paid", trialEndDate: null, firstBillingMonth: "2027-01", payments: [] });
    expect(mocks.push).toHaveBeenCalledTimes(2);
    await expect(change({ action: "trial", expectedVersion: 3, trialEndDate: null })).rejects.toThrow(/не може/);
  });
  it("rejects subscription changes for demo clubs and missing clubs", async () => {
    billingStatus = "demo";
    await expect(change(pay())).rejects.toThrow(/Първо активирайте/);
    mocks.$queryRaw.mockResolvedValue([]);
    await expect(change(pay())).rejects.toThrow(/не е намерен/);
    expect(mocks.clubSubscriptionPayment.create).not.toHaveBeenCalled();
  });
  it("defaults first activation to an unlimited trial for older API clients", async () => {
    billingStatus = "demo";
    mocks.club.findUniqueOrThrow.mockResolvedValue({ billingStatus, defaultPaymentAmount: decimal("60"), platformSubscription: null });
    const response = await activate(request({ firstBillingMonth: "2026-10", playerStatus: "keep" }), { params: Promise.resolve({ id: clubId }) });
    expect(response.status).toBe(200);
    expect(mocks.clubSubscription.create.mock.calls[0][0].data).toMatchObject({ clubId, mode: "trial", trialEndDate: null, firstBillingMonth: null });
    expect(mocks.player.updateMany).toHaveBeenNthCalledWith(2, { where: { clubId, isActive: true }, data: { firstBillingMonth: new Date("2026-10-01T00:00:00Z") } });
  });
  it.each([
    { mode: "trial", trialEndDate: null },
    { mode: "trial", trialEndDate: "2026-12-31" },
    { mode: "paid", firstBillingMonth: "2026-11", amount: "25" },
  ])("notifies the main club inbox and devices on initial activation: %j", async (subscription) => {
    mocks.club.findUniqueOrThrow.mockResolvedValue({ billingStatus: "demo", defaultPaymentAmount: decimal("60"), platformSubscription: null });
    mocks.push.mockResolvedValue({ total: 0, sent: 0, failed: 0, deactivated: 0 });
    const response = await activate(request({ firstBillingMonth: "2026-10", subscription }), { params: Promise.resolve({ id: clubId }) });
    expect(response.status).toBe(200);
    expect(mocks.adminNotification.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      clubId, type: "myteam_message", coachGroupId: null, playerId: null,
      url: `/admin/members?clubId=${clubId}`,
    }) });
    expect(mocks.events).toHaveBeenCalledExactlyOnceWith(clubId);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(clubId, expect.objectContaining({ title: expect.any(String), body: expect.any(String) }), null);
  });
  it("does not deliver activation notifications before the transaction commits", async () => {
    mocks.club.findUniqueOrThrow.mockResolvedValue({ billingStatus: "demo", defaultPaymentAmount: decimal("60"), platformSubscription: null });
    mocks.$transaction.mockImplementation(async (callback) => {
      await callback(mocks);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.events).not.toHaveBeenCalled();
      throw new Error("Commit failed");
    });
    const response = await activate(request({ firstBillingMonth: "2026-10" }), { params: Promise.resolve({ id: clubId }) });
    expect(response.status).toBe(500);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
  });
  it("validates explicit subscription setup before changing club or player billing", async () => {
    mocks.club.findUniqueOrThrow.mockResolvedValue({ billingStatus: "demo", defaultPaymentAmount: decimal("60"), platformSubscription: null });
    const response = await activate(request({ firstBillingMonth: "2026-10", subscription: { mode: "trial" } }), { params: Promise.resolve({ id: clubId }) });
    expect(response.status).toBe(400);
    expect(mocks.club.update).not.toHaveBeenCalled();
    expect(mocks.player.updateMany).not.toHaveBeenCalled();
  });
  it("creates paid setup atomically and preserves subscriptions on repeat activation", async () => {
    mocks.club.findUniqueOrThrow.mockResolvedValueOnce({ billingStatus: "demo", defaultPaymentAmount: decimal("60"), platformSubscription: null });
    const response = await activate(request({ firstBillingMonth: "2026-10", subscription: { mode: "paid", firstBillingMonth: "2026-11", amount: "25" } }), { params: Promise.resolve({ id: clubId }) });
    expect(response.status).toBe(200);
    expect(mocks.clubSubscription.create.mock.calls[0][0].data).toMatchObject({ mode: "paid", firstBillingMonth: "2026-11", fees: { create: { amount: "25.00", effectiveMonth: "2026-11" } } });
    const repeated = await activate(request({ firstBillingMonth: "2026-12", confirm: "override", subscription: { mode: "trial", trialEndDate: null } }), { params: Promise.resolve({ id: clubId }) });
    expect(repeated.status).toBe(200);
    expect(mocks.clubSubscription.create).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.adminNotification.create).toHaveBeenCalledTimes(1);
  });
});

describe("subscription API authorization and validation", () => {
  it.each(["GET", "POST", "activate"])("rejects missing sessions and coach-only users for %s", async (handler) => {
    const call = () => handler === "GET" ? GET(request()) : handler === "POST" ? POST(request(pay()), { params: Promise.resolve({ clubId }) }) : activate(request({ firstBillingMonth: "2026-10" }), { params: Promise.resolve({ id: clubId }) });
    mocks.auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.auth.mockResolvedValue({ roles: ["coach"], sub: "coach" });
    expect((await call()).status).toBe(403);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
  it("returns a conflict for stale payment data and rejects non-object bodies", async () => {
    expect((await POST(request(pay({ expectedVersion: 99 })), { params: Promise.resolve({ clubId }) })).status).toBe(409);
    expect((await POST(request([]), { params: Promise.resolve({ clubId }) })).status).toBe(400);
    expect((await POST(request(pay()), { params: Promise.resolve({ clubId: "bad" }) })).status).toBe(400);
  });
  it("returns only server-calculated outstanding amounts", async () => {
    await change(pay());
    mocks.club.findMany.mockResolvedValue([{ id: clubId, name: "Club", billingStatus, platformSubscription: { ...state, payments: state.payments.map((p) => ({ ...p, createdAt: new Date() })) } }]);
    const response = await GET(request());
    const [club] = await response.json();
    expect(club.summary).toMatchObject({ outstandingTotal: "10.00", outstanding: [{ month: "2026-10", amount: "10.00" }], paidThrough: "2026-09" });
    expect(summarizeSubscription(club.billingStatus, club.subscription, "2026-10-24")).toEqual(club.summary);
  });
});


describe("subscription messages in the club notification inbox", () => {
  it("stores a correction listing reopened months and sends it once without devices", async () => {
    mocks.push.mockResolvedValue({ total: 0, sent: 0, failed: 0, deactivated: 0 });
    await change(pay());
    mocks.adminNotification.create.mockClear(); mocks.push.mockClear(); mocks.events.mockClear();
    await change({ action: "void", expectedVersion: 2, paymentId });
    await change({ action: "void", expectedVersion: 3, paymentId });
    expect(mocks.adminNotification.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      clubId, coachGroupId: null, type: "myteam_message", title: "Анулирано плащане за MyTeam",
      body: expect.stringContaining("2026-09, 2026-11"),
    }) });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(clubId, expect.objectContaining({ title: "Анулирано плащане за MyTeam" }), null);
    expect(mocks.events).toHaveBeenCalledTimes(1);
  });

  it("stores a payment receipt without push devices and does not duplicate it on retry", async () => {
    mocks.push.mockResolvedValue({ total: 0, sent: 0, failed: 0, deactivated: 0 });
    const input = pay();
    await change(input);
    await change(input);
    expect(mocks.adminNotification.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      clubId, type: "myteam_message", coachGroupId: null, playerId: null,
      title: "Платен абонамент за MyTeam — получено плащане",
      body: expect.stringContaining("20.00 EUR"), url: `/admin/members?clubId=${clubId}`,
    }) });
    const body = mocks.adminNotification.create.mock.calls[0][0].data.body;
    expect(body).toContain("2026-09, 2026-11");
    expect(body).toContain("24.10.2026");
    expect(body).not.toContain("Bank transfer");
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(clubId, expect.objectContaining({ body }), null);
    expect(mocks.events).toHaveBeenCalledExactlyOnceWith(clubId);
  });

  it("does not generate duplicate trial messages when dates are unchanged", async () => {
    state.mode = "trial"; state.firstBillingMonth = null; state.fees = [];
    await change({ action: "trial", expectedVersion: 1, trialEndDate: null });
    expect(state.version).toBe(1);
    expect(mocks.adminNotification.create).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("notifies when a limited trial is extended or made unlimited", async () => {
    state.mode = "trial"; state.firstBillingMonth = null; state.fees = []; state.trialEndDate = "2026-10-31";
    await change({ action: "trial", expectedVersion: 1, trialEndDate: "2026-12-31" });
    expect(mocks.adminNotification.create.mock.calls[0][0].data.body).toContain("31.10.2026");
    expect(mocks.adminNotification.create.mock.calls[0][0].data.body).toContain("31.12.2026");
    await change({ action: "trial", expectedVersion: 2, trialEndDate: null });
    expect(mocks.adminNotification.create.mock.calls[1][0].data.body).toContain("без крайна дата");
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });
  it("does not publish or send when the transactional inbox write fails", async () => {
    mocks.adminNotification.create.mockRejectedValue(new Error("Inbox write failed"));
    await expect(change({ action: "fee", expectedVersion: 1, effectiveMonth: "2026-11", amount: "25" })).rejects.toThrow("Inbox write failed");
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("notifies and persists an unlimited-to-limited trial change even without push devices", async () => {
    state.mode = "trial"; state.firstBillingMonth = null; state.fees = [];
    mocks.push.mockResolvedValue({ total: 0, sent: 0, failed: 0, deactivated: 0 });
    await change({ action: "trial", expectedVersion: 1, trialEndDate: "2026-12-31" });
    expect(mocks.adminNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      clubId, type: "myteam_message", coachGroupId: null, playerId: null,
      title: "Промяна на пробния период за MyTeam", body: expect.stringContaining("31.12.2026"), url: `/admin/members?clubId=${clubId}`,
    }) });
    expect(mocks.push).toHaveBeenCalledWith(clubId, expect.objectContaining({ title: "Промяна на пробния период за MyTeam" }), null);
    expect(mocks.events).toHaveBeenCalledWith(clubId);
  });
  it("notifies and persists trial-to-paid conversion with the fee and first billable month", async () => {
    state.mode = "trial"; state.firstBillingMonth = null; state.fees = [];
    mocks.push.mockResolvedValue({ total: 0, sent: 0, failed: 0, deactivated: 0 });
    await change({ action: "start_paid", expectedVersion: 1, firstBillingMonth: "2026-11", amount: "25.50" });
    expect(mocks.adminNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      clubId, type: "myteam_message", coachGroupId: null, playerId: null,
      title: "Платен абонамент за MyTeam", body: expect.stringContaining("25.50 EUR"), url: `/admin/members?clubId=${clubId}`,
    }) });
    expect(mocks.adminNotification.create.mock.calls[0][0].data.body).toContain("2026-11");
    expect(mocks.push).toHaveBeenCalledWith(clubId, expect.objectContaining({ title: "Платен абонамент за MyTeam" }), null);
  });
  it("keeps fee changes in the inbox when push delivery fails", async () => {
    mocks.push.mockResolvedValue({ total: 1, sent: 0, failed: 1, deactivated: 0 });
    await change({ action: "fee", expectedVersion: 1, effectiveMonth: "2026-11", amount: "25" });
    expect(mocks.adminNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      clubId, type: "myteam_message", coachGroupId: null, playerId: null, body: expect.stringContaining("25.00 EUR"),
    }) });
  });
});
