import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import {
  getWeekdayMondayFirst,
  isIsoDate,
  isoDateToUtcMidnight,
  utcDateToIsoDate,
} from "@/lib/training";
import { isEligibleForMembership, type AttendancePlayer } from "@/lib/attendanceEligibility";
import { getTrainingSessionScopeKey } from "@/lib/trainingSessions";
import { trainingRequiresCheckIn } from "@/lib/trainingAttendanceDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";
const MAX_RANGE_DAYS = 180;

function isTransientPrismaConnectionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { code?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  return code === "P1001" || code === "P2024";
}

function parseOptionalTeamGroup(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error("Invalid teamGroup");
  }
  return parsed;
}

function parseOptionalTrainingGroupId(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = String(raw).trim();
  return value ? value : null;
}

function parseOptionalCustomTrainingGroupId(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = String(raw).trim();
  return value ? value : null;
}

function parseOptionalPlayerId(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = String(raw).trim();
  return value ? value : null;
}

function parseOptionalCoachGroupId(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = String(raw).trim();
  return value ? value : null;
}

function getTrainingDatesInRange({
  from,
  to,
  trainingDates,
  trainingWeekdays,
}: {
  from: string;
  to: string;
  trainingDates: string[];
  trainingWeekdays: number[];
}): string[] {
  const result: string[] = [];
  const fromMs = isoDateToUtcMidnight(from).getTime();
  const toMs = isoDateToUtcMidnight(to).getTime();
  const MS_PER_DAY = 86_400_000;

  if (trainingDates.length > 0) {
    const rangeSet = new Set<string>();
    for (let ms = fromMs; ms <= toMs; ms += MS_PER_DAY) {
      rangeSet.add(utcDateToIsoDate(new Date(ms)));
    }
    for (const d of trainingDates) {
      if (rangeSet.has(d)) result.push(d);
    }
    if (result.length > 0) return result.sort();
    // No explicit dates fall in this range — fall through to weekdays
  }

  const weekdaySet = new Set(trainingWeekdays);
  for (let ms = fromMs; ms <= toMs; ms += MS_PER_DAY) {
    const iso = utcDateToIsoDate(new Date(ms));
    if (weekdaySet.has(getWeekdayMondayFirst(iso, FIXED_TIME_ZONE))) {
      result.push(iso);
    }
  }
  return result;
}

function mergeIsoDates(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat())).sort((a, b) => a.localeCompare(b));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const from = request.nextUrl.searchParams.get("from")?.trim() ?? "";
  const to = request.nextUrl.searchParams.get("to")?.trim() ?? "";

  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ error: "Invalid from or to date parameters" }, { status: 400 });
  }

  const fromMs = isoDateToUtcMidnight(from).getTime();
  const toMs = isoDateToUtcMidnight(to).getTime();

  if (fromMs > toMs) {
    return NextResponse.json({ error: "'from' must not be after 'to'" }, { status: 400 });
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
    return NextResponse.json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` }, { status: 400 });
  }

  let teamGroup: number | null = null;
  let trainingGroupId: string | null = null;
  let customTrainingGroupId: string | null = null;
  let playerId: string | null = null;
  let coachGroupId: string | null = null;
  try {
    teamGroup = parseOptionalTeamGroup(request.nextUrl.searchParams.get("teamGroup"));
    trainingGroupId = parseOptionalTrainingGroupId(request.nextUrl.searchParams.get("trainingGroupId"));
    customTrainingGroupId = parseOptionalCustomTrainingGroupId(request.nextUrl.searchParams.get("customTrainingGroupId"));
    playerId = parseOptionalPlayerId(request.nextUrl.searchParams.get("playerId"));
    coachGroupId = parseOptionalCoachGroupId(request.nextUrl.searchParams.get("coachGroupId"));
  } catch {
    return NextResponse.json({ error: "Invalid query parameter" }, { status: 400 });
  }
  if ([teamGroup !== null, Boolean(trainingGroupId), Boolean(customTrainingGroupId)].filter(Boolean).length > 1) {
    return NextResponse.json({ error: "Use only one training group filter." }, { status: 400 });
  }
  if (playerId && (teamGroup !== null || trainingGroupId || customTrainingGroupId)) {
    return NextResponse.json({ error: "Use either playerId or a training group filter." }, { status: 400 });
  }

  try {
    const club = await prisma.club.findUnique({
      where: { id },
      select: {
        id: true,
        trainingDates: true,
        trainingWeekdays: true, trainingTime: true, trainingDateTimes: true,
        trainingGroupMode: true,
        paymentWorkflow: true,
      },
    });
    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }
    if (coachGroupId) {
      const coachGroup = await prisma.coachGroup.findFirst({
        where: { id: coachGroupId, clubId: id },
        select: { id: true },
      });
      if (!coachGroup) {
        return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
      }
    }

    // If playerId is given, resolve player and use their teamGroup for schedule lookup
    let targetPlayer: { id: string; fullName: string; teamGroup: number | null; createdAt: Date } & AttendancePlayer | null = null;
    if (playerId) {
      targetPlayer = await prisma.player.findFirst({
        where: {
          id: playerId,
          clubId: id,
          isActive: true,
          ...(coachGroupId ? { OR: [
            { coachGroups: { some: { id: coachGroupId } } },
            { attendanceMemberships: { some: { scopeKey: `coach_group:${coachGroupId}` } } },
          ] } : {}),
        },
        select: { id: true, fullName: true, teamGroup: true, createdAt: true, attendanceStartedAt: true, attendanceMemberships: true },
      });
      if (!targetPlayer) {
        return NextResponse.json({ error: "Player not found" }, { status: 404 });
      }
      teamGroup = targetPlayer.teamGroup;
    }

    const trainingGroup = trainingGroupId
      ? await prisma.clubTrainingScheduleGroup.findFirst({
          where: { id: trainingGroupId, clubId: id },
          select: {
            id: true,
            teamGroups: true,
            trainingDates: true,
            trainingWeekdays: true, trainingTime: true, trainingDateTimes: true,
          },
        })
      : null;
    if (trainingGroupId && !trainingGroup) {
      return NextResponse.json({ error: "Training group not found" }, { status: 404 });
    }

    const customTrainingGroup = customTrainingGroupId
      ? await prisma.clubCustomTrainingGroup.findFirst({
          where: { id: customTrainingGroupId, clubId: id },
          select: {
            id: true,
            trainingDates: true,
            trainingWeekdays: true, trainingTime: true, trainingDateTimes: true,
            players: { select: { playerId: true } },
          },
        })
      : null;
    if (customTrainingGroupId && !customTrainingGroup) {
      return NextResponse.json({ error: "Custom training group not found" }, { status: 404 });
    }

    const groupSchedule =
      teamGroup === null
        ? null
        : await prisma.clubTrainingGroupSchedule.findUnique({
            where: { clubId_teamGroup: { clubId: id, teamGroup } },
            select: { trainingDates: true, trainingWeekdays: true, trainingTime: true, trainingDateTimes: true },
          });

    const trainingGroupOverride =
      !trainingGroup && teamGroup !== null
        ? await prisma.clubTrainingScheduleGroup.findFirst({
            where: {
              clubId: id,
              teamGroups: { has: teamGroup },
              trainingDates: { isEmpty: false },
            },
            orderBy: { updatedAt: "desc" },
            select: { trainingDates: true, trainingWeekdays: true, trainingTime: true, trainingDateTimes: true },
          })
        : null;

    const effectiveDates: string[] =
      customTrainingGroup?.trainingDates ??
      trainingGroup?.trainingDates ??
      trainingGroupOverride?.trainingDates ??
      groupSchedule?.trainingDates ??
      club.trainingDates ??
      [];
    const effectiveWeekdays: number[] =
      customTrainingGroup?.trainingWeekdays ??
      trainingGroup?.trainingWeekdays ??
      trainingGroupOverride?.trainingWeekdays ??
      groupSchedule?.trainingWeekdays ??
      club.trainingWeekdays ??
      [];

    // A player can train in custom groups whose schedule differs from their birth year.
    const playerCustomGroups = targetPlayer && club.trainingGroupMode === "custom_group"
      ? await prisma.clubCustomTrainingGroup.findMany({
          where: {
            clubId: id,
            ...(targetPlayer.attendanceMemberships?.length ? { OR: [
              { players: { some: { playerId: targetPlayer.id } } },
              { id: { in: targetPlayer.attendanceMemberships.filter((period) => period.scopeKey.startsWith("custom_group:")).map((period) => period.scopeKey.slice("custom_group:".length)) } },
            ] } : { players: { some: { playerId: targetPlayer.id } } }),
            ...(coachGroupId ? { coachGroupId } : {}),
          },
          select: { id: true, trainingDates: true, trainingWeekdays: true, trainingTime: true, trainingDateTimes: true },
        })
      : [];

    const trainingDates = getTrainingDatesInRange({
      from,
      to,
      trainingDates: effectiveDates,
      trainingWeekdays: effectiveWeekdays,
    });

    const scopeKey = getTrainingSessionScopeKey(
      coachGroupId ? { type: "coachGroup", id: coachGroupId } : customTrainingGroup
        ? { type: "customGroup", id: customTrainingGroup.id }
        : trainingGroup
          ? { type: "trainingGroup", id: trainingGroup.id }
          : teamGroup !== null
            ? { type: "teamGroup", teamGroup }
            : { type: "club" },
    );

    const storedSessions = await prisma.trainingSession.findMany({
      where: {
        clubId: id,
        ...(targetPlayer
          ? targetPlayer.attendanceMemberships?.length
            ? { OR: [
                { players: { some: { playerId: targetPlayer.id } } },
                { scopeKey: { in: targetPlayer.attendanceMemberships.map((period) => period.scopeKey) } },
              ] }
            : { players: { some: { playerId: targetPlayer.id } } }
          : { scopeKey }),
        trainingDate: { gte: isoDateToUtcMidnight(from), lte: isoDateToUtcMidnight(to) },
        status: { not: "cancelled" },
      },
      select: {
        id: true,
        scopeType: true, scopeKey: true,
        trainingTime: true,
        trainingDate: true,
        players: {
          select: {
            playerId: true,
            present: true, attendanceRecorded: true,
            reasonCode: true,
          },
        },
      },
      orderBy: { trainingDate: "asc" },
    });

    const storedSessionDates = storedSessions.map((session) => utcDateToIsoDate(session.trainingDate));
    const playerGroupDates = playerCustomGroups.map((group) => getTrainingDatesInRange({
      from,
      to,
      trainingDates: group.trainingDates,
      trainingWeekdays: group.trainingWeekdays,
    }));
    const reportTrainingDates = mergeIsoDates(
      ...(playerCustomGroups.length > 0 ? playerGroupDates : [trainingDates]),
      storedSessionDates,
    );

    const players = targetPlayer
      ? [targetPlayer]
      : await prisma.player.findMany({
          where: {
            clubId: id,
            isActive: true,
            AND: [
              ...(coachGroupId ? [{ OR: [{ coachGroups: { some: { id: coachGroupId } } }, { attendanceMemberships: { some: { scopeKey: `coach_group:${coachGroupId}` } } }] }] : []),
              ...(customTrainingGroup ? [{ OR: [{ id: { in: customTrainingGroup.players.map((p) => p.playerId) } }, { attendanceMemberships: { some: { scopeKey: `custom_group:${customTrainingGroup.id}` } } }] }] : []),
            ],
            ...(trainingGroup ? { teamGroup: { in: trainingGroup.teamGroups } } : {}),
            ...(teamGroup !== null && !trainingGroup ? { teamGroup } : {}),
          },
          select: { id: true, fullName: true, teamGroup: true, createdAt: true, attendanceStartedAt: true, attendanceMemberships: true },
          orderBy: { fullName: "asc" },
        });

    const fromDate = isoDateToUtcMidnight(from);
    const toDate = isoDateToUtcMidnight(to);

    const optOuts =
      players.length > 0 && reportTrainingDates.length > 0
        ? await prisma.trainingOptOut.findMany({
            where: {
              playerId: { in: players.map((p) => p.id) },
              trainingDate: { gte: fromDate, lte: toDate },
            },
            select: { playerId: true, trainingDate: true, reasonCode: true },
          })
        : [];

    const optOutMap = new Map<string, Map<string, string | null>>();
    for (const o of optOuts) {
      const iso = utcDateToIsoDate(o.trainingDate);
      if (!optOutMap.has(o.playerId)) optOutMap.set(o.playerId, new Map());
      optOutMap.get(o.playerId)!.set(iso, o.reasonCode ?? null);
    }

    const sessionAttendanceMap = new Map<string, Map<string, { present: boolean; reasonCode: string | null }>>();
    const registrationByPlayer = new Map(players.map((p) => [p.id, p]));
    for (const session of storedSessions) {
      const iso = utcDateToIsoDate(session.trainingDate);
      for (const row of session.players) {
        if (!row.playerId) continue;
        if (!isEligibleForMembership(registrationByPlayer.get(row.playerId) ?? {}, iso, session.trainingTime, session.scopeKey ?? scopeKey, row.attendanceRecorded)) continue;
        if (!sessionAttendanceMap.has(row.playerId)) sessionAttendanceMap.set(row.playerId, new Map());
        const byDate = sessionAttendanceMap.get(row.playerId)!;
        const previous = byDate.get(iso);
        // This report measures days: attending any session means attending that day.
        // For an absent day, choose a stable reason when sessions disagree.
        const present = row.present || (previous?.present ?? false);
        const reasons = [previous?.reasonCode, row.reasonCode]
          .filter((reason): reason is string => typeof reason === "string")
          .sort();
        byDate.set(iso, {
          present,
          reasonCode: present ? null : (reasons[0] ?? null),
        });
      }
    }

    if (coachGroupId || storedSessions.some((s) => s.scopeType === "coachGroup")) {
      const columns = storedSessions.map((s) => ({ key: `${utcDateToIsoDate(s.trainingDate)}T${s.trainingTime ?? "00:00"}#${s.id}`, session: s }));
      return NextResponse.json({
        trainingDates: columns.map((c) => c.key),
        players: players.map((p) => ({ ...p, attendance: Object.fromEntries(columns.filter(({ session }) => isEligibleForMembership(p, utcDateToIsoDate(session.trainingDate), session.trainingTime, session.scopeKey ?? scopeKey, session.players.find(r => r.playerId === p.id)?.attendanceRecorded)).map(({ key, session }) => {
          const row = session.players.find((r) => r.playerId === p.id);
          return [key, { present: row?.present ?? !trainingRequiresCheckIn(club.paymentWorkflow), reasonCode: row?.present ? null : row?.reasonCode ?? null }];
        })) })),
      });
    }
    const fallbackSchedules = (playerCustomGroups.length ? playerCustomGroups : [customTrainingGroup ?? trainingGroup ?? trainingGroupOverride ?? groupSchedule ?? club])
      .map((schedule) => ({ schedule, dates: new Set(getTrainingDatesInRange({
        from, to, trainingDates: schedule.trainingDates ?? [], trainingWeekdays: schedule.trainingWeekdays ?? [],
      })) }));
    return NextResponse.json({
      trainingDates: reportTrainingDates,
      players: players.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        teamGroup: p.teamGroup,
        attendance: Object.fromEntries(
          reportTrainingDates.filter((d) => {
            if (optOutMap.get(p.id)?.has(d)) return true;
            const sessions = storedSessions.filter((s) => utcDateToIsoDate(s.trainingDate) === d);
            if (sessions.length) return sessions.some((s) => isEligibleForMembership(p, d, s.trainingTime, s.scopeKey ?? scopeKey, s.players.find(r => r.playerId === p.id)?.attendanceRecorded));
            return fallbackSchedules.some(({ schedule, dates }) => {
              if (!dates.has(d)) return false;
              const times = schedule.trainingDateTimes as Record<string, string> | null;
              const key = "id" in schedule && playerCustomGroups.length ? `custom_group:${schedule.id}` : scopeKey;
              return isEligibleForMembership(p, d, times?.[d] ?? schedule.trainingTime, key);
            });
          }).map((d) => {
            const sessionAttendance = sessionAttendanceMap.get(p.id)?.get(d);
            if (sessionAttendance) {
              return [
                d,
                {
                  present: sessionAttendance.present,
                  reasonCode: sessionAttendance.present ? null : sessionAttendance.reasonCode,
                },
              ];
            }
            const byDate = optOutMap.get(p.id);
            const optedOut = byDate?.has(d) ?? false;
            return [
              d,
              {
                present: !optedOut && !trainingRequiresCheckIn(club.paymentWorkflow),
                reasonCode: optedOut ? (byDate?.get(d) ?? null) : null,
              },
            ];
          }),
        ),
      })),
    });
  } catch (error) {
    console.error("Training attendance report GET error:", error);
    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
