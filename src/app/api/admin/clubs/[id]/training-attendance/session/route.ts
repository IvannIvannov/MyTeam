import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getConfiguredTrainingDates, isIsoDate, isoDateToUtcMidnight, utcDateToIsoDate } from "@/lib/training";
import { getTrainingSessionScopeKey } from "@/lib/trainingSessions";
import { sendTrainingCancellationNotifications } from "@/lib/push/trainingCancellationNotifications";
import { parseCoachRecurrences, readCoachTrainings } from "@/lib/coachTrainingSchedule";
import { Prisma } from "@prisma/client";
import { notifyCoachTrainingChanges } from "@/lib/push/coachTrainingNotifications";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifySession(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId } = await params;
  const body = await request.json().catch(() => ({}));
  const date = String(body.date ?? "");
  if (!isIsoDate(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const trainingDate = isoDateToUtcMidnight(date);
  try {
    if (body.trainingSessionId) {
      const trainingSessionId = String(body.trainingSessionId);
      if (!/^[0-9a-f-]{36}$/i.test(trainingSessionId)) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
      const deleted = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM clubs WHERE id = ${clubId}::uuid FOR UPDATE`;
        const row = await tx.trainingSession.findFirst({ where: { id: trainingSessionId, clubId, scopeType: "coachGroup" } });
        if (!row?.scopeId) return null;
        const group = await tx.coachGroup.findFirst({ where: { id: row.scopeId, clubId } });
        if (!group) return null;
        const original = await tx.trainingSession.findFirst({ where: { clubId, scopeKey: row.scopeKey, trainingDate: row.trainingDate }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        await tx.limitedTrainingEvent.deleteMany({ where: { clubId, OR: [{ scopeKey: `${row.scopeKey}:session:${row.id}` }, ...(original?.id === row.id ? [{ scopeKey: row.scopeKey, trainingDate: row.trainingDate }] : [])] } });
        await tx.trainingNote.deleteMany({ where: { clubId, trainingDate: row.trainingDate, scopeKey: { in: [`session:${row.id}`, `${row.scopeKey}:session:${row.id}`, ...(original?.id === row.id ? [row.scopeKey] : [])] } } });
        // Attendance and absence reasons cascade with the session; registrations cascade with their event.
        await tx.trainingSession.delete({ where: { id: row.id } });
        const rules = parseCoachRecurrences(group.trainingRecurrences ?? []).map((rule) => rule.id === row.recurrenceId ? { ...rule, excludedDates: [...new Set([...(rule.excludedDates ?? []), utcDateToIsoDate(row.recurrenceDate ?? row.trainingDate)])] } : rule);
        const remaining = await tx.trainingSession.findMany({ where: { clubId, scopeKey: row.scopeKey }, orderBy: { trainingTime: "asc" } });
        const times: Record<string, string> = {};
        for (const session of remaining) times[utcDateToIsoDate(session.trainingDate)] ??= session.trainingTime ?? "";
        await tx.coachGroup.update({ where: { id: group.id }, data: { trainingDates: Object.keys(times).sort(), trainingDateTimes: times, trainingWeekdays: [], trainingRecurrences: rules as unknown as Prisma.InputJsonValue, updatedAt: new Date() } });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!deleted?.scopeId) return NextResponse.json({ error: "Training not found" }, { status: 404 });
      await notifyCoachTrainingChanges(clubId, deleted.scopeId, [{ id: deleted.id, date: utcDateToIsoDate(deleted.trainingDate), trainingTime: deleted.trainingTime ?? "", trainingDurationMinutes: deleted.trainingDurationMinutes, trainingFieldId: deleted.trainingFieldId, trainingFieldPieceIds: deleted.trainingFieldPieceIds, recurrenceId: deleted.recurrenceId, status: deleted.status, note: deleted.note ?? "" }], []).catch((error) => console.error("Training deletion notification failed:", error));
      publishTrainingAttendanceUpdated(clubId, utcDateToIsoDate(deleted.trainingDate));
      return NextResponse.json({ success: true, deleted: true });
    }
    const customTrainingGroupId = String(body.customTrainingGroupId ?? "").trim() || null;
    const trainingGroupId = String(body.trainingGroupId ?? "").trim() || null;
    const teamGroup = body.teamGroup == null ? null : Number(body.teamGroup);
    if (teamGroup !== null && !Number.isInteger(teamGroup)) return NextResponse.json({ error: "Invalid team group" }, { status: 400 });
    const scopeKey = getTrainingSessionScopeKey(customTrainingGroupId ? { type: "customGroup", id: customTrainingGroupId } : trainingGroupId ? { type: "trainingGroup", id: trainingGroupId } : teamGroup !== null ? { type: "teamGroup", teamGroup } : { type: "club" });
    const removed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM clubs WHERE id = ${clubId}::uuid FOR UPDATE`;
      const club = await tx.club.findUnique({ where: { id: clubId } });
      if (!club) return false;
      const custom = customTrainingGroupId ? await tx.clubCustomTrainingGroup.findFirst({ where: { id: customTrainingGroupId, clubId } }) : null;
      const grouped = !customTrainingGroupId && trainingGroupId ? await tx.clubTrainingScheduleGroup.findFirst({ where: { id: trainingGroupId, clubId } }) : null;
      if ((customTrainingGroupId && !custom) || (trainingGroupId && !grouped)) return false;
      const override = !custom && !grouped && teamGroup !== null ? await tx.clubTrainingScheduleGroup.findFirst({ where: { clubId, teamGroups: { has: teamGroup }, trainingDates: { isEmpty: false } }, orderBy: { updatedAt: "desc" } }) : null;
      const team = !custom && !grouped && !override && teamGroup !== null ? await tx.clubTrainingGroupSchedule.findUnique({ where: { clubId_teamGroup: { clubId, teamGroup } } }) : null;
      const source = custom ?? grouped ?? override ?? team ?? club;
      const dates = source.trainingDates.length ? source.trainingDates : getConfiguredTrainingDates({ weekdays: source.trainingWeekdays, windowDays: source.trainingWindowDays, maxDays: 30, timeZone: "Europe/Sofia" });
      const cleanDates = dates.filter((value) => value !== date);
      const removeDate = (value: unknown) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {}).filter(([key]) => key !== date));
      const data = { trainingDates: cleanDates, trainingWeekdays: [], trainingDateTimes: removeDate(source.trainingDateTimes), trainingFieldSelections: removeDate(source.trainingFieldSelections) };
      if (custom) await tx.clubCustomTrainingGroup.update({ where: { id: custom.id }, data });
      else if (grouped || override) await tx.clubTrainingScheduleGroup.update({ where: { id: (grouped ?? override)!.id }, data });
      else if (team) await tx.clubTrainingGroupSchedule.update({ where: { id: team.id }, data });
      else if (teamGroup !== null) await tx.clubTrainingGroupSchedule.create({ data: { clubId, teamGroup, ...data, trainingTime: source.trainingTime, trainingDurationMinutes: source.trainingDurationMinutes, trainingFieldId: source.trainingFieldId, trainingFieldPieceIds: source.trainingFieldPieceIds, trainingWindowDays: source.trainingWindowDays } });
      else await tx.club.update({ where: { id: clubId }, data });
      await tx.limitedTrainingEvent.deleteMany({ where: { clubId, scopeKey, trainingDate } });
      await tx.trainingNote.deleteMany({ where: { clubId, scopeKey, trainingDate } });
      await tx.trainingSession.deleteMany({ where: { clubId, scopeKey, trainingDate } });
      const members = await tx.player.findMany({
        where: { clubId, ...(custom ? { customTrainingGroups: { some: { groupId: custom.id } } } : grouped ? { teamGroup: { in: grouped.teamGroups } } : teamGroup !== null ? { teamGroup } : {}) },
        select: { id: true, teamGroup: true, customTrainingGroups: { select: { group: { select: { trainingDates: true, trainingWeekdays: true } } } } },
      });
      if (members.length) {
        // Legacy absence decisions are shared by all legacy trainings on a date.
        // Delete them only when this was the player's last such training that day.
        const [teams, groups, stored] = await Promise.all([
          tx.clubTrainingGroupSchedule.findMany({ where: { clubId } }),
          tx.clubTrainingScheduleGroup.findMany({ where: { clubId }, orderBy: { updatedAt: "desc" } }),
          tx.trainingSession.findMany({ where: { clubId, trainingDate, scopeType: { not: "coachGroup" }, status: { not: "cancelled" } }, select: { players: { select: { playerId: true } } } }),
        ]);
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
        const hasDate = (schedule: { trainingDates: string[]; trainingWeekdays: number[] }) => schedule.trainingDates.length ? schedule.trainingDates.includes(date) : schedule.trainingWeekdays.includes(weekday);
        const currentClub = source === club && teamGroup === null ? { ...club, ...data } : club;
        const remainingPlayerIds = new Set(stored.flatMap((session) => session.players.map((player) => player.playerId)));
        const cleanup = members.filter((member) => {
          if (remainingPlayerIds.has(member.id)) return false;
          if (club.trainingGroupMode === "custom_group") return !member.customTrainingGroups.some((membership) => hasDate(membership.group));
          const schedule = groups.find((group) => member.teamGroup !== null && group.teamGroups.includes(member.teamGroup) && group.trainingDates.length)
            ?? teams.find((team) => team.teamGroup === member.teamGroup) ?? currentClub;
          return !hasDate(schedule);
        }).map((member) => member.id);
        if (cleanup.length) await tx.trainingOptOut.deleteMany({ where: { trainingDate, playerId: { in: cleanup } } });
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!removed) return NextResponse.json({ error: "Training not found" }, { status: 404 });
    await sendTrainingCancellationNotifications({ clubId, trainingDate: date, teamGroup, trainingGroupId, customTrainingGroupId }).catch((error) => console.error("Training deletion notification failed:", error));
    publishTrainingAttendanceUpdated(clubId, date);
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Training deletion failed:", error);
    return NextResponse.json({ error: "Could not delete training" }, { status: 500 });
  }
}

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

function scopeTypeFromKey(scopeKey: string): string {
  if (scopeKey === "club") return "club";
  if (scopeKey.startsWith("team_group:")) return "teamGroup";
  if (scopeKey.startsWith("training_group:")) return "trainingGroup";
  if (scopeKey.startsWith("custom_group:")) return "customGroup";
  if (scopeKey.startsWith("coach_group:")) return "coachGroup";
  return "club";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clubId } = await params;
  const body = await request.json().catch(() => ({}));
  const date = String((body as { date?: unknown }).date ?? "").trim();
  const rawStatus = String((body as { status?: unknown }).status ?? "").trim();

  if (!isIsoDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (rawStatus !== "scheduled" && rawStatus !== "cancelled") {
    return NextResponse.json({ error: "status must be 'scheduled' or 'cancelled'" }, { status: 400 });
  }
  if (body.trainingSessionId) {
    const row = await prisma.trainingSession.findFirst({ where: { id: String(body.trainingSessionId), clubId, scopeType: "coachGroup" } });
    if (!row?.scopeId) return NextResponse.json({ error: "Training not found" }, { status: 404 });
    const previous = await readCoachTrainings(clubId, row.scopeId);
    await prisma.$transaction(async (tx) => {
      await tx.trainingSession.update({ where: { id: row.id }, data: { status: rawStatus } });
      await tx.coachGroup.update({ where: { id: row.scopeId! }, data: { updatedAt: new Date() } });
    });
    const next = previous.map((s) => s.id === row.id ? { ...s, status: rawStatus } : s);
    await notifyCoachTrainingChanges(clubId, row.scopeId, previous, next).catch((error) => console.error("Training status notification failed:", error));
    publishTrainingAttendanceUpdated(clubId, row.trainingDate.toISOString().slice(0, 10));
    return NextResponse.json({ success: true, status: rawStatus });
  }

  const teamGroupRaw = (body as { teamGroup?: unknown }).teamGroup;
  const trainingGroupId = String((body as { trainingGroupId?: unknown }).trainingGroupId ?? "").trim() || null;
  const customTrainingGroupId = String((body as { customTrainingGroupId?: unknown }).customTrainingGroupId ?? "").trim() || null;
  const teamGroup = teamGroupRaw !== undefined && teamGroupRaw !== null && String(teamGroupRaw).trim() !== ""
    ? Number.parseInt(String(teamGroupRaw), 10)
    : null;

  const scopeKey = getTrainingSessionScopeKey(
    customTrainingGroupId
      ? { type: "customGroup", id: customTrainingGroupId }
      : trainingGroupId
        ? { type: "trainingGroup", id: trainingGroupId }
        : teamGroup !== null && Number.isInteger(teamGroup)
          ? { type: "teamGroup", teamGroup }
          : { type: "club" },
  );

  try {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true } });
    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    const trainingDate = isoDateToUtcMidnight(date);
    if (rawStatus === "scheduled") {
      const cancelled = await prisma.trainingSession.findFirst({ where: { clubId, scopeKey, trainingDate, occurrenceKey: "", status: "cancelled" } });
      if (!cancelled) return NextResponse.json({ error: "Cancelled training not found" }, { status: 404 });
    }
    await prisma.trainingSession.upsert({
      where: { clubId_scopeKey_trainingDate: { clubId, scopeKey, trainingDate, occurrenceKey: "" } },
      update: { status: rawStatus },
      create: {
        clubId,
        scopeType: scopeTypeFromKey(scopeKey),
        scopeKey,
        trainingDate,
        status: rawStatus,
      },
    });

    if (rawStatus === "cancelled") {
      sendTrainingCancellationNotifications({
        clubId,
        trainingDate: date,
        teamGroup: teamGroup ?? null,
        trainingGroupId,
        customTrainingGroupId,
      }).catch((error) => console.error("Training cancellation notifications failed:", error));
    }

    return NextResponse.json({ success: true, status: rawStatus });
  } catch (error) {
    console.error("Training session status PATCH error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
