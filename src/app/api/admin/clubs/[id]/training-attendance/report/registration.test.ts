import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), club: vi.fn(), coach: vi.fn(), player: vi.fn(), players: vi.fn(),
  schedule: vi.fn(), combined: vi.fn(), custom: vi.fn(), customGroups: vi.fn(),
  sessions: vi.fn(), optOuts: vi.fn(),
}));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: {
  club: { findUnique: mocks.club }, coachGroup: { findFirst: mocks.coach },
  player: { findFirst: mocks.player, findMany: mocks.players },
  clubTrainingGroupSchedule: { findUnique: mocks.schedule },
  clubTrainingScheduleGroup: { findFirst: mocks.combined },
  clubCustomTrainingGroup: { findFirst: mocks.custom, findMany: mocks.customGroups },
  trainingSession: { findMany: mocks.sessions }, trainingOptOut: { findMany: mocks.optOuts },
} }));

// Registration is at 15:00 Sofia time; same-day sessions straddle it.
const newPlayer = { id: "new-player", fullName: "New player", teamGroup: 2012,
  createdAt: new Date("2026-10-20T12:00:00Z") };

async function report(query: string) {
  const response = await GET(new NextRequest(
    `http://localhost/api/admin/clubs/club-1/training-attendance/report?from=2026-10-01&to=2026-10-21&${query}`,
    { headers: { cookie: "admin_session=test" } },
  ), { params: Promise.resolve({ id: "club-1" }) });
  expect(response.status).toBe(200);
  return response.json();
}

describe("attendance eligibility from player registration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ roles: ["admin"] });
    mocks.club.mockResolvedValue({ id: "club-1", trainingGroupMode: "team_group", trainingDates: [], trainingWeekdays: [] });
    mocks.coach.mockResolvedValue({ id: "coach-1" });
    mocks.player.mockResolvedValue(newPlayer);
    mocks.players.mockResolvedValue([newPlayer]);
    mocks.schedule.mockResolvedValue({ trainingDates: ["2026-10-02", "2026-10-21"], trainingWeekdays: [] });
    mocks.combined.mockResolvedValue(null);
    mocks.custom.mockResolvedValue(null);
    mocks.customGroups.mockResolvedValue([]);
    mocks.sessions.mockResolvedValue([]);
    mocks.optOuts.mockResolvedValue([]);
  });

  it.each(["teamGroup=2012", "playerId=new-player"])("excludes pre-registration legacy training: %s", async (query) => {
    const data = await report(query);
    expect(data.players[0].attendance["2026-10-02"]).toBeUndefined();
  });

  it.each(["teamGroup=2012", "playerId=new-player"])("includes post-registration legacy training: %s", async (query) => {
    const data = await report(query);
    expect(data.players[0].attendance["2026-10-21"]).toEqual({ present: true, reasonCode: null });
  });

  it("excludes pre-registration custom-group training", async () => {
    mocks.custom.mockResolvedValue({ id: "custom-1", trainingDates: ["2026-10-02"], trainingWeekdays: [], players: [{ playerId: newPlayer.id }] });
    const data = await report("customTrainingGroupId=custom-1");
    expect(data.players[0].attendance["2026-10-02"]).toBeUndefined();
  });

  it.each([
    { date: "2026-10-02", time: "17:00", eligible: false },
    { date: "2026-10-20", time: "10:00", eligible: false },
    { date: "2026-10-20", time: "17:00", eligible: true },
    { date: "2026-10-21", time: "17:00", eligible: true },
  ])("coach session $date $time: eligibility=$eligible", async ({ date, time, eligible }) => {
    mocks.sessions.mockResolvedValue([{ id: "session-1", scopeType: "coachGroup", trainingDate: new Date(`${date}T00:00:00Z`), trainingTime: time, players: [] }]);
    const data = await report("coachGroupId=coach-1");
    expect(data.players.map((p: { id: string }) => p.id)).toContain(newPlayer.id);
    const cell = data.players[0].attendance[`${date}T${time}#session-1`];
    if (eligible) expect(cell?.present).toBe(true);
    else expect(cell).toBeUndefined();
  });

  it("returns the registered player even without sessions (UI may hide the empty table)", async () => {
    const data = await report("coachGroupId=coach-1");
    expect(data.trainingDates).toEqual([]);
    expect(data.players.map((p: { id: string }) => p.id)).toContain(newPlayer.id);
  });

  it("preserves an explicitly recorded future absence", async () => {
    mocks.sessions.mockResolvedValue([{ id: "session-1", scopeType: "coachGroup", trainingDate: new Date("2026-10-21T00:00:00Z"), trainingTime: "17:00", players: [{ playerId: newPlayer.id, present: false, reasonCode: "sick" }] }]);
    const data = await report("coachGroupId=coach-1");
    expect(data.players[0].attendance["2026-10-21T17:00#session-1"]).toEqual({ present: false, reasonCode: "sick" });
  });

  it("uses enrollment rather than account creation for an existing player moved into a group", async () => {
    mocks.players.mockResolvedValue([{ ...newPlayer, createdAt: new Date("2026-01-01T00:00:00Z"), attendanceMemberships: [{ scopeKey: "custom_group:custom-1", joinedAt: new Date("2026-10-20T12:00:00Z"), leftAt: null }] }]);
    mocks.custom.mockResolvedValue({ id: "custom-1", trainingDates: ["2026-10-02", "2026-10-21"], trainingWeekdays: [], players: [{ playerId: newPlayer.id }] });
    const data = await report("customTrainingGroupId=custom-1");
    expect(data.players[0].attendance["2026-10-02"]).toBeUndefined();
    expect(data.players[0].attendance["2026-10-21"].present).toBe(true);
  });

  it("preserves a manual historical decision even when it predates import", async () => {
    mocks.sessions.mockResolvedValue([{ id: "old", scopeKey: "coach_group:coach-1", scopeType: "coachGroup", trainingDate: new Date("2026-10-02T00:00:00Z"), trainingTime: "17:00", players: [{ playerId: newPlayer.id, present: false, attendanceRecorded: true, reasonCode: "sick" }] }]);
    const data = await report("coachGroupId=coach-1");
    expect(data.players[0].attendance["2026-10-02T17:00#old"]).toEqual({ present: false, reasonCode: "sick" });
  });
});
