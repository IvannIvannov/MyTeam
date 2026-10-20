import { expect, it } from "vitest";
import { parseAttendanceStartDate } from "./attendanceStartDate";

it("reads Bulgarian and ISO start dates at local midnight in summer and winter", () => {
  expect(parseAttendanceStartDate("01.10.2026")?.toISOString()).toBe("2026-09-30T21:00:00.000Z");
  expect(parseAttendanceStartDate("2026-12-01")?.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  expect(parseAttendanceStartDate("")).toBeNull();
  expect(() => parseAttendanceStartDate("2026-02-30")).toThrow();
});
