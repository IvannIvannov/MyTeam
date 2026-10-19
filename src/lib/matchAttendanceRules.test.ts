import { describe, expect, it } from "vitest";
import { matchPlayerWhere, parseMatchAttendance } from "@/lib/matchAttendanceRules";

describe("game attendance rules", () => {
  it("uses active club players and gives a custom group precedence over team groups", () => {
    expect(matchPlayerWhere({ clubId: "club", customGroupId: "group", teamGroups: [2014] })).toEqual({
      clubId: "club", isActive: true, customTrainingGroups: { some: { groupId: "group" } },
    });
    expect(matchPlayerWhere({ clubId: "club", customGroupId: null, teamGroups: [2014] })).toEqual({
      clubId: "club", isActive: true, teamGroup: { in: [2014] },
    });
    expect(matchPlayerWhere({ clubId: "club", customGroupId: null, teamGroups: [] })).toEqual({ clubId: "club", isActive: true });
  });

  it("requires a valid reason and bounded text for other absences", () => {
    for (const body of [ {}, { present: "false" }, { present: false }, { present: false, reasonCode: "unknown" },
      { present: false, reasonCode: "other", reasonText: "  " },
      { present: false, reasonCode: "other", reasonText: "x".repeat(201) } ]) {
      expect(parseMatchAttendance(body)).toHaveProperty("error");
    }
    expect(parseMatchAttendance({ present: false, reasonCode: "other", reasonText: " Travel " })).toEqual({ present: false, reasonCode: "other", reasonText: "Travel" });
    expect(parseMatchAttendance({ present: false, reasonCode: "sick", reasonText: "ignored" })).toEqual({ present: false, reasonCode: "sick", reasonText: null });
  });

  it("clears the withdrawal reason when a player rejoins", () => {
    expect(parseMatchAttendance({ present: true, reasonCode: "other", reasonText: "Old reason" })).toEqual({ present: true, reasonCode: null, reasonText: null });
  });
});
