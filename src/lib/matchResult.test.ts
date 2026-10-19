import { describe, expect, it } from "vitest";
import { formatMatchResult, getMatchOutcome, hasMatchFinished, parseMatchResult } from "@/lib/matchResult";

describe("match results", () => {
  it("determines outcomes from our team's home or away perspective", () => {
    expect(getMatchOutcome({ homeScore: 3, awayScore: 1, isHome: true })).toBe("win");
    expect(getMatchOutcome({ homeScore: 3, awayScore: 1, isHome: false })).toBe("loss");
    expect(getMatchOutcome({ homeScore: 0, awayScore: 2, isHome: false })).toBe("win");
    expect(getMatchOutcome({ homeScore: 0, awayScore: 2, isHome: true })).toBe("loss");
    for (const isHome of [true, false]) {
      expect(getMatchOutcome({ homeScore: 0, awayScore: 0, isHome })).toBe("draw");
      expect(getMatchOutcome({ homeScore: null, awayScore: null, isHome })).toBe("unset");
    }
  });
  it("unlocks only after kickoff plus duration in Sofia time", () => {
    const match = { matchDate: "2026-10-19", matchTime: "15:00", durationMinutes: 90 };
    expect(hasMatchFinished(match, Date.parse("2026-10-19T11:59:00Z"))).toBe(false);
    expect(hasMatchFinished(match, Date.parse("2026-10-19T13:29:59Z"))).toBe(false);
    expect(hasMatchFinished(match, Date.parse("2026-10-19T13:30:00Z"))).toBe(true);
    expect(hasMatchFinished({ ...match, matchDate: "2026-12-19" }, Date.parse("2026-12-19T14:29:59Z"))).toBe(false);
    expect(hasMatchFinished({ ...match, matchDate: "2026-12-19" }, Date.parse("2026-12-19T14:30:00Z"))).toBe(true);
  });
  it("handles games ending after midnight", () => {
    const match = { matchDate: "2026-10-18", matchTime: "23:30", durationMinutes: 90 };
    expect(hasMatchFinished(match, Date.parse("2026-10-18T21:59:59Z"))).toBe(false);
    expect(hasMatchFinished(match, Date.parse("2026-10-18T22:00:00Z"))).toBe(true);
  });
  it("requires two non-negative integer scores, preserves 0:0, and allows clearing both", () => {
    expect(parseMatchResult({ homeScore: 0, awayScore: 0 })).toEqual({ homeScore: 0, awayScore: 0 });
    expect(parseMatchResult({ homeScore: null, awayScore: null })).toEqual({ homeScore: null, awayScore: null });
    for (const result of [{ homeScore: -1, awayScore: 2 }, { homeScore: 1.5, awayScore: 0 }, { homeScore: 1, awayScore: null }, { homeScore: "1", awayScore: 2 }, { homeScore: 1000, awayScore: 0 }, {}]) expect(parseMatchResult(result)).toHaveProperty("error");
    expect(formatMatchResult({ homeScore: 0, awayScore: 0 })).toBe("0 : 0");
    expect(formatMatchResult({ homeScore: null, awayScore: null })).toBe("Не е зададен резултат");
  });
});
