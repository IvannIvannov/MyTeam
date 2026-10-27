import { describe, expect, it } from "vitest";
import { optionalPlayerUpdates, parsePlayerFields, parsePlayerWeight, playerFieldEnabled } from "./playerFields";

describe("optional player data", () => {
  it("preserves hidden and omitted fields, and accepts explicit clearing only for enabled fields", () => {
    expect(optionalPlayerUpdates({ rank: "1 дан", weight: -2, teamGroup: null, jerseyNumber: "" }, { playerFields: [] })).toEqual({});
    expect(optionalPlayerUpdates({}, { playerFields: ["rank", "weight"] })).toEqual({});
    expect(optionalPlayerUpdates({ rank: " ", weight: "", jerseyNumber: null, teamGroup: "" }, { playerFields: ["rank", "weight", "jerseyNumber", "teamGroup"] })).toEqual({ rank: null, weight: null, jerseyNumber: null, teamGroup: null });
  });
  it("normalizes awarded ranks and Bulgarian decimal weights", () => {
    expect(optionalPlayerUpdates({ rank: "  1 дан  ", weight: "72,5" }, { playerFields: ["rank", "weight"] })).toEqual({ rank: "1 дан", weight: 72.5 });
  });
  it.each([0, -1, Infinity, NaN, "abc", true, [], {}, "Infinity"])("rejects invalid enabled weight %j", weight => {
    expect(() => parsePlayerWeight(weight)).toThrow();
  });
  it("uses explicit empty settings over legacy defaults", () => {
    expect(playerFieldEnabled({ playerFields: [] }, "teamGroup")).toBe(false);
    expect(playerFieldEnabled({ playerFields: ["weight"] }, "weight")).toBe(true);
  });
  it("rejects unknown field settings and deduplicates valid choices", () => {
    expect(() => parsePlayerFields(["unknown"])).toThrow();
    expect(() => parsePlayerFields("rank")).toThrow();
    expect(parsePlayerFields(["rank", "rank", "weight"])).toEqual(["rank", "weight"]);
  });
});
