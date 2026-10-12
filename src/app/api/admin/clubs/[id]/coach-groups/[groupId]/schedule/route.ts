import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { coachTrainingsConflict, expandCoachRecurrences, parseCoachRecurrences, parseCoachTraining, readCoachTrainings, writeCoachTrainings } from "@/lib/coachTrainingSchedule";
import { assertNoTrainingFieldConflict } from "@/lib/trainingFieldConflicts";
import { clubHasTrainingFields, verifyTrainingFieldSelection } from "@/lib/trainingFields";
import { getTodayIsoDateInTimeZone, isoDateToUtcMidnight } from "@/lib/training";
import { notifyCoachTrainingChanges } from "@/lib/push/coachTrainingNotifications";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { applyCoachTrainingLimits, parseCoachTrainingLimits } from "@/lib/coachTrainingLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; groupId: string }> };
const uuid = /^[0-9a-f-]{36}$/i;
async function getGroup(request: NextRequest, context: Context) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return null;
  const { id: clubId, groupId } = await context.params;
  if (!uuid.test(clubId) || !uuid.test(groupId)) return null;
  return prisma.coachGroup.findFirst({ where: { id: groupId, clubId } });
}

export async function GET(request: NextRequest, context: Context) {
  const group = await getGroup(request, context);
  if (!group) return NextResponse.json({ error: "Нямате достъп или групата не съществува." }, { status: 404 });
  const [trainings, fields, events] = await Promise.all([
    readCoachTrainings(group.clubId, group.id),
    prisma.field.findMany({ where: { clubId: group.clubId }, include: { pieces: { orderBy: { sortOrder: "asc" } } } }),
    prisma.limitedTrainingEvent.findMany({ where: { clubId: group.clubId, OR: [{ scopeKey: `coach_group:${group.id}` }, { scopeKey: { startsWith: `coach_group:${group.id}:session:` } }] }, select: { id: true, scopeKey: true, trainingDate: true, maxSpots: true } }),
  ]);
  const limitedEvents = events.map((e) => {
    const date = e.trainingDate.toISOString().slice(0, 10);
    const original = trainings.filter((t) => t.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return { ...e, trainingDate: date, scopeKey: e.scopeKey === `coach_group:${group.id}` && original ? `${e.scopeKey}:session:${original.id}` : e.scopeKey };
  });
  return NextResponse.json({ trainings, limitedEvents, recurrences: group.trainingRecurrences ?? [], fields, version: group.updatedAt.toISOString(), trainingDates: group.trainingDates, trainingDateTimes: group.trainingDateTimes, trainingWindowDays: 30 });
}

export async function PUT(request: NextRequest, context: Context) {
  const group = await getGroup(request, context);
  if (!group) return NextResponse.json({ error: "Нямате достъп или групата не съществува." }, { status: 404 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.trainings)) throw new Error("Trainings must be an array");
    if (body.version !== group.updatedAt.toISOString()) return NextResponse.json({ error: "Графикът е променен. Затворете и отворете отново, за да заредите актуалните тренировки." }, { status: 409 });
    const previous = await readCoachTrainings(group.clubId, group.id);
    const today = getTodayIsoDateInTimeZone("Europe/Sofia");
    const storedRecurrences = parseCoachRecurrences(group.trainingRecurrences ?? []);
    const recurrences = parseCoachRecurrences(body.recurrences ?? []).map((rule) => {
      const excludedDates = [...new Set([...(rule.excludedDates ?? []), ...(storedRecurrences.find((stored) => stored.id === rule.id)?.excludedDates ?? [])])];
      return { ...rule, ...(excludedDates.length ? { excludedDates } : {}) };
    });
    const limits = parseCoachTrainingLimits(body.limits ?? []);
    if (new Set(recurrences.map((r) => r.id)).size !== recurrences.length) throw new Error("Duplicate recurring time");
    const explicit = body.trainings.map(parseCoachTraining);
    if (explicit.some((item: { id: string; status: string }) => item.status === "scheduled" && previous.some((stored) => stored.id === item.id && stored.status === "cancelled"))) throw new Error("Training restoration is disabled");
    // Explicit edits override generated occurrences by ID, including cancellations.
    const generated = expandCoachRecurrences(recurrences, [...explicit, ...previous], today);
    const byId = new Map(generated.map((t) => [t.id, t]));
    if (new Set(explicit.map((t: { id: string }) => t.id)).size !== explicit.length) throw new Error("Duplicate training ID");
    for (const item of explicit) byId.set(item.id, item);
    const trainings = [...byId.values()];
    for (const limit of limits) if (limit.sessionId ? !trainings.some((t) => t.id === limit.sessionId) : !recurrences.some((r) => r.id === limit.recurrenceId)) throw new Error("Place limit does not belong to this schedule");
    const recurringSlots = new Set<string>();
    for (const item of trainings) if (item.recurrenceId) {
      if (recurrences.find((rule) => rule.id === item.recurrenceId)?.excludedDates?.includes(item.recurrenceDate ?? item.date)) throw new Error("This recurring training was permanently deleted");
      if (!recurrences.some((r) => r.id === item.recurrenceId)) {
        if (item.status === "cancelled" && previous.some((t) => t.id === item.id && t.status === "cancelled" && t.recurrenceId === item.recurrenceId)) continue;
        throw new Error("Training references an unknown recurring time");
      }
      const slot = `${item.recurrenceId}|${item.recurrenceDate ?? item.date}`;
      if (recurringSlots.has(slot)) throw new Error("Duplicate recurring occurrence");
      recurringSlots.add(slot);
    }
    const upper = isoDateToUtcMidnight(today).getTime() + 29 * 86400000;
    const hasFields = await clubHasTrainingFields(group.clubId);
    for (let i = 0; i < trainings.length; i++) {
      const item = trainings[i];
      if (item.date < today || isoDateToUtcMidnight(item.date).getTime() > upper) throw new Error("Training dates must be within the next 30 days");
      if (hasFields && !item.trainingFieldId) throw new Error("Изберете терен за всяка тренировка.");
      await verifyTrainingFieldSelection(group.clubId, item);
      for (let j = 0; j < i; j++) if (coachTrainingsConflict(item, trainings[j])) throw new Error(`Теренът е зает на ${item.date} от ${trainings[j].trainingTime}.`);
      if (item.status !== "cancelled") await assertNoTrainingFieldConflict({ clubId: group.clubId, trainingDates: [item.date], trainingDateTimes: { [item.date]: item.trainingTime }, ...item, exclude: { type: "coachGroup", id: group.id } });
    }
    const owned = new Set(previous.map((t) => t.id));
    const foreign = await prisma.trainingSession.count({ where: { id: { in: trainings.filter((t) => !owned.has(t.id)).map((t) => t.id) } } });
    if (foreign) throw new Error("Training does not belong to this group");
    const savedGroup = await prisma.$transaction(async (tx) => {
      // Serialize saves per club, including field validation, to avoid double bookings.
      await tx.$queryRaw`SELECT id FROM clubs WHERE id = ${group.clubId}::uuid FOR UPDATE`;
      const latest = await tx.coachGroup.findUnique({ where: { id: group.id }, select: { updatedAt: true } });
      if (!latest || latest.updatedAt.toISOString() !== body.version) throw new Error("Графикът е променен. Заредете го отново.");
      const legacyEvents = await tx.limitedTrainingEvent.findMany({ where: { clubId: group.clubId, scopeKey: `coach_group:${group.id}` }, select: { id: true, trainingDate: true } });
      for (const event of legacyEvents) {
        const original = previous.filter((t) => t.date === event.trainingDate.toISOString().slice(0, 10)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (original) await tx.limitedTrainingEvent.update({ where: { id: event.id }, data: { scopeKey: `coach_group:${group.id}:session:${original.id}` } });
      }
      const booked = await tx.trainingSession.findMany({ where: { clubId: group.clubId, scopeType: "coachGroup", scopeId: { not: group.id }, status: "scheduled", trainingDate: { in: trainings.map((t) => isoDateToUtcMidnight(t.date)) } } });
      for (const item of trainings) for (const row of booked) {
        if (coachTrainingsConflict(item, { id: row.id, date: row.trainingDate.toISOString().slice(0, 10), trainingTime: row.trainingTime ?? "", trainingDurationMinutes: row.trainingDurationMinutes, trainingFieldId: row.trainingFieldId, trainingFieldPieceIds: row.trainingFieldPieceIds, recurrenceId: row.recurrenceId, status: row.status, note: row.note ?? "" })) throw new Error(`Теренът е зает на ${item.date} от ${row.trainingTime}.`);
      }
      await writeCoachTrainings(tx, group.clubId, group.id, trainings, recurrences);
      for (const item of trainings) await tx.limitedTrainingEvent.updateMany({ where: { clubId: group.clubId, scopeKey: `coach_group:${group.id}:session:${item.id}` }, data: { trainingDate: isoDateToUtcMidnight(item.date) } });
      await applyCoachTrainingLimits(tx, group.clubId, group.id, trainings, limits);
      return tx.coachGroup.findUniqueOrThrow({ where: { id: group.id }, select: { updatedAt: true } });
    }, { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const next = await readCoachTrainings(group.clubId, group.id);
    await notifyCoachTrainingChanges(group.clubId, group.id, previous.filter((t) => t.date >= today), next.filter((t) => t.date >= today)).catch((error) => console.error("Training notifications failed after schedule save:", error));
    for (const date of new Set([...previous, ...next].map((t) => t.date))) publishTrainingAttendanceUpdated(group.clubId, date);
    return NextResponse.json({ trainings: next, recurrences, version: savedGroup.updatedAt.toISOString() });
  } catch (error) {
    console.error("Coach training schedule save failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Неуспешно запазване." }, { status: 400 });
  }
}
