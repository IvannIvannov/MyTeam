import type { CoachTraining, CoachTrainingRecurrence } from "@/lib/coachTrainingSchedule";

export type CoachWizardSelection = "new" | `session:${string}` | `rule:${string}`;
export type CoachWizardInput = {
  trainings: CoachTraining[];
  recurrences: CoachTrainingRecurrence[];
  selection: CoachWizardSelection;
  dates: string[];
  times: Record<string, string>;
  duration: number;
  fields: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }>;
  notes: Record<string, string>;
  timeMode: "all" | "perDay" | "byWeekday";
  today: string;
  createId: () => string;
};

// The existing wizard edits one occurrence (or one recurring time) per date.
// Dates describe its selection, never the identity of the entire group's schedule.
export function buildCoachWizardSchedule(input: CoachWizardInput) {
  if (!input.dates.length) throw new Error("Изберете поне една дата.");
  let trainings = input.trainings.filter((t) => t.date >= input.today);
  let recurrences = [...input.recurrences];
  const selectedId = input.selection.split(":")[1];
  const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const settings = (date: string) => ({ trainingTime: input.times[date], trainingDurationMinutes: input.duration, trainingFieldId: input.fields[date]?.trainingFieldId ?? null, trainingFieldPieceIds: input.fields[date]?.trainingFieldPieceIds ?? [] });
  if (input.selection.startsWith("session:")) {
    if (input.dates.length !== 1) throw new Error("Изберете една дата за тази тренировка.");
    const selected = trainings.find((t) => t.id === selectedId);
    if (!selected) throw new Error("Тренировката не е намерена.");
    const date = input.dates[0];
    trainings = trainings.map((t) => t.id === selectedId ? { ...t, date, ...settings(date), note: input.notes[date] ?? selected.note } : t);
  } else if (input.selection.startsWith("rule:")) {
    const rule = recurrences.find((r) => r.id === selectedId);
    if (!rule) throw new Error("Седмичният час не е намерен.");
    recurrences = recurrences.map((r) => r.id === rule.id ? { ...r, ...settings(input.dates[0]) } : r);
    trainings = trainings.map((t) => t.recurrenceId === rule.id ? { ...t, ...settings(input.dates.includes(t.date) ? t.date : input.dates[0]), note: input.notes[t.date] ?? t.note } : t);
  } else {
    const ruleByWeekday = new Map<number, string>();
    if (input.timeMode === "byWeekday") {
      for (const date of input.dates) if (!ruleByWeekday.has(weekday(date))) {
        const id = input.createId();
        ruleByWeekday.set(weekday(date), id);
        recurrences.push({ id, weekday: weekday(date), ...settings(date) });
      }
    }
    trainings = [...trainings, ...input.dates.map((date) => {
      const recurrenceId = ruleByWeekday.get(weekday(date)) ?? null;
      return { id: input.createId(), date, ...settings(date), recurrenceId, recurrenceDate: recurrenceId ? date : null, status: "scheduled", note: input.notes[date] ?? "" };
    })];
  }
  return { trainings, recurrences };
}
