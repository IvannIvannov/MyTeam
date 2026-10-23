import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getMatchCalendarDates } from "./matchScheduleWindow";
import { GET as adminGames } from "../app/api/admin/clubs/[id]/matches/route";
import { GET as memberGames } from "../app/api/members/[cardCode]/matches/route";

const mocks = vi.hoisted(() => ({ findMany: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/db", () => ({ prisma: {
  clubMatch: { findMany: mocks.findMany },
  card: { findFirst: vi.fn().mockResolvedValue({ player: { id: "player", clubId: "club", teamGroup: null, isActive: true } }) },
  clubCustomTrainingGroupPlayer: { findMany: vi.fn().mockResolvedValue([]) },
} }));
vi.mock("@/lib/matchConflicts", () => ({ getMatchOverlapWarnings: vi.fn() }));
vi.mock("@/lib/push/matchScheduleNotifications", () => ({ sendMatchScheduleNotifications: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it.each([
  ["2026-10-23T09:00:00Z", "2026-10-23", "2027-10-23"],
  ["2026-12-31T22:30:00Z", "2027-01-01", "2028-01-01"],
  ["2028-02-29T09:00:00Z", "2028-02-29", "2029-02-28"],
  ["2027-03-01T09:00:00Z", "2027-03-01", "2028-03-01"],
  ["2026-06-30T21:30:00Z", "2026-07-01", "2027-07-01"],
])("admin and member lists include a full calendar year at %s", async (now, from, to) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  const dates = getMatchCalendarDates();
  expect(dates[0]).toBe(from);
  expect(dates.at(-1)).toBe(to);
  expect(dates).toHaveLength((Date.parse(to) - Date.parse(from)) / 86400000 + 1);
  expect(new Set(dates).size).toBe(dates.length);
  expect(dates).toContain(new Date(Date.parse(from) + 90 * 86400000).toISOString().slice(0, 10));
  expect(dates).not.toContain(new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10));
  const request = new NextRequest("http://localhost/api/matches", { headers: { cookie: "admin_session=test" } });
  expect((await adminGames(request, { params: Promise.resolve({ id: "club" }) })).status).toBe(200);
  expect((await memberGames(request, { params: Promise.resolve({ cardCode: "CARD" }) })).status).toBe(200);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
  for (const [query] of mocks.findMany.mock.calls) {
    expect(query.where).toEqual({ clubId: "club", matchDate: { gte: from, lte: to } });
  }
});
