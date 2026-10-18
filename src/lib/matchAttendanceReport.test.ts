import { describe, expect, it } from "vitest";
import { buildMatchAttendanceReport } from "@/lib/matchAttendanceReport";

const players = [
  { id: "a", fullName: "Играч А", teamGroup: 2014, customTrainingGroups: [{ groupId: "custom-a" }] },
  { id: "b", fullName: "Играч Б", teamGroup: 2015, customTrainingGroups: [{ groupId: "custom-b" }] },
];
const game = { id: "morning", matchDate: "2026-10-18", matchTime: "10:00", opponent: "Гости", customGroupId: null, teamGroups: [2014], players: [] };

describe("game attendance report", () => {
  it("keeps two games on the same date separate with their own choices", () => {
    const report = buildMatchAttendanceReport([
      { ...game, id: "evening", matchTime: "18:00", players: [{ playerId: "a", present: false, reasonCode: "sick", reasonText: null }] },
      game,
    ], players);
    expect(report.trainingDates).toEqual(["2026-10-18#morning", "2026-10-18#evening"]);
    expect(report.players).toHaveLength(1);
    expect(report.players[0].attendance["2026-10-18#morning"].present).toBe(true);
    expect(report.players[0].attendance["2026-10-18#evening"]).toEqual({ present: false, reasonCode: "sick", reasonText: null });
    expect(report.events["2026-10-18#evening"]).toEqual({ matchId: "evening", date: "2026-10-18", time: "18:00", opponent: "Гости" });
  });

  it("does not create attendance cells for players outside a game's roster", () => {
    const report = buildMatchAttendanceReport([game, { ...game, id: "other-year", teamGroups: [2015] }], players);
    expect(report.players[0].attendance).not.toHaveProperty("2026-10-18#other-year");
    expect(report.players[1].attendance).not.toHaveProperty("2026-10-18#morning");
  });

  it("gives custom-group membership precedence over the game's selected years", () => {
    const report = buildMatchAttendanceReport([{ ...game, customGroupId: "custom-b" }], players);
    expect(report.players.map((player) => player.id)).toEqual(["b"]);
  });

  it("includes active scoped players in club-wide games and omits irrelevant games", () => {
    expect(buildMatchAttendanceReport([{ ...game, teamGroups: [] }], players).players).toHaveLength(2);
    expect(buildMatchAttendanceReport([{ ...game, teamGroups: [2000] }], players)).toEqual({ trainingDates: [], events: {}, players: [] });
  });
});
