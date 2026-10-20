import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), club: vi.fn(), coach: vi.fn(), matches: vi.fn(), count: vi.fn(), groups: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { club: { findUnique: mocks.club }, coachGroup: { findFirst: mocks.coach }, clubMatch: { findMany: mocks.matches, count: mocks.count }, clubCustomTrainingGroup: { findMany: mocks.groups } } }));
const coachId = "10000000-0000-4000-8000-000000000002";
async function history(query = "", authenticated = true) {
  return GET(new NextRequest(`http://localhost/api/admin/clubs/club/matches/history?${query}`, { headers: authenticated ? { cookie: "admin_session=test" } : {} }), { params: Promise.resolve({ id: "club" }) });
}

describe("game history", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T13:00:00Z"));
    mocks.auth.mockResolvedValue({ roles: ["coach"] });
    mocks.club.mockResolvedValue({ id: "club" });
    mocks.coach.mockResolvedValue({ players: [{ teamGroup: 2014 }, { teamGroup: null }, { teamGroup: 2014 }] });
    mocks.matches.mockImplementation(async (args) => args.take === 5 ? [] : [{ id: "old-game", attendanceEnabled: false }]);
    mocks.count.mockResolvedValue(45);
    mocks.groups.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it("requires authentication before reading game history", async () => {
    expect((await history("", false)).status).toBe(401);
    mocks.auth.mockResolvedValue(null);
    expect((await history()).status).toBe(401);
    expect(mocks.club).not.toHaveBeenCalled();
  });

  it("includes old games without attendance tracking and has no 60-day history limit", async () => {
    const response = await history();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matches: [{ id: "old-game", attendanceEnabled: false }], total: 45, page: 1, pageSize: 20, customGroups: [], recentForm: [] });
    const where = mocks.matches.mock.calls[0][0].where;
    expect(where).toEqual({ clubId: "club", AND: [{ OR: [{ matchDate: { lt: "2026-10-18" } }, { matchDate: "2026-10-18", matchTime: { lte: "16:00" } }] }] });
    expect(where).not.toHaveProperty("attendanceEnabled");
  });

  it("paginates newest-first with date and opponent/location filters", async () => {
    await history("page=2&from=2025-01-01&to=2026-10-17&search=Guest");
    const args = mocks.matches.mock.calls[0][0];
    expect(args).toMatchObject({ take: 20, skip: 20, orderBy: [{ matchDate: "desc" }, { matchTime: "desc" }, { id: "desc" }], where: { clubId: "club", matchDate: { gte: "2025-01-01", lte: "2026-10-17" } } });
    expect(args.where.AND[1].OR).toEqual([{ opponent: { contains: "Guest", mode: "insensitive" } }, { location: { contains: "Guest", mode: "insensitive" } }]);
    expect(mocks.count.mock.calls[0][0].where).toEqual(args.where);
  });

  it("scopes coach views to their custom groups, years, and club-wide games", async () => {
    await history(`coachGroupId=${coachId}`);
    expect(mocks.coach.mock.calls[0][0].where).toEqual({ id: coachId, clubId: "club" });
    expect(mocks.matches.mock.calls[0][0].where.AND[1]).toEqual({ OR: [{ customGroup: { coachGroupId: coachId } }, { customGroupId: null, OR: [{ teamGroups: { isEmpty: true } }, { teamGroups: { hasSome: [2014] } }] }] });
    mocks.coach.mockResolvedValue(null);
    expect((await history(`coachGroupId=${coachId}`)).status).toBe(404);
  });

  it("rejects invalid ranges, pages, and group identifiers", async () => {
    for (const query of ["page=0", "page=1.5", "page=100001", "from=bad", "from=2026-10-18&to=2025-01-01", "coachGroupId=bad"]) expect((await history(query)).status).toBe(400);
    expect(mocks.matches).not.toHaveBeenCalled();
  });
  it("filters by custom group while preserving coach scope and scopes the dropdown choices", async () => {
    const groupId = "20000000-0000-4000-8000-000000000001";
    mocks.groups.mockResolvedValue([{ id: groupId, name: "Група 1" }]);
    const response = await history(`coachGroupId=${coachId}&customGroupId=${groupId}`);
    expect((await response.json()).customGroups).toEqual([{ id: groupId, name: "Група 1" }]);
    expect(mocks.matches.mock.calls[0][0].where.AND).toContainEqual({ customGroupId: groupId });
    expect(mocks.matches.mock.calls[0][0].where.AND).toHaveLength(3);
    expect(mocks.groups.mock.calls[0][0].where).toEqual({ clubId: "club", coachGroupId: coachId });
    expect((await history("customGroupId=bad")).status).toBe(400);
  });
  it("returns the latest five scored games independently of the history page and retains all filters", async () => {
    const form = [{ id: "recent-game", homeScore: 0, awayScore: 0, isHome: false }];
    mocks.matches.mockImplementation(async (args) => args.take === 5 ? form : []);
    const groupId = "20000000-0000-4000-8000-000000000001";
    const response = await history(`page=3&coachGroupId=${coachId}&customGroupId=${groupId}&from=2026-01-01&search=Guest`);
    expect((await response.json()).recentForm).toEqual(form);
    const listQuery = mocks.matches.mock.calls[0][0];
    const formQuery = mocks.matches.mock.calls[1][0];
    expect(listQuery.skip).toBe(40);
    expect(formQuery).not.toHaveProperty("skip");
    expect(formQuery.where).toEqual({ ...listQuery.where, homeScore: { not: null }, awayScore: { not: null } });
    expect(formQuery.orderBy).toEqual(listQuery.orderBy);
    expect(formQuery.take).toBe(5);
  });
});
