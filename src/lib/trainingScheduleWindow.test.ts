import { afterEach, expect, it, vi } from "vitest";
import { getNextTrainingCalendarDates } from "../app/admin/members/_utils/members-page-utils";
import { getConfiguredTrainingDates } from "./training";

afterEach(() => vi.useRealTimers());

it("lets the calendar select and the server retain dates three months ahead across a year boundary", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T09:00:00Z"));
  const dates = getNextTrainingCalendarDates();
  expect(dates).toContain("2027-01-13");
  expect(dates).not.toContain("2027-01-15");
  expect(getConfiguredTrainingDates({
    trainingDates: ["2026-11-20", "2027-01-13", "2027-01-15"],
    timeZone: "Europe/Sofia",
  })).toEqual(["2026-11-20", "2027-01-13"]);
});
