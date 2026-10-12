import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getTodayIsoDateInTimeZone, getWeekdayMondayFirst, isIsoDate, isoDateToUtcMidnight, normalizeTrainingDurationMinutes, normalizeTrainingTime, utcDateToIsoDate } from "@/lib/training";
import { parseTrainingFieldSelection } from "@/lib/trainingFields";

export type CoachTraining = {
  id: string; date: string; trainingTime: string; trainingDurationMinutes: number;
  trainingFieldId: string | null; trainingFieldPieceIds: string[];
  recurrenceId: string | null; status: string; note: string;
  recurrenceDate?: string | null;
};
export type CoachTrainingRecurrence = Omit<CoachTraining, "date" | "recurrenceId" | "recurrenceDate" | "status" | "note"> & { weekday: number; excludedDates?: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCoachTraining(raw: unknown): CoachTraining {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid training");
  const value = raw as Record<string, unknown>;
  const id = value.id == null ? randomUUID() : String(value.id);
  if (!uuid.test(id)) throw new Error("Invalid training ID");
  const date = String(value.date ?? "");
  if (!isIsoDate(date)) throw new Error("Invalid training date");
  const trainingTime = normalizeTrainingTime(value.trainingTime);
  if (!trainingTime) throw new Error("Training time is required");
  const trainingDurationMinutes = normalizeTrainingDurationMinutes(value.trainingDurationMinutes);
  const [hour, minute] = trainingTime.split(":").map(Number);
  if (hour * 60 + minute + trainingDurationMinutes > 1440) throw new Error("Training must finish on the same day");
  const recurrenceId = value.recurrenceId ? String(value.recurrenceId) : null;
  if (recurrenceId && !uuid.test(recurrenceId)) throw new Error("Invalid recurrence ID");
  const recurrenceDate = recurrenceId ? String(value.recurrenceDate ?? date) : null;
  if (recurrenceDate && !isIsoDate(recurrenceDate)) throw new Error("Invalid recurring date");
  if (value.status != null && value.status !== "scheduled" && value.status !== "cancelled") throw new Error("Invalid training status");
  return { id, date, trainingTime, trainingDurationMinutes, ...parseTrainingFieldSelection({ trainingFieldId: value.trainingFieldId, trainingFieldPieceIds: value.trainingFieldPieceIds }), recurrenceId, recurrenceDate, status: value.status === "cancelled" ? "cancelled" : "scheduled", note: String(value.note ?? "").trim() };
}

export function parseCoachRecurrences(raw: unknown): CoachTrainingRecurrence[] {
  if (!Array.isArray(raw)) throw new Error("Recurring times must be an array");
  return raw.map((entry) => {
    const weekday = Number(entry?.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Invalid weekday");
    const { id, trainingTime, trainingDurationMinutes, trainingFieldId, trainingFieldPieceIds } = parseCoachTraining({ ...entry, date: "2000-01-01" });
    const excludedDates = Array.isArray(entry?.excludedDates) ? [...new Set<string>(entry.excludedDates.map(String))] : [];
    if (excludedDates.some((date) => !isIsoDate(date))) throw new Error("Invalid excluded date");
    return { id, weekday, trainingTime, trainingDurationMinutes, trainingFieldId, trainingFieldPieceIds, ...(excludedDates.length ? { excludedDates } : {}) };
  });
}

export function expandCoachRecurrences(rules: CoachTrainingRecurrence[], existing: CoachTraining[], today: string, windowDays = 30): CoachTraining[] {
  const result: CoachTraining[] = [];
  for (let day = 0; day < windowDays; day++) {
    const date = new Date(isoDateToUtcMidnight(today).getTime() + day * 86400000).toISOString().slice(0, 10);
    for (const rule of rules) {
      if (getWeekdayMondayFirst(date, "Europe/Sofia") !== rule.weekday) continue;
      if (rule.excludedDates?.includes(date)) continue;
      const previous = existing.find((item) => item.recurrenceId === rule.id && (item.recurrenceDate ?? item.date) === date);
      if (previous && previous.date < today) continue;
      result.push({ ...rule, id: previous?.id ?? randomUUID(), date: previous?.date ?? date, recurrenceId: rule.id, recurrenceDate: date, status: previous?.status ?? "scheduled", note: previous?.note ?? "" });
    }
  }
  return result;
}

export function coachTrainingsConflict(a: CoachTraining, b: CoachTraining): boolean {
  if (a.status === "cancelled" || b.status === "cancelled" || a.date !== b.date || !a.trainingFieldId || a.trainingFieldId !== b.trainingFieldId) return false;
  if (a.trainingFieldPieceIds.length && b.trainingFieldPieceIds.length && !a.trainingFieldPieceIds.some((id) => b.trainingFieldPieceIds.includes(id))) return false;
  const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
  return minutes(a.trainingTime) < minutes(b.trainingTime) + b.trainingDurationMinutes && minutes(b.trainingTime) < minutes(a.trainingTime) + a.trainingDurationMinutes;
}

export async function readCoachTrainings(clubId: string, groupId: string) {
  const rows = await prisma.trainingSession.findMany({ where: { clubId, scopeType: "coachGroup", scopeId: groupId }, orderBy: [{ trainingDate: "asc" }, { trainingTime: "asc" }], include: { players: true } });
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString(), date: utcDateToIsoDate(row.trainingDate), trainingTime: row.trainingTime ?? "", trainingDurationMinutes: row.trainingDurationMinutes, trainingFieldId: row.trainingFieldId, trainingFieldPieceIds: row.trainingFieldPieceIds, recurrenceId: row.recurrenceId, recurrenceDate: row.recurrenceDate ? utcDateToIsoDate(row.recurrenceDate) : null, status: row.status, note: row.note ?? "", players: row.players }));
}

// Session IDs, rather than dates or start times, survive all edits.
export async function writeCoachTrainings(tx: Pick<typeof prisma, "trainingSession" | "trainingSessionPlayer" | "coachGroup" | "player">, clubId: string, groupId: string, trainings: CoachTraining[], recurrences: CoachTrainingRecurrence[]) {
  const today = getTodayIsoDateInTimeZone("Europe/Sofia");
  const scopeKey = `coach_group:${groupId}`;
  const existing = await tx.trainingSession.findMany({ where: { clubId, scopeKey }, include: { players: true } });
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const players = await tx.player.findMany({ where: { clubId, isActive: true, coachGroups: { some: { id: groupId } } }, select: { id: true, fullName: true, teamGroup: true } });
  for (const item of trainings) {
    const previous = existingById.get(item.id);
    if (item.date < today || (previous && utcDateToIsoDate(previous.trainingDate) < today)) throw new Error("Past trainings cannot be edited");
    const data = { occurrenceKey: item.id, trainingDate: isoDateToUtcMidnight(item.date), trainingTime: item.trainingTime, trainingDurationMinutes: item.trainingDurationMinutes, trainingFieldId: item.trainingFieldId, trainingFieldPieceIds: item.trainingFieldPieceIds, recurrenceId: item.recurrenceId, recurrenceDate: item.recurrenceDate ? isoDateToUtcMidnight(item.recurrenceDate) : null, status: item.status, note: item.note || null };
    if (previous) await tx.trainingSession.update({ where: { id: item.id }, data });
    else await tx.trainingSession.create({ data: { id: item.id, clubId, scopeType: "coachGroup", scopeKey, scopeId: groupId, ...data } });
    const enrolled = new Set(previous?.players.map((p) => p.playerId) ?? []);
    await tx.trainingSessionPlayer.createMany({ data: players.filter((p) => !enrolled.has(p.id)).map((p) => ({ trainingSessionId: item.id, playerId: p.id, playerName: p.fullName, teamGroup: p.teamGroup })), skipDuplicates: true });
  }
  const retained = new Set(trainings.map((t) => t.id));
  for (const removed of existing) {
    if (utcDateToIsoDate(removed.trainingDate) < today || retained.has(removed.id)) continue;
    const hasActivity = Boolean(removed.note) || removed.players.some((p) => p.attendanceRecorded || !p.present || p.reasonCode || p.reasonText);
    if (hasActivity || removed.status === "cancelled") await tx.trainingSession.update({ where: { id: removed.id }, data: { status: "cancelled" } });
    else await tx.trainingSession.delete({ where: { id: removed.id } });
  }
  // Compatibility projection for views that still use a list of dates.
  const projected = await tx.trainingSession.findMany({ where: { clubId, scopeKey, trainingDate: { gte: isoDateToUtcMidnight(today) } }, orderBy: { trainingTime: "asc" } });
  // Keep cancelled dates in the scope projection so cancelling all sessions cannot
  // accidentally make members fall back to a different group's schedule.
  const active = projected.map((s) => ({ date: utcDateToIsoDate(s.trainingDate), trainingTime: s.trainingTime ?? "" }));
  const dates = [...new Set(active.map((t) => t.date))].sort();
  const times: Record<string, string> = {};
  for (const item of active) if (!times[item.date]) times[item.date] = item.trainingTime;
  await tx.coachGroup.update({ where: { id: groupId }, data: { trainingDates: dates, trainingDateTimes: times, trainingWeekdays: [], trainingRecurrences: recurrences as unknown as Prisma.InputJsonValue } });
}
