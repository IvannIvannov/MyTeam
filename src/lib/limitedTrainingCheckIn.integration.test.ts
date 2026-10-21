import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as reserve, DELETE as cancel } from "@/app/api/members/[cardCode]/training/register/route";
import { GET as listCheckIns, POST as checkIn } from "@/app/api/members/[cardCode]/training-credit/check-in/route";

const mocks = vi.hoisted(() => ({
  card: { findFirst: vi.fn() }, club: { findUniqueOrThrow: vi.fn() },
  player: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  trainingSession: { findFirst: vi.fn() }, trainingSessionPlayer: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  trainingOptOut: { deleteMany: vi.fn(), upsert: vi.fn() }, limitedTrainingEvent: { findFirst: vi.fn() },
  limitedTrainingRegistration: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  coachGroup: { findMany: vi.fn() }, clubCustomTrainingGroup: { findMany: vi.fn(), findUnique: vi.fn() }, clubTrainingScheduleGroup: { findMany: vi.fn() },
  $transaction: vi.fn(), $queryRaw: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn() }));
vi.mock("@/lib/push/adminHistory", () => ({ saveAdminNotificationHistory: vi.fn() }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: vi.fn() }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: vi.fn().mockReturnValue({}) }));

const clubId = "10000000-0000-4000-8000-000000000001";
const groupId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const playerId = "10000000-0000-4000-8000-000000000004";
const otherId = "10000000-0000-4000-8000-000000000005";
const date = "2026-10-19";
const training = { id: sessionId, clubId, scopeType: "coachGroup", scopeId: groupId, scopeKey: `coach_group:${groupId}`, trainingDate: new Date(`${date}T00:00:00Z`), trainingTime: "19:00", teamGroup: null, status: "scheduled" };
const context = (cardCode = "CARD") => ({ params: Promise.resolve({ cardCode }) });
const registrationRequest = (method: string) => new NextRequest("http://localhost/api/members/CARD/training/register", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trainingDate: date, limitedEventId: "event" }) });
const checkInRequest = (method = "GET") => new NextRequest("http://localhost/api/members/CARD/training-credit/check-in", { method, headers: { cookie: "admin_session=coach", "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ trainingSessionId: sessionId }) } : {}) });

describe("limited-place reservation → training-credit check-in", () => {
  let registrations: string[];
  let workflow: string;
  let credits: number;
  let attendance: { id: string; playerId: string; trainingSessionId: string; present: boolean; creditChargedAt: Date | null; attendanceRecorded: boolean; reasonCode: string | null; reasonText: string | null; trainingSession: typeof training };
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    registrations = []; workflow = "training_credits"; credits = 2;
    attendance = { id: "attendance", playerId, trainingSessionId: sessionId, present: false, creditChargedAt: null, attendanceRecorded: false, reasonCode: null, reasonText: null, trainingSession: training };
    const player = (id = playerId) => ({ id, clubId, fullName: "Player", teamGroup: null, remainingTrainingCredits: credits, status: credits ? "paid" : "overdue", club: { name: "Club", paymentWorkflow: workflow }, customTrainingGroups: [], coachGroups: [{ id: groupId }], paymentLogs: [{ paidFor: new Date("2026-10-01T00:00:00Z") }] });
    mocks.card.findFirst.mockImplementation(async (args) => { const id = args.where.cardCode === "OTHER" ? otherId : playerId; return { cardCode: args.where.cardCode, playerId: id, player: player(id) }; });
    mocks.club.findUniqueOrThrow.mockImplementation(async () => ({ paymentWorkflow: workflow }));
    mocks.player.findMany.mockImplementation(async (args) => args.where.id.in.map((id: string) => player(id)));
    mocks.player.findUnique.mockResolvedValue({ cards: [{ cardCode: "CARD" }] });
    mocks.player.findUniqueOrThrow.mockImplementation(async () => player());
    mocks.player.update.mockImplementation(async () => { credits--; return player(); });
    mocks.trainingSession.findFirst.mockResolvedValue(training);
    mocks.trainingSessionPlayer.createMany.mockResolvedValue({ count: 0 });
    mocks.trainingSessionPlayer.updateMany.mockImplementation(async (args) => { if (args.where.playerId.in.includes(playerId)) Object.assign(attendance, args.data); return { count: 1 }; });
    mocks.trainingSessionPlayer.findMany.mockImplementation(async () => attendance.present ? [] : [{ ...attendance }]);
    mocks.trainingSessionPlayer.findUnique.mockImplementation(async () => ({ ...attendance }));
    mocks.trainingSessionPlayer.update.mockImplementation(async (args) => Object.assign(attendance, args.data));
    mocks.limitedTrainingEvent.findFirst.mockResolvedValue({ id: "event", scopeKey: `${training.scopeKey}:session:${sessionId}`, maxSpots: 1 });
    mocks.limitedTrainingRegistration.findFirst.mockImplementation(async (args) => registrations.includes(args.where.playerId) ? { id: "registration" } : null);
    mocks.limitedTrainingRegistration.create.mockImplementation(async (args) => { registrations.push(args.data.playerId); return { id: "registration" }; });
    mocks.limitedTrainingRegistration.findMany.mockImplementation(async () => registrations.map((id) => ({ playerId: id })));
    mocks.limitedTrainingRegistration.deleteMany.mockImplementation(async (args) => { registrations = registrations.filter((id) => id !== args.where.playerId); return { count: 1 }; });
    mocks.coachGroup.findMany.mockResolvedValue([{ id: groupId, name: "Group A" }]);
    mocks.clubCustomTrainingGroup.findMany.mockResolvedValue([]); mocks.clubTrainingScheduleGroup.findMany.mockResolvedValue([]);
    mocks.$transaction.mockImplementation(async (callback) => callback(mocks));
  });
  afterEach(() => vi.useRealTimers());
  it("rejects new reservations on a locked historical roster before writing registrations", async () => {
    mocks.trainingSession.findFirst.mockResolvedValue({ ...training, rosterLockedAt: new Date(), players: [] });
    expect((await reserve(registrationRequest("POST"), context())).status).toBe(403);
    expect(mocks.limitedTrainingRegistration.create).not.toHaveBeenCalled();
    expect(mocks.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
  });
  it("allows an existing locked roster member to reserve and cancel without creating attendance", async () => {
    mocks.trainingSession.findFirst.mockResolvedValue({ ...training, rosterLockedAt: new Date(), players: [{ playerId }] });
    expect((await reserve(registrationRequest("POST"), context())).status).toBe(200);
    expect(mocks.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
    expect((await cancel(registrationRequest("DELETE"), context())).status).toBe(200);
    expect(mocks.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
    expect(credits).toBe(2);
  });

  it.each(["training_credits", "training_credits_30_days"])("a confirmed %s reservation remains selectable and charges once on check-in", async (paymentWorkflow) => {
    workflow = paymentWorkflow;
    const reserved = await reserve(registrationRequest("POST"), context());
    expect((await reserved.json()).isConfirmed).toBe(true);
    expect(attendance.present).toBe(false); expect(attendance.attendanceRecorded).toBe(false); expect(credits).toBe(2);
    expect((await (await listCheckIns(checkInRequest(), context())).json()).trainings).toHaveLength(1);
    expect((await checkIn(checkInRequest("POST"), context())).status).toBe(200);
    expect(attendance.present).toBe(true); expect(attendance.creditChargedAt).toBeInstanceOf(Date); expect(credits).toBe(1);
    await checkIn(checkInRequest("POST"), context()); expect(credits).toBe(1);
    // Cancelling the reservation must not undo a recorded check-in or its charge.
    await cancel(registrationRequest("DELETE"), context());
    expect(attendance.present).toBe(true); expect(credits).toBe(1);
  });

  it.each(["training_credits", "training_credits_30_days"])("waitlist promotion in %s keeps attendance pending until check-in", async (paymentWorkflow) => {
    workflow = paymentWorkflow; registrations = [otherId];
    const waitlisted = await reserve(registrationRequest("POST"), context());
    expect((await waitlisted.json()).isConfirmed).toBe(false);
    await cancel(registrationRequest("DELETE"), context("OTHER"));
    expect(registrations).toEqual([playerId]); expect(attendance.present).toBe(false); expect(credits).toBe(2);
    expect((await (await listCheckIns(checkInRequest(), context())).json()).trainings).toHaveLength(1);
    await checkIn(checkInRequest("POST"), context());
    expect(attendance.present).toBe(true); expect(attendance.attendanceRecorded).toBe(true); expect(credits).toBe(1);
    await checkIn(checkInRequest("POST"), context()); expect(credits).toBe(1);
  });

  it.each(["calendar_month", "rolling_30_days"])("preserves confirmed-registration attendance for %s", async (paymentWorkflow) => {
    workflow = paymentWorkflow;
    expect((await reserve(registrationRequest("POST"), context())).status).toBe(200);
    expect(attendance.present).toBe(true); expect(credits).toBe(2);
    await cancel(registrationRequest("DELETE"), context()); expect(attendance.present).toBe(false);
  });
});
