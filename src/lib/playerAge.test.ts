import { describe, expect, it } from "vitest";
import { calculatePlayerAge, optionalPlayerUpdates, playerAgeForBirthDate } from "./playerFields";

describe("player age", () => {
  it.each([
    ["2026-10-27T21:59:59Z", "2010-10-28", 15],
    ["2026-10-27T22:00:00Z", "2010-10-28", 16],
    ["2026-10-27T22:30:00Z", "2010-10-28", 16],
    ["2026-07-27T21:30:00Z", "2010-07-28", 16],
  ])("uses the Sofia calendar date at %s", (now, birthDate, expected) => {
    expect(calculatePlayerAge(birthDate, new Date(now))).toBe(expected);
  });
  it("counts completed years around birthdays", () => {
    expect(calculatePlayerAge("2010-10-28", new Date("2026-10-27"))).toBe(15);
    expect(calculatePlayerAge("2010-10-28", new Date("2026-10-28"))).toBe(16);
    expect(calculatePlayerAge("2010-10-28", new Date("2026-10-29"))).toBe(16);
    expect(calculatePlayerAge("2024-02-29", new Date("2025-02-28"))).toBe(0);
    expect(calculatePlayerAge("2024-02-29", new Date("2025-03-01"))).toBe(1);
  });
  it("leaves missing, invalid and future birthdates without an age", () => {
    for (const date of [null, "", "invalid", "2999-01-01"]) expect(calculatePlayerAge(date)).toBeNull();
  });
  it("recalculates when the birthdate changes", () => {
    expect(playerAgeForBirthDate(new Date("2010-10-28"), "2010-10-28")).toEqual({});
    expect(playerAgeForBirthDate(null, "2010-10-28")).toEqual({ age: null });
    expect(playerAgeForBirthDate(new Date("2012-01-01"), "2010-10-28")).toEqual({ age: calculatePlayerAge("2012-01-01") });
  });
  it("ignores manual ages regardless of club settings", () => {
    expect(optionalPlayerUpdates({ age: "12" }, { playerFields: ["age"] })).toEqual({});
    expect(optionalPlayerUpdates({ age: 12 }, { playerFields: [] })).toEqual({});
  });
});
