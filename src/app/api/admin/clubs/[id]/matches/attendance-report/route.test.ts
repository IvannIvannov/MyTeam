import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), club: vi.fn(), coach: vi.fn(), custom: vi.fn(), combined: vi.fn(), players: vi.fn(), matches: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: {
  club: { findUnique: mocks.club }, coachGroup: { findFirst: mocks.coach },
  clubCustomTrainingGroup: { findFirst: mocks.custom }, clubTrainingScheduleGroup: { findFirst: mocks.combined },
  player: { findMany: mocks.players }, clubMatch: { findMany: mocks.matches },
} }));
const clubId = "10000000-0000-4000-8000-000000000001";
const coachId = "10000000-0000-4000-8000-000000000002";
const customId = "10000000-0000-4000-8000-000000000003";
const playerId = "10000000-0000-4000-8000-000000000004";
async function report(query = "", authenticated = true) {
  return GET(new NextRequest(`http://localhost/api/admin/clubs/${clubId}/matches/attendance-report?from=2026-10-01&to=2026-10-18&${query}`, {
    headers: authenticated ? { cookie: "admin_session=test" } : {},
  }), { params: Promise.resolve({ id: clubId }) });
}

describe("game attendance report API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ roles: ["coach"] });
    mocks.club.mockResolvedValue({ id: clubId });
    mocks.coach.mockResolvedValue({ id: coachId });
    mocks.custom.mockResolvedValue({ id: customId });
    mocks.players.mockResolvedValue([{ id: playerId, fullName: "Играч", teamGroup: 2014, customTrainingGroups: [{ groupId: customId }] }]);
    mocks.matches.mockResolvedValue([{ id: "game", matchDate: "2026-10-18", matchTime: "10:00", opponent: "Друг отбор", customGroupId: customId, teamGroups: [], players: [] }]);
  });

  it("requires an authenticated staff session", async () => {
    expect((await report("", false)).status).toBe(401);
    mocks.auth.mockResolvedValue(null);
    expect((await report()).status).toBe(401);
    expect(mocks.matches).not.toHaveBeenCalled();
  });

  it("limits results to enabled games in the requested club, dates, and coach/group scope", async () => {
    const response = await report(`coachGroupId=${coachId}&customTrainingGroupId=${customId}`);
    expect(response.status).toBe(200);
    expect(mocks.players.mock.calls[0][0].where).toEqual({ clubId, isActive: true, coachGroups: { some: { id: coachId } }, customTrainingGroups: { some: { groupId: customId } } });
    expect(mocks.matches.mock.calls[0][0].where).toEqual({ clubId, attendanceEnabled: true, matchDate: { gte: "2026-10-01", lte: "2026-10-18" }, OR: [{ customGroupId: customId }, { customGroupId: null }] });
    expect(mocks.custom.mock.calls[0][0].where).toEqual({ id: customId, clubId, coachGroupId: coachId });
    expect((await response.json()).players[0].attendance["2026-10-18#game"].present).toBe(true);
  });

  it("rejects groups and players outside the selected scope", async () => {
    mocks.custom.mockResolvedValue(null);
    expect((await report(`customTrainingGroupId=${customId}`)).status).toBe(404);
    expect(mocks.matches).not.toHaveBeenCalled();
    mocks.players.mockResolvedValue([]);
    expect((await report(`playerId=${playerId}&coachGroupId=${coachId}`)).status).toBe(404);
    expect(mocks.players.mock.calls[0][0].where).toMatchObject({ id: playerId, clubId, coachGroups: { some: { id: coachId } } });
  });

  it("rejects invalid ranges and conflicting filters before querying the database", async () => {
    for (const query of ["from=bad", "to=2026-09-01", "to=2027-10-18", `teamGroup=2014&customTrainingGroupId=${customId}`, `playerId=${playerId}&teamGroup=2014`, "coachGroupId=bad"]) {
      // Replace the base range for range-validation cases rather than adding duplicate keys.
      const url = new URL(`http://localhost/api/admin/clubs/${clubId}/matches/attendance-report?from=2026-10-01&to=2026-10-18`);
      new URLSearchParams(query).forEach((value, key) => url.searchParams.set(key, value));
      const response = await GET(new NextRequest(url, { headers: { cookie: "admin_session=test" } }), { params: Promise.resolve({ id: clubId }) });
      expect(response.status).toBe(400);
    }
    expect(mocks.club).not.toHaveBeenCalled();
  });
});
