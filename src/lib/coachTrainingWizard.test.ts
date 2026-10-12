import { describe, expect, it } from "vitest";
import { buildCoachWizardSchedule, type CoachWizardInput } from "./coachTrainingWizard";
import type { CoachTraining } from "./coachTrainingSchedule";
const first: CoachTraining = { id: "first", date: "2026-10-12", trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: "field-a", trainingFieldPieceIds: ["north"], recurrenceId: null, status: "scheduled", note: "Morning" };
const second: CoachTraining = { ...first, id: "second", trainingTime: "18:00", note: "Evening" };
function input(patch: Partial<CoachWizardInput> = {}): CoachWizardInput {
  let id = 0;
  return { trainings: [first, second], recurrences: [], selection: "new", dates: [first.date], times: { [first.date]: "20:00" }, duration: 90, fields: { [first.date]: { trainingFieldId: "field-b", trainingFieldPieceIds: [] } }, notes: { [first.date]: "Third training" }, timeMode: "all", today: first.date, createId: () => `new-${++id}`, ...patch };
}
describe("original coach scheduling wizard", () => {
  it("adding a training on an occupied date retains both existing sessions", () => {
    const next = buildCoachWizardSchedule(input());
    expect(next.trainings).toHaveLength(3);
    expect(next.trainings.slice(0, 2)).toEqual([first, second]);
    expect(next.trainings[2]).toMatchObject({ id: "new-1", date: first.date, trainingTime: "20:00", trainingDurationMinutes: 90, trainingFieldId: "field-b", note: "Third training" });
  });
  it("edits only the selected session even when several share its date", () => {
    const next = buildCoachWizardSchedule(input({ selection: "session:second" }));
    expect(next.trainings[0]).toEqual(first);
    expect(next.trainings[1]).toMatchObject({ id: second.id, trainingTime: "20:00", note: "Third training" });
  });
  it("moving a session preserves its identity and note", () => {
    const next = buildCoachWizardSchedule(input({ selection: "session:first", dates: ["2026-10-13"], times: { "2026-10-13": "10:00" }, notes: {} }));
    expect(next.trainings[0]).toMatchObject({ id: first.id, date: "2026-10-13", note: "Morning" });
    expect(next.trainings[1]).toEqual(second);
  });
  it("adds another weekly time without replacing the previous rule", () => {
    const rule = { id: "rule", weekday: 1, trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: "field-a", trainingFieldPieceIds: [] };
    const next = buildCoachWizardSchedule(input({ recurrences: [rule], timeMode: "byWeekday" }));
    expect(next.recurrences).toHaveLength(2);
    expect(next.recurrences[0]).toEqual(rule);
    expect(next.trainings[2]).toMatchObject({ recurrenceId: "new-1", recurrenceDate: first.date, trainingTime: "20:00" });
  });
  it("editing a recurring time retains occurrence IDs, notes, and cancellations", () => {
    const rule = { id: "rule", weekday: 1, trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: "field-a", trainingFieldPieceIds: [] };
    const next = buildCoachWizardSchedule(input({ selection: "rule:rule", trainings: [{ ...first, recurrenceId: "rule", status: "cancelled" }, second], recurrences: [rule], notes: {} }));
    expect(next.trainings[0]).toMatchObject({ id: first.id, status: "cancelled", note: "Morning", trainingTime: "20:00" });
    expect(next.trainings[1]).toEqual(second);
    expect(next.recurrences[0]).toMatchObject({ id: "rule", trainingTime: "20:00" });
  });
});
