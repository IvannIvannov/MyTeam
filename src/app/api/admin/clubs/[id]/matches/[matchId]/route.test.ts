import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), update: vi.fn(), conflict: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { clubMatch: { findFirst: mocks.find, update: mocks.update } } }));
vi.mock("@/lib/matchConflicts", () => ({ getMatchOverlapWarnings: mocks.conflict }));
vi.mock("@/lib/push/matchScheduleNotifications", () => ({ hasMatchScheduleChanged: () => false, sendMatchScheduleNotifications: vi.fn() }));
const match = { id: "match", customGroupId: null, opponent: "Съперник", location: "Стадион", matchDate: "2026-10-19", matchTime: "13:00", durationMinutes: 90, isHome: true, teamGroups: [], homeScore: null, awayScore: null };
async function update(body: unknown, authenticated = true) {
  return PATCH(new NextRequest("http://localhost/api/admin/clubs/club/matches/match", { method: "PATCH", headers: { "Content-Type": "application/json", ...(authenticated ? { cookie: "admin_session=test" } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "club", matchId: "match" }) });
}
describe("recording game results", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    mocks.auth.mockResolvedValue({ roles: ["coach"] });
    mocks.find.mockResolvedValue(match);
    mocks.update.mockImplementation(({ data }) => Promise.resolve({ ...match, ...data }));
    mocks.conflict.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());
  it("requires authentication", async () => { expect((await update({ homeScore: 1, awayScore: 0 }, false)).status).toBe(401); expect(mocks.find).not.toHaveBeenCalled(); });
  it("returns an actionable conflict response for a stale write", async () => {
    mocks.update.mockRejectedValue(Object.assign(new Error("Changed"), { code: "P2025" }));
    const response = await update({ homeScore: 2, awayScore: 1 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Презаредете");
  });
  it("does not hide unrelated database failures as edit conflicts", async () => {
    mocks.update.mockRejectedValue(new Error("Database unavailable"));
    await expect(update({ homeScore: 2, awayScore: 1 })).rejects.toThrow("Database unavailable");
  });
  it("saves an overlapping game and returns a warning instead of rejecting it", async () => {
    mocks.conflict.mockResolvedValue(["Застъпване с домакински мач"]);
    const response = await update({ matchTime: "13:15" });
    expect(response.status).toBe(200);
    expect((await response.json()).warning).toBe("Застъпване с домакински мач");
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.conflict).toHaveBeenCalledWith(expect.objectContaining({ excludeMatchId: "match", isHome: true }));
  });
  it("saves a finished game's result without rechecking old schedule conflicts", async () => {
    const response = await update({ homeScore: 0, awayScore: 0 });
    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ homeScore: 0, awayScore: 0 });
    expect(mocks.conflict).not.toHaveBeenCalled();
  });
  it("rejects future and in-progress games, including attempted backdating in the same request", async () => {
    for (const matchTime of ["16:00", "14:30"]) {
      mocks.find.mockResolvedValue({ ...match, matchTime });
      expect((await update({ homeScore: 2, awayScore: 1 })).status).toBe(400);
      expect((await update({ matchDate: "2026-10-18", homeScore: 2, awayScore: 1 })).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects partial or invalid scores", async () => {
    for (const body of [{ homeScore: 2 }, { homeScore: -1, awayScore: 0 }, { homeScore: 1.2, awayScore: 1 }]) expect((await update(body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("requires clearing a score when rescheduling into the future", async () => {
    mocks.find.mockResolvedValue({ ...match, homeScore: 2, awayScore: 1 });
    expect((await update({ matchDate: "2026-10-20" })).status).toBe(400);
    expect((await update({ matchDate: "2026-10-20", homeScore: null, awayScore: null })).status).toBe(200);
  });
});
