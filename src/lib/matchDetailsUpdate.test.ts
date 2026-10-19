import { describe, expect, it } from "vitest";
import { buildMatchDetailsUpdate } from "@/lib/matchDetailsUpdate";

const form = { opponent: "Съперник", location: "Нов стадион", matchDate: "2020-01-01", matchTime: "12:00", durationMinutes: "90", isHome: true, customGroupId: null, homeScore: "", awayScore: "" };
describe("match details result updates", () => {
  it("omits untouched blank results from unrelated saves", () => {
    expect(buildMatchDetailsUpdate(form, { homeScore: null, awayScore: null }, true)).not.toHaveProperty("homeScore");
  });
  it("omits unchanged recorded results, including equivalent numeric input", () => {
    const payload = buildMatchDetailsUpdate({ ...form, homeScore: "02", awayScore: "1" }, { homeScore: 2, awayScore: 1 }, true);
    expect(payload).not.toHaveProperty("homeScore");
    expect(payload).not.toHaveProperty("expectedResult");
  });
  it("includes original scores when deliberately correcting or clearing a result", () => {
    const original = { homeScore: 2, awayScore: 1 };
    expect(buildMatchDetailsUpdate({ ...form, homeScore: "3", awayScore: "1" }, original, true)).toMatchObject({ homeScore: 3, awayScore: 1, expectedResult: original });
    expect(buildMatchDetailsUpdate(form, original, true)).toMatchObject({ homeScore: null, awayScore: null, expectedResult: original });
  });
  it("never includes scores for a game that cannot have results edited", () => {
    expect(buildMatchDetailsUpdate({ ...form, homeScore: "3", awayScore: "1" }, { homeScore: null, awayScore: null }, false)).not.toHaveProperty("homeScore");
  });
});
