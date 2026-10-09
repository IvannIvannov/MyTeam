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
  club: { findUnique: mocks.club },
  coachGroup: { findFirst: mocks.coach },
  player: { findFirst: mocks.player, findMany: mocks.players },
  clubTrainingGroupSchedule: { findUnique: mocks.schedule },
  clubTrainingScheduleGroup: { findFirst: mocks.combined },
  clubCustomTrainingGroup: { findFirst: mocks.custom, findMany: mocks.customGroups },
  trainingSession: { findMany: mocks.sessions },
  trainingOptOut: { findMany: mocks.optOuts },
} }));

async function report(query: string) {
  return GET(new NextRequest(
    `http://localhost/api/admin/clubs/club-1/training-attendance/report?from=2026-10-01&to=2026-10-09&${query}`,
    { headers: { cookie: "admin_session=test" } },
  ), { params: Promise.resolve({ id: "club-1" }) });
}

describe("individual attendance report", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ roles: ["admin"] });
    mocks.club.mockResolvedValue({ id: "club-1", trainingGroupMode: "custom_group", trainingDates: [], trainingWeekdays: [] });
    mocks.player.mockResolvedValue({ id: "player-1", fullName: "Играч", teamGroup: 2012 });
    mocks.players.mockResolvedValue([]);
    mocks.schedule.mockResolvedValue(null);
    mocks.combined.mockResolvedValue(null);
    mocks.customGroups.mockResolvedValue([]);
    mocks.sessions.mockResolvedValue([]);
    mocks.optOuts.mockResolvedValue([]);
  });

  it("includes stored sessions from custom and combined groups and preserves attendance", async () => {
    mocks.sessions.mockResolvedValue([
      { trainingDate: new Date("2026-10-02T00:00:00Z"), players: [
        { playerId: "player-1", present: true, reasonCode: null },
      ] },
      { trainingDate: new Date("2026-10-05T00:00:00Z"), players: [
        { playerId: "player-1", present: false, reasonCode: "sick" },
      ] },
    ]);
    const response = await report("playerId=player-1");
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.trainingDates).toEqual(["2026-10-02", "2026-10-05"]);
    expect(data.players).toHaveLength(1);
    expect(data.players[0].attendance).toEqual({
      "2026-10-02": { present: true, reasonCode: null },
      "2026-10-05": { present: false, reasonCode: "sick" },
    });
    const where = mocks.sessions.mock.calls[0][0].where;
    expect(where).toMatchObject({ clubId: "club-1", players: { some: { playerId: "player-1" } }, status: { not: "cancelled" } });
    expect(where).not.toHaveProperty("scopeKey");
  });

  it("uses all of the player's custom schedules and absence records", async () => {
    mocks.schedule.mockResolvedValue({ trainingDates: ["2026-10-01"], trainingWeekdays: [] });
    mocks.customGroups.mockResolvedValue([
      { trainingDates: ["2026-10-02"], trainingWeekdays: [] },
      { trainingDates: ["2026-10-05"], trainingWeekdays: [] },
    ]);
    mocks.optOuts.mockResolvedValue([
      { playerId: "player-1", trainingDate: new Date("2026-10-05T00:00:00Z"), reasonCode: "injury" },
    ]);
    const data = await (await report("playerId=player-1")).json();
    expect(data.trainingDates).toEqual(["2026-10-02", "2026-10-05"]);
    expect(data.players[0].attendance["2026-10-05"]).toEqual({ present: false, reasonCode: "injury" });
    expect(mocks.customGroups.mock.calls[0][0].where).toEqual({ clubId: "club-1", players: { some: { playerId: "player-1" } } });
  });

  it("keeps the team report scoped to the selected group", async () => {
    mocks.custom.mockResolvedValue({ id: "custom-1", trainingDates: ["2026-10-02"], trainingWeekdays: [], players: [] });
    const response = await report("customTrainingGroupId=custom-1");
    expect(response.status).toBe(200);
    expect(mocks.sessions.mock.calls[0][0].where.scopeKey).toBe("custom_group:custom-1");
    expect(mocks.customGroups).not.toHaveBeenCalled();
  });

  it("rejects a player outside the selected club or coach group", async () => {
    mocks.coach.mockResolvedValue({ id: "coach-1" });
    mocks.player.mockResolvedValue(null);
    const response = await report("playerId=player-1&coachGroupId=coach-1");
    expect(response.status).toBe(404);
    expect(mocks.player.mock.calls[0][0].where).toMatchObject({ clubId: "club-1", coachGroups: { some: { id: "coach-1" } } });
    expect(mocks.sessions).not.toHaveBeenCalled();
  });

  it("preserves team dates when custom memberships remain in team-group mode", async () => {
    mocks.club.mockResolvedValue({ id: "club-1", trainingGroupMode: "team_group", trainingDates: [], trainingWeekdays: [] });
    mocks.schedule.mockResolvedValue({ trainingDates: ["2026-10-01"], trainingWeekdays: [] });
    mocks.customGroups.mockResolvedValue([{ trainingDates: ["2026-10-02"], trainingWeekdays: [] }]);
    const data = await (await report("playerId=player-1")).json();
    expect(data.trainingDates).toEqual(["2026-10-01"]);
    expect(mocks.customGroups).not.toHaveBeenCalled();
  });

  it.each([
    { states: [true, false], reasons: [null, "sick"], expected: { present: true, reasonCode: null } },
    { states: [false, false], reasons: ["sick", "injury"], expected: { present: false, reasonCode: "injury" } },
    { states: [false, false], reasons: [null, "sick"], expected: { present: false, reasonCode: "sick" } },
  ])("combines same-day sessions consistently: $states / $reasons", async ({ states, reasons, expected }) => {
    const sessions = states.map((present, index) => ({
      trainingDate: new Date("2026-10-02T00:00:00Z"),
      players: [{ playerId: "player-1", present, reasonCode: reasons[index] }],
    }));
    for (const rows of [sessions, [...sessions].reverse()]) {
      mocks.sessions.mockResolvedValue(rows);
      const data = await (await report("playerId=player-1")).json();
      expect(data.trainingDates).toEqual(["2026-10-02"]);
      expect(data.players[0].attendance["2026-10-02"]).toEqual(expected);
    }
  });
});
