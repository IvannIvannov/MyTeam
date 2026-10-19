import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), card: { findFirst: vi.fn() }, player: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  trainingSessionPlayer: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, trainingOptOut: { deleteMany: vi.fn() },
  coachGroup: { findMany: vi.fn() }, clubCustomTrainingGroup: { findMany: vi.fn() }, clubTrainingScheduleGroup: { findMany: vi.fn() },
  query: vi.fn(), transaction: vi.fn(), notify: vi.fn(), publish: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { ...mocks, $transaction: mocks.transaction } }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: mocks.publish }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: mocks.publish }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: mocks.notify }));

const playerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const clubId = "10000000-0000-4000-8000-000000000003";
const context = { params: Promise.resolve({ cardCode: " card " }) };
const request = (method = "GET", body?: unknown) => new NextRequest("http://localhost/api/members/CARD/training-credit/check-in", { method, headers: { cookie: "admin_session=token", "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body ?? { trainingSessionId: sessionId }) } : {}) });

describe("training check-in API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    mocks.auth.mockResolvedValue({ sub: "coach", roles: ["coach"] });
    mocks.card.findFirst.mockResolvedValue({ playerId, player: { clubId, club: { name: "Club", paymentWorkflow: "training_credits" } } });
    mocks.player.findUniqueOrThrow.mockResolvedValue({ id: playerId, clubId, fullName: "Player", remainingTrainingCredits: 1, status: "paid", club: { paymentWorkflow: "training_credits" }, paymentLogs: [] });
    mocks.player.update.mockResolvedValue({ id: playerId, clubId, fullName: "Player", remainingTrainingCredits: 0, status: "overdue" });
    mocks.trainingSessionPlayer.findUnique.mockResolvedValue({ id: "attendance", present: false, creditChargedAt: null, trainingSession: { id: sessionId, clubId, scopeType: "coachGroup", status: "scheduled", trainingDate: new Date("2026-10-19T00:00:00Z"), trainingTime: "19:00" } });
    mocks.trainingSessionPlayer.findMany.mockResolvedValue([{ trainingSessionId: sessionId, reasonCode: "sick", reasonText: null, creditChargedAt: null, trainingSession: { trainingDate: new Date("2026-10-19T00:00:00Z"), trainingTime: "19:00", scopeKey: "coach_group:group", teamGroup: null } }]);
    mocks.coachGroup.findMany.mockResolvedValue([{ id: "group", name: "Group A" }]);
    mocks.clubCustomTrainingGroup.findMany.mockResolvedValue([]); mocks.clubTrainingScheduleGroup.findMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback) => callback({ ...mocks, $queryRaw: mocks.query }));
    mocks.query.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());
  it("requires coach/admin authentication for both operations", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(401);
    expect((await POST(request("POST"), context)).status).toBe(401);
    expect(mocks.card.findFirst).not.toHaveBeenCalled();
  });
  it("lists only absent player rows in today's and the preceding three dates", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ trainings: [{ id: sessionId, date: "2026-10-19", time: "19:00", groupName: "Group A", reasonCode: "sick" }] });
    expect(mocks.trainingSessionPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { playerId, present: false, trainingSession: { clubId, status: "scheduled", trainingDate: { gte: new Date("2026-10-16T00:00:00Z"), lte: new Date("2026-10-19T00:00:00Z") } } } }));
  });
  it("handles an empty picker without spending credits", async () => {
    mocks.trainingSessionPlayer.findMany.mockResolvedValue([]);
    expect(await (await GET(request(), context)).json()).toEqual({ trainings: [] });
    expect(mocks.player.update).not.toHaveBeenCalled();
  });
  it("requires an explicit valid session selection", async () => {
    expect((await POST(request("POST", {}), context)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects calendar-month clubs without changing attendance or charging credits", async () => {
    const card = await mocks.card.findFirst(); card.player.club.paymentWorkflow = "calendar_month";
    const player = await mocks.player.findUniqueOrThrow(); player.club.paymentWorkflow = "calendar_month";
    expect((await GET(request(), context)).status).toBe(400);
    expect((await POST(request("POST"), context)).status).toBe(400);
    expect(mocks.player.update).not.toHaveBeenCalled();
    expect(mocks.trainingSessionPlayer.update).not.toHaveBeenCalled();
  });
  it("records today's future training and spends the last credit within one locked transaction", async () => {
    const response = await POST(request("POST"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ remainingTrainingCredits: 0, status: "overdue", charged: true });
    expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.query.mock.calls.map(([sql]) => sql.join("?")).every((sql) => sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(mocks.query.mock.invocationCallOrder[2]).toBeLessThan(mocks.player.findUniqueOrThrow.mock.invocationCallOrder[0]);
    expect(mocks.trainingSessionPlayer.update).toHaveBeenCalledOnce();
  });
  it("makes repeated confirmations a no-op without duplicate notifications", async () => {
    const row = await mocks.trainingSessionPlayer.findUnique(); row.present = true; row.creditChargedAt = new Date();
    const response = await POST(request("POST"), context);
    expect(response.status).toBe(200); expect((await response.json()).charged).toBe(false);
    expect(mocks.player.update).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("rejects a training belonging to a different club or player", async () => {
    const row = await mocks.trainingSessionPlayer.findUnique(); row.trainingSession.clubId = "other";
    expect((await POST(request("POST"), context)).status).toBe(409);
    mocks.trainingSessionPlayer.findUnique.mockResolvedValue(null);
    expect((await POST(request("POST"), context)).status).toBe(409);
    expect(mocks.player.update).not.toHaveBeenCalled();
  });
});
