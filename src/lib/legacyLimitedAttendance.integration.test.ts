import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as reserve, DELETE as cancel } from "@/app/api/members/[cardCode]/training/register/route";
import { GET as memberAttendance } from "@/app/api/members/[cardCode]/training/route";
import { GET as adminAttendance } from "@/app/api/admin/clubs/[id]/training-attendance/route";

const mocks = vi.hoisted(() => ({
  card: { findFirst: vi.fn() }, club: { findUnique: vi.fn() },
  player: { findMany: vi.fn(), findUnique: vi.fn() },
  trainingSession: { findFirst: vi.fn(), findMany: vi.fn() },
  trainingOptOut: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  trainingNote: { findMany: vi.fn(), findFirst: vi.fn() },
  limitedTrainingEvent: { findFirst: vi.fn(), findMany: vi.fn() },
  limitedTrainingRegistration: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  clubCustomTrainingGroup: { findFirst: vi.fn(), findUnique: vi.fn() },
  clubTrainingGroupSchedule: { findUnique: vi.fn() }, clubTrainingScheduleGroup: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn() }));
vi.mock("@/lib/push/adminHistory", () => ({ saveAdminNotificationHistory: vi.fn() }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: vi.fn().mockReturnValue({}) }));

const clubId = "10000000-0000-4000-8000-000000000001";
const groupId = "10000000-0000-4000-8000-000000000002";
const date = "2026-10-19";
const trainingDate = new Date(`${date}T00:00:00Z`);
const request = (method: string) => new NextRequest("http://localhost/register", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trainingDate: date, limitedEventId: "event" }) });
const context = (cardCode: string) => ({ params: Promise.resolve({ cardCode }) });
const schedule = { trainingDates: [date], trainingWeekdays: [], trainingDateTimes: {}, trainingTime: "09:00", trainingDurationMinutes: 60, trainingWindowDays: 30, trainingFieldId: null, trainingFieldPieceIds: [], trainingFieldSelections: null };

describe("legacy non-credit reservations remain authoritative in attendance views", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T07:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it.each([
    ["calendar_month", "team"], ["rolling_30_days", "team"],
    ["calendar_month", "custom"], ["rolling_30_days", "custom"],
  ])("reflects confirmation, cancellation and promotion for %s / %s", async (paymentWorkflow, scope) => {
    const scopeKey = scope === "team" ? "team_group:2015" : `custom_group:${groupId}`;
    const club = { id: clubId, name: "Club", sports: [], paymentWorkflow, trainingGroupMode: scope === "team" ? "team_group" : "custom_group", ...schedule };
    const players = ["CARD", "OTHER"].map((id) => ({ id, fullName: id, clubId, teamGroup: scope === "team" ? 2015 : null, cards: [{ cardCode: id }], club, coachGroups: [], customTrainingGroups: scope === "custom" ? [{ group: { id: groupId, coachGroupId: null, ...schedule } }] : [] }));
    let registrations: string[] = [];
    const absent = new Set(["CARD", "OTHER"]);
    mocks.card.findFirst.mockImplementation(async ({ where }) => ({ cardCode: where.cardCode, playerId: where.cardCode, player: players.find((p) => p.id === where.cardCode) }));
    mocks.club.findUnique.mockResolvedValue(club);
    mocks.player.findMany.mockResolvedValue(players);
    mocks.player.findUnique.mockResolvedValue({ cards: [{ cardCode: "OTHER" }] });
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ id: groupId, ...schedule, players: players.map((p) => ({ playerId: p.id })) });
    mocks.clubCustomTrainingGroup.findUnique.mockResolvedValue({ coachGroupId: null });
    mocks.clubTrainingGroupSchedule.findUnique.mockResolvedValue(schedule);
    mocks.clubTrainingScheduleGroup.findFirst.mockResolvedValue(null);
    mocks.trainingNote.findMany.mockResolvedValue([]); mocks.trainingNote.findFirst.mockResolvedValue(null);
    mocks.limitedTrainingEvent.findFirst.mockResolvedValue({ id: "event", scopeKey, maxSpots: 1 });
    mocks.limitedTrainingEvent.findMany.mockResolvedValue([]);
    mocks.trainingOptOut.findMany.mockImplementation(async ({ where }) => [...absent].filter((id) => typeof where.playerId !== "string" || id === where.playerId).map((playerId) => ({ playerId, trainingDate, reasonCode: "limited_event", reasonText: null })));
    mocks.trainingOptOut.deleteMany.mockImplementation(async ({ where }) => { absent.delete(where.playerId); return { count: 1 }; });
    mocks.trainingOptOut.upsert.mockImplementation(async ({ create }) => { absent.add(create.playerId); });
    mocks.limitedTrainingRegistration.findFirst.mockImplementation(async ({ where }) => registrations.includes(where.playerId) ? { id: "registration" } : null);
    mocks.limitedTrainingRegistration.create.mockImplementation(async ({ data }) => { registrations.push(data.playerId); });
    mocks.limitedTrainingRegistration.findMany.mockImplementation(async () => registrations.map((playerId) => ({ playerId })));
    mocks.limitedTrainingRegistration.deleteMany.mockImplementation(async ({ where }) => { registrations = registrations.filter((id) => id !== where.playerId); });
    mocks.trainingSession.findFirst.mockResolvedValue({ status: "scheduled" });
    // Existing roster defaults remain true throughout; only the established
    // reservation writers change opt-outs for these non-coach scopes.
    mocks.trainingSession.findMany.mockImplementation(async ({ where, select }) => where.status === "cancelled" ? [] : [{
      id: "session", scopeKey, scopeType: scope === "team" ? "teamGroup" : "customGroup", scopeId: scope === "custom" ? groupId : null, createdAt: trainingDate, trainingDate, ...schedule,
      players: players.filter((p) => !select?.players?.where?.playerId || p.id === select.players.where.playerId).map((p) => ({ playerId: p.id, present: true, reasonCode: null, reasonText: null })),
    }]);
    async function assertViews(cardCode: string, optedOut: boolean) {
      const memberResponse = await memberAttendance(new NextRequest("http://localhost/training"), context(cardCode));
      expect(memberResponse.status).toBe(200);
      expect((await memberResponse.json()).dates[0].optedOut).toBe(optedOut);
      const filter = scope === "team" ? "teamGroup=2015" : `customTrainingGroupId=${groupId}`;
      const adminResponse = await adminAttendance(new NextRequest(`http://localhost/training?date=${date}&${filter}`, { headers: { cookie: "admin_session=coach" } }), { params: Promise.resolve({ id: clubId }) });
      expect(adminResponse.status).toBe(200);
      expect((await adminResponse.json()).players.find((p: { id: string }) => p.id === cardCode).optedOut).toBe(optedOut);
    }
    await assertViews("CARD", true);
    expect((await reserve(request("POST"), context("CARD"))).status).toBe(200);
    await assertViews("CARD", false);
    const waitlisted = await reserve(request("POST"), context("OTHER"));
    expect((await waitlisted.json()).isConfirmed).toBe(false); await assertViews("OTHER", true);
    expect((await cancel(request("DELETE"), context("CARD"))).status).toBe(200);
    await assertViews("CARD", true); await assertViews("OTHER", false);
  });
});
