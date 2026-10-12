import { expect, it } from "vitest";
import { mergeTrainingCalendarDates } from "./trainingCalendarDates";

it("keeps old-only dates, new-only dates, and counts both schedules on shared dates", () => {
  const stats = { total: 3, attending: 2, optedOut: 1 };
  const days = mergeTrainingCalendarDates(
    [{ date: "2026-10-12", stats }, { date: "2026-10-13", stats }],
    [{ date: "2026-10-13", stats, sessions: [{ id: "morning" }, { id: "evening" }] }, { date: "2026-10-14", stats, sessions: [{ id: "new" }] }],
  );
  expect(days.map((day) => [day.date, day.trainingCount])).toEqual([["2026-10-12", 1], ["2026-10-13", 3], ["2026-10-14", 1]]);
  expect(days[1].sessions).toEqual([{ id: "morning" }, { id: "evening" }]);
  expect(days[1].stats).toEqual({ total: 6, attending: 4, optedOut: 2 });
});
