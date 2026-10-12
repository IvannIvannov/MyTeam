import { beforeEach, expect, it, vi } from "vitest";
import { getOccupiedFieldResources } from "./trainingFieldConflicts";
import { applyTrainingFieldToDates } from "./trainingFieldPicker";

const db = vi.hoisted(() => ({
  club: { findUnique: vi.fn() }, clubTrainingGroupSchedule: { findMany: vi.fn() },
  clubTrainingScheduleGroup: { findMany: vi.fn() }, clubCustomTrainingGroup: { findMany: vi.fn() },
  coachGroup: { findMany: vi.fn() }, trainingSession: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const dates = ["2026-10-13", "2026-10-14"];
beforeEach(() => {
  vi.clearAllMocks();
  db.club.findUnique.mockResolvedValue(null);
  db.clubTrainingGroupSchedule.findMany.mockResolvedValue([]);
  db.clubTrainingScheduleGroup.findMany.mockResolvedValue([]);
  db.clubCustomTrainingGroup.findMany.mockResolvedValue([]);
  db.coachGroup.findMany.mockResolvedValue([{ id: "group", name: "Group" }]);
  db.trainingSession.findMany.mockImplementation(async (query) => query.where.status === "cancelled" ? [] : dates.map((date, index) => ({
    id: `session-${index}`, scopeId: "group", scopeKey: "coach_group:group", trainingDate: new Date(`${date}T00:00:00Z`),
    trainingTime: index ? "18:00" : "09:00", trainingDurationMinutes: 60, trainingFieldId: "field", trainingFieldPieceIds: ["north"],
  })));
});
it("checks each selected day's own time before applying the same section", async () => {
  const occupied = await getOccupiedFieldResources({ clubId: "club", trainingDates: dates, trainingDateTimes: { [dates[0]]: "18:00", [dates[1]]: "18:30" }, trainingDurationMinutes: 60 });
  expect(occupied.map((resource) => resource.date)).toEqual([dates[1]]);
  expect(applyTrainingFieldToDates({}, dates, { trainingFieldId: "field", trainingFieldPieceIds: ["north"] }, occupied).conflictingDates).toEqual([dates[1]]);
  expect(applyTrainingFieldToDates({}, dates, { trainingFieldId: "field", trainingFieldPieceIds: ["south"] }, occupied).selections).not.toBeNull();
});
it("allows back-to-back trainings but blocks overlap introduced by a longer duration", async () => {
  const input = { clubId: "club", trainingDates: dates, trainingDateTimes: { [dates[0]]: "10:00", [dates[1]]: "17:00" }, trainingDurationMinutes: 60 };
  expect(await getOccupiedFieldResources(input)).toEqual([]);
  expect((await getOccupiedFieldResources({ ...input, trainingDurationMinutes: 90 })).map((resource) => resource.date)).toEqual([dates[1]]);
});
