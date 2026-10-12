import { describe, expect, it } from "vitest";
import { getTrainingCountdownCandidates, getTrainingDateTimeMs } from "./memberScheduleCountdown";

describe("player training countdown", () => {
  it("finds the evening session after today's first training has started", () => {
    const now = Date.parse("2026-10-12T11:00:00Z"); // 14:00 Sofia
    const candidates = getTrainingCountdownCandidates([{
      date: "2026-10-12", trainingTime: "09:00", optedOut: false,
      sessions: [{ trainingTime: "09:00", optedOut: false }, { trainingTime: "18:00", optedOut: false }],
    }]);
    const next = candidates.filter((event) => event.targetMs >= now).sort((a, b) => a.targetMs - b.targetMs)[0];
    expect(next.time).toBe("18:00");
    expect(next.targetMs - now).toBe(4 * 60 * 60 * 1000);
  });
  it("uses each session's attendance and ignores an absence from another session", () => {
    const candidates = getTrainingCountdownCandidates([{
      date: "2026-10-12", optedOut: true,
      sessions: [{ trainingTime: "09:00", optedOut: true }, { trainingTime: "18:00", optedOut: false }],
    }]);
    expect(candidates.map((event) => event.time)).toEqual(["18:00"]);
  });
  it("supports legacy days and Sofia's summer and winter offsets", () => {
    expect(getTrainingCountdownCandidates([{ date: "2026-10-12", trainingTime: "18:00" }])[0].targetMs).toBe(Date.parse("2026-10-12T15:00:00Z"));
    expect(getTrainingDateTimeMs("2026-12-12", "18:00")).toBe(Date.parse("2026-12-12T16:00:00Z"));
    expect(getTrainingCountdownCandidates([{ date: "2026-10-12", trainingTime: "18:00", optedOut: true }])).toEqual([]);
  });
});
