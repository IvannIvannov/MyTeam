import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/members/[cardCode]/training/route";
import { GET as report } from "@/app/api/admin/clubs/[id]/training-attendance/report/route";
import { GET as attendance } from "@/app/api/admin/clubs/[id]/training-attendance/route";

const mocks = vi.hoisted(() => ({
  card: { findFirst: vi.fn() },
  club: { findUnique: vi.fn() },
  coachGroup: { findFirst: vi.fn() },
  player: { findMany: vi.fn() },
  trainingSession: { findMany: vi.fn(), findFirst: vi.fn() },
  trainingSessionPlayer: { upsert: vi.fn() },
  trainingOptOut: { findMany: vi.fn(), upsert: vi.fn() },
  trainingNote: { findMany: vi.fn() },
  limitedTrainingEvent: { findMany: vi.fn() },
  field: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["admin"] }) }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/push/adminHistory", () => ({ saveAdminNotificationHistory: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
vi.mock("@/lib/trainingSessions", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/trainingSessions")>(), updateTrainingSessionPlayerAttendance: vi.fn() }));

const clubId = "10000000-0000-4000-8000-000000000001";
const groupId = "10000000-0000-4000-8000-000000000002";
const playerId = "10000000-0000-4000-8000-000000000003";
const firstId = "10000000-0000-4000-8000-000000000004";
const secondId = "10000000-0000-4000-8000-000000000005";
const scopeKey = `coach_group:${groupId}`;
const date = "2026-10-12";
const context = { params: Promise.resolve({ cardCode: "CARD" }) };
const session = (id: string, time: string, present: boolean) => ({ id, status: "scheduled", createdAt: new Date(id === firstId ? "2026-10-01T00:00:00Z" : "2026-10-02T00:00:00Z"), scopeId: groupId, scopeType: "coachGroup", scopeKey, trainingDate: new Date(`${date}T00:00:00Z`), trainingTime: time, trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], note: id === firstId ? "Morning note" : "Evening note", players: [{ playerId, playerName: "Player", teamGroup: null, player: { cards: [] }, present, reasonCode: present ? null : "sick", reasonText: null }] });

describe("coach training API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T07:00:00Z"));
    const schedule = { trainingDates: [date], trainingDateTimes: { [date]: "09:00" }, trainingTime: "09:00", trainingDurationMinutes: 60, trainingWeekdays: [], trainingWindowDays: 30, trainingFieldId: null, trainingFieldPieceIds: [], trainingFieldSelections: null };
    mocks.card.findFirst.mockResolvedValue({ cardCode: "CARD", playerId, player: { id: playerId, fullName: "Player", clubId, teamGroup: null, club: { id: clubId, sports: [], trainingGroupMode: "team_group", ...schedule }, customTrainingGroups: [], coachGroups: [{ id: groupId, ...schedule }] } });
    mocks.trainingSession.findMany.mockImplementation(async (args) => args.where.status === "cancelled" ? [] : [session(firstId, "09:00", false), session(secondId, "18:00", true)]);
    mocks.trainingSession.findFirst.mockResolvedValue(session(secondId, "18:00", true));
    mocks.trainingSessionPlayer.upsert.mockResolvedValue({});
    mocks.trainingOptOut.findMany.mockResolvedValue([{ trainingDate: new Date(`${date}T00:00:00Z`), playerId, reasonCode: "sick", reasonText: null }]);
    mocks.trainingNote.findMany.mockResolvedValue([]);
    mocks.limitedTrainingEvent.findMany.mockResolvedValue([]);
    mocks.club.findUnique.mockResolvedValue({ id: clubId, trainingDates: [], trainingWeekdays: [], trainingGroupMode: "team_group" });
    mocks.coachGroup.findFirst.mockResolvedValue({ id: groupId });
    mocks.player.findMany.mockResolvedValue([{ id: playerId, fullName: "Player", teamGroup: null }]);
    mocks.$transaction.mockImplementation(async (callback) => callback(mocks));
  });
  afterEach(() => vi.useRealTimers());
  it("returns separate session IDs, notes, and attendance despite a legacy day absence", async () => {
    const response = await GET(new NextRequest("http://localhost/api/members/CARD/training"), context);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.dates).toHaveLength(1);
    expect(data.dates[0].sessions).toMatchObject([{ id: firstId, trainingTime: "09:00", optedOut: true, note: "Morning note" }, { id: secondId, trainingTime: "18:00", optedOut: false, note: "Evening note" }]);
    expect(data.dates[0].optedOut).toBe(false);
  });
  it("updates only the selected session and never writes a day-wide opt-out", async () => {
    const response = await POST(new NextRequest("http://localhost/api/members/CARD/training", { method: "POST", body: JSON.stringify({ trainingSessionId: secondId, reasonCode: "sick" }) }), context);
    expect(response.status).toBe(200);
    expect(mocks.trainingSessionPlayer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { trainingSessionId_playerId: { trainingSessionId: secondId, playerId } }, update: { present: false, reasonCode: "sick", reasonText: null, attendanceRecorded: true } }));
    expect(mocks.trainingOptOut.upsert).not.toHaveBeenCalled();
    expect(mocks.trainingSession.findFirst.mock.calls[0][0].where.scopeId).toEqual({ in: [groupId] });
  });
  it("shows coach trainings alongside custom-group trainings, including different dates", async () => {
    const card = await mocks.card.findFirst();
    card.player.club.trainingGroupMode = "custom_group";
    card.player.customTrainingGroups = [{ group: { ...card.player.coachGroups[0], id: "custom", coachGroupId: groupId, trainingDates: [date, "2026-10-13"], trainingTime: "12:00", trainingDateTimes: {} } }];
    const response = await GET(new NextRequest("http://localhost/api/members/CARD/training"), context);
    const data = await response.json();
    expect(data.dates.map((day: { date: string }) => day.date)).toEqual([date, "2026-10-13"]);
    expect(data.dates[0].sessions).toMatchObject([
      { id: firstId, trainingTime: "09:00", optedOut: true },
      { scopeKey: "custom_group:custom", trainingTime: "12:00", optedOut: true },
      { id: secondId, trainingTime: "18:00", optedOut: false },
    ]);
    expect(data.dates[1].sessions).toHaveLength(1);
    expect(data.dates[1].sessions[0]).toMatchObject({ scopeKey: "custom_group:custom", optedOut: false });
    const legacyResponse = await POST(new NextRequest("http://localhost/training", { method: "POST", body: JSON.stringify({ trainingDate: date, reasonCode: "sick" }) }), context);
    expect(legacyResponse.status).toBe(200);
    expect(mocks.trainingOptOut.upsert).toHaveBeenCalledOnce();
    expect(mocks.trainingSessionPlayer.upsert).not.toHaveBeenCalled();
  });
  it("keeps coach-only dates visible when a custom schedule uses another date", async () => {
    const card = await mocks.card.findFirst();
    card.player.club.trainingGroupMode = "custom_group";
    card.player.customTrainingGroups = [{ group: { ...card.player.coachGroups[0], id: "custom", coachGroupId: groupId, trainingDates: ["2026-10-13"], trainingWeekdays: [] } }];
    const response = await GET(new NextRequest("http://localhost/api/members/CARD/training"), context);
    const data = await response.json();
    expect(data.dates.map((day: { date: string }) => day.date)).toEqual([date, "2026-10-13"]);
    expect(data.dates[0].sessions.map((s: { id: string }) => s.id)).toEqual([firstId, secondId]);
    expect(data.dates[1].sessions).toHaveLength(1);
  });
  it("requires session identity and rejects another group's session", async () => {
    let response = await POST(new NextRequest("http://localhost/training", { method: "POST", body: JSON.stringify({ trainingDate: date, reasonCode: "sick" }) }), context);
    expect(response.status).toBe(400);
    mocks.trainingSession.findFirst.mockResolvedValue(null);
    response = await POST(new NextRequest("http://localhost/training", { method: "POST", body: JSON.stringify({ trainingSessionId: secondId, reasonCode: "sick" }) }), context);
    expect(response.status).toBe(404);
    expect(mocks.trainingSessionPlayer.upsert).not.toHaveBeenCalled();
  });
  it("reports one attendance column per training, so one of two attended is 50 percent", async () => {
    const request = new NextRequest(`http://localhost/report?coachGroupId=${groupId}&from=${date}&to=${date}`, { headers: { cookie: "admin_session=test" } });
    const response = await report(request, { params: Promise.resolve({ id: clubId }) });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.trainingDates).toHaveLength(2);
    expect(data.trainingDates[0]).toContain(firstId);
    expect(data.trainingDates[1]).toContain(secondId);
    expect(Object.values(data.players[0].attendance)).toEqual([{ present: false, reasonCode: "sick" }, { present: true, reasonCode: null }]);
    expect(mocks.trainingSession.findMany.mock.calls[0][0].where.scopeKey).toBe(scopeKey);
  });
  it("the original details screen reads attendance and notes for the selected session", async () => {
    const response = await attendance(new NextRequest(`http://localhost/attendance?trainingSessionId=${secondId}`, { headers: { cookie: "admin_session=test" } }), { params: Promise.resolve({ id: clubId }) });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ trainingSessionId: secondId, trainingTime: "18:00", note: "Evening note", stats: { total: 1, attending: 1, optedOut: 0 } });
    expect(data.players[0]).toMatchObject({ id: playerId, fullName: "Player", optedOut: false });
    expect(data.upcomingDates).toMatchObject([{ date, sessions: [{ id: firstId }, { id: secondId }] }]);
    expect(mocks.trainingSession.findFirst.mock.calls[0][0].where).toMatchObject({ id: secondId, clubId, scopeType: "coachGroup" });
  });
  it("loads all coach sessions for the calendar independently of the old custom-group dates", async () => {
    mocks.trainingSession.findMany.mockResolvedValue([session(firstId, "09:00", false), { ...session(secondId, "18:00", true), trainingDate: new Date("2026-10-13T00:00:00Z") }]);
    const response = await attendance(new NextRequest(`http://localhost/attendance?coachGroupId=${groupId}&month=2026-10`, { headers: { cookie: "admin_session=test" } }), { params: Promise.resolve({ id: clubId }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.upcomingDates.map((day: { date: string }) => day.date)).toEqual([date, "2026-10-13"]);
    expect(data.trainingSessionId).toBe(firstId);
    expect(mocks.trainingSession.findMany.mock.calls[0][0].where).toMatchObject({ clubId, scopeId: groupId, scopeType: "coachGroup", status: "scheduled" });
  });
});
