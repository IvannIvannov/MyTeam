import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMatchOverlapWarnings } from "@/lib/matchConflicts";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { clubMatch: { findMany } } }));
const input = { clubId: "club", matchDate: "2026-10-19", matchTime: "15:00", durationMinutes: 90, isHome: true };
const match = { matchDate: input.matchDate, matchTime: "15:30", durationMinutes: 90, opponent: "Съперник" };

describe("home game overlap warnings", () => {
  beforeEach(() => findMany.mockReset());
  it("does not query or warn for away games", async () => {
    expect(await getMatchOverlapWarnings({ ...input, isHome: false })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("checks all home games in the club, excludes itself and lists every overlap", async () => {
    findMany.mockResolvedValue([match, { ...match, opponent: "Друг съперник" }]);
    const warnings = await getMatchOverlapWarnings({ ...input, excludeMatchId: "editing" });
    expect(findMany.mock.calls[0][0].where).toEqual({ clubId: "club", isHome: true, id: { not: "editing" }, matchDate: { gte: "2026-10-18", lte: "2026-10-20" } });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("19.10.2026 от 15:30 до 17:00 срещу Съперник");
    expect(warnings[1]).toContain("Друг съперник");
  });
  it("allows back-to-back games and ignores nonoverlapping intervals", async () => {
    findMany.mockResolvedValue([{ ...match, matchTime: "13:30" }, { ...match, matchTime: "16:30" }, { ...match, matchTime: "19:00" }]);
    expect(await getMatchOverlapWarnings(input)).toEqual([]);
  });
  it("detects games crossing midnight in either direction", async () => {
    findMany.mockResolvedValue([{ ...match, matchDate: "2026-10-18", matchTime: "23:30" }]);
    expect(await getMatchOverlapWarnings({ ...input, matchTime: "00:30" })).toHaveLength(1);
    findMany.mockResolvedValue([{ ...match, matchDate: "2026-10-20", matchTime: "00:30" }]);
    expect(await getMatchOverlapWarnings({ ...input, matchTime: "23:30" })).toHaveLength(1);
  });
});
