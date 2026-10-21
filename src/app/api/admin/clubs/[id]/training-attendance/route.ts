import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
import { trainingRequiresCheckIn } from "@/lib/trainingAttendanceDefaults";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isEligibleForMembership, isEligibleForTraining } from "@/lib/attendanceEligibility";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { verifyAdminToken } from "@/lib/adminAuth";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { sendPushToMember } from "@/lib/push/service";
import {
  getConfiguredTrainingDates,
  getTodayIsoDateInTimeZone,
  getWeekdayMondayFirst,
  isIsoDate,
  isoDateToUtcMidnight,
  normalizeTrainingTime,
  utcDateToIsoDate,
} from "@/lib/training";
import { getTrainingSessionScopeKey, updateTrainingSessionPlayerAttendance } from "@/lib/trainingSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";


function safeNormalizeTrainingTime(raw: unknown): string | null {
  try {
    return normalizeTrainingTime(raw);
  } catch {
    return null;
  }
}

function normalizeStoredTrainingDateTimes(raw: unknown, trainingDates: string[]): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const allowedDates = new Set(trainingDates);
  const result: Record<string, string> = {};
  for (const [date, value] of Object.entries(source)) {
    if (!allowedDates.has(date)) {
      continue;
    }
    const normalized = safeNormalizeTrainingTime(value);
    if (normalized) {
      result[date] = normalized;
    }
  }
  return result;
}

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

function isValidTrainingDateForConfig(input: {
  date: string;
  trainingDates: string[];
  weekdays: number[];
  timeZone: string;
}): boolean {
  if (input.trainingDates.length > 0) {
    return input.trainingDates.includes(input.date);
  }
  if (input.weekdays.length === 0) {
    return false;
  }
  return input.weekdays.includes(getWeekdayMondayFirst(input.date, input.timeZone));
}

function parseMonthKey(raw: string | null, fallbackDate: string) {
  const value = raw?.trim() ?? "";
  if (/^\d{4}-\d{2}$/.test(value)) {
    return value;
  }
  return fallbackDate.slice(0, 7);
}

function getDatesInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map((value) => Number.parseInt(value, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) =>
    `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  );
}

function getConfiguredTrainingDatesForMonth(input: {
  trainingDates?: string[] | null;
  weekdays?: number[] | null;
  monthKey: string;
  timeZone: string;
}): string[] {
  const monthDates = getDatesInMonth(input.monthKey);
  if (monthDates.length === 0) {
    return [];
  }
  const monthDateSet = new Set(monthDates);

  if (Array.isArray(input.trainingDates) && input.trainingDates.length > 0) {
    return Array.from(
      new Set(
        input.trainingDates
          .map((value) => String(value).trim())
          .filter((value) => isIsoDate(value) && monthDateSet.has(value)),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  const weekdaysSet = new Set(
    (Array.isArray(input.weekdays) ? input.weekdays : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
  );
  if (weekdaysSet.size === 0) {
    return [];
  }

  return monthDates.filter((date) => weekdaysSet.has(getWeekdayMondayFirst(date, input.timeZone)));
}

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  return session;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const trainingSessionId = request.nextUrl.searchParams.get("trainingSessionId");
  const coachGroupId = request.nextUrl.searchParams.get("coachGroupId");
  if (trainingSessionId || coachGroupId) {
    if ([trainingSessionId, coachGroupId].some((value) => value && !/^[0-9a-f-]{36}$/i.test(value))) return NextResponse.json({ error: "Invalid session or coach group" }, { status: 400 });
    const include = { players: { include: { player: { select: { cards: { where: { isActive: true }, take: 1, select: { cardCode: true } } } } } } };
    const selected = trainingSessionId ? await prisma.trainingSession.findFirst({ where: { id: trainingSessionId, clubId: id, scopeType: "coachGroup", ...(coachGroupId ? { scopeId: coachGroupId } : {}) }, include }) : null;
    if (trainingSessionId && !selected) return NextResponse.json({ error: "Training not found" }, { status: 404 });
    const scopeId = selected?.scopeId ?? coachGroupId;
    const month = parseMonthKey(request.nextUrl.searchParams.get("month"), selected ? utcDateToIsoDate(selected.trainingDate) : getTodayIsoDateInTimeZone(FIXED_TIME_ZONE));
    const dates = getDatesInMonth(month);
    if (!dates.length) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    const rows = await prisma.trainingSession.findMany({ where: { clubId: id, scopeType: "coachGroup", scopeId, status: "scheduled", trainingDate: { in: dates.map(isoDateToUtcMidnight) } }, include, orderBy: [{ trainingDate: "asc" }, { trainingTime: "asc" }, { id: "asc" }] });
    // Repair existing future rosters too, including players registered after scheduling.
    const rosterClub = await prisma.club.findUnique({ where: { id }, select: { paymentWorkflow: true } });
    const members = await prisma.player.findMany({
      where: { clubId: id, isActive: true, coachGroups: { some: { id: scopeId! } } },
      select: { id: true, fullName: true, teamGroup: true, createdAt: true, attendanceStartedAt: true, attendanceMemberships: true, cards: { where: { isActive: true }, take: 1 } },
    });
    const now = new Date();
    const localNow = new Intl.DateTimeFormat("sv-SE", { timeZone: FIXED_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now).replace(" ", "T");
    for (const entry of rows) {
      if (entry.rosterLockedAt) continue;
      const date = utcDateToIsoDate(entry.trainingDate);
      if (`${date}T${entry.trainingTime ?? "00:00"}:00` < localNow) continue;
      const missing = members.filter((member) => isEligibleForMembership(member, date, entry.trainingTime, `coach_group:${scopeId}`) && !entry.players.some((p) => p.playerId === member.id));
      if (!missing.length) continue;
      const refreshed = await prisma.$transaction(async (tx) => {
        // Serialize repair with schedule edits, then recheck the current lock.
        await tx.$queryRaw`SELECT id FROM training_sessions WHERE id = ${entry.id}::uuid FOR UPDATE`;
        const current = await tx.trainingSession.findFirst({ where: { id: entry.id, clubId: id, status: "scheduled" }, include });
        if (!current || current.rosterLockedAt || !isEligibleForTraining(new Date(), utcDateToIsoDate(current.trainingDate), current.trainingTime)) return current;
        const eligible = missing.filter((member) => isEligibleForMembership(member, utcDateToIsoDate(current.trainingDate), current.trainingTime, current.scopeKey));
        await tx.trainingSessionPlayer.createMany({ data: eligible.map((member) => ({ trainingSessionId: entry.id, playerId: member.id, playerName: member.fullName, teamGroup: member.teamGroup, present: !trainingRequiresCheckIn(rosterClub?.paymentWorkflow) })), skipDuplicates: true });
        return tx.trainingSession.findFirst({ where: { id: entry.id }, include });
      });
      if (refreshed) entry.players = refreshed.players;
    }
    const attendanceStats = (players: { playerId: string | null; present: boolean }[]) => {
      const roster = players.filter((player) => player.playerId);
      const attending = roster.filter((player) => player.present).length;
      return { total: roster.length, attending, optedOut: roster.length - attending };
    };
    const upcomingDates = [...new Set(rows.map((row) => utcDateToIsoDate(row.trainingDate)))].sort().map((date) => {
      const sessions = rows.filter((row) => utcDateToIsoDate(row.trainingDate) === date).map((row) => ({ id: row.id, trainingTime: row.trainingTime, trainingDurationMinutes: row.trainingDurationMinutes, stats: attendanceStats(row.players) }));
      const stats = sessions.reduce((sum, session) => ({ total: sum.total + session.stats.total, attending: sum.attending + session.stats.attending, optedOut: sum.optedOut + session.stats.optedOut }), { total: 0, attending: 0, optedOut: 0 });
      return { date, weekday: getWeekdayMondayFirst(date, FIXED_TIME_ZONE), trainingTime: sessions[0]?.trainingTime ?? null, stats, sessions };
    });
    const requestedDate = request.nextUrl.searchParams.get("date");
    const row = (selected ? rows.find((entry) => entry.id === selected.id) ?? selected : undefined) ?? rows.find((entry) => utcDateToIsoDate(entry.trainingDate) === requestedDate) ?? rows[0];
    if (!row) return NextResponse.json({ coachGroupId: scopeId, trainingDate: "", players: [], stats: { total: 0, attending: 0, optedOut: 0 }, upcomingDates });
    const field = row.trainingFieldId ? await prisma.field.findFirst({ where: { id: row.trainingFieldId, clubId: id }, select: { id: true, name: true, fieldType: true, pieces: { select: { id: true, name: true }, orderBy: { sortOrder: "asc" } } } }) : null;
    const players = row.players.filter((p) => p.playerId).map((p) => ({ id: p.playerId, fullName: p.playerName, teamGroup: p.teamGroup, cardCode: p.player?.cards[0]?.cardCode ?? null, optedOut: !p.present }));
    return NextResponse.json({ coachGroupId: scopeId, trainingSessionId: row.id, trainingDate: utcDateToIsoDate(row.trainingDate), trainingTime: row.trainingTime, trainingDurationMinutes: row.trainingDurationMinutes, trainingField: field, trainingFieldPieceIds: row.trainingFieldPieceIds, sessionStatus: row.status, note: row.note ?? "", players, stats: attendanceStats(row.players), upcomingDates });
  }
  const requestedDate = request.nextUrl.searchParams.get("date")?.trim() ?? "";
  const requestedMonth = request.nextUrl.searchParams.get("month");
  const monthKey = parseMonthKey(requestedMonth, requestedDate || getTodayIsoDateInTimeZone(FIXED_TIME_ZONE));
  let teamGroup: number | null = null;
  let trainingGroupId: string | null = null;
  let customTrainingGroupId: string | null = null;
  try {
    teamGroup = parseOptionalTeamGroup(request.nextUrl.searchParams.get("teamGroup"));
    trainingGroupId = parseOptionalTrainingGroupId(request.nextUrl.searchParams.get("trainingGroupId"));
    customTrainingGroupId = parseOptionalCustomTrainingGroupId(request.nextUrl.searchParams.get("customTrainingGroupId"));
  } catch {
    return NextResponse.json({ error: "Invalid training group query parameter" }, { status: 400 });
  }
  if ([teamGroup !== null, Boolean(trainingGroupId), Boolean(customTrainingGroupId)].filter(Boolean).length > 1) {
    return NextResponse.json({ error: "Use only one training group filter." }, { status: 400 });
  }
  if (requestedDate && !isIsoDate(requestedDate)) {
    return NextResponse.json({ error: "Invalid date query parameter" }, { status: 400 });
  }

  try {
    const club = await prisma.club.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      paymentWorkflow: true,
      trainingDates: true,
      trainingTime: true,
      trainingDateTimes: true,
      trainingWeekdays: true,
      trainingWindowDays: true,
      trainingGroupMode: true,
      trainingDurationMinutes: true,
      trainingFieldId: true,
      trainingFieldPieceIds: true,
    },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }

  const trainingGroup = trainingGroupId
    ? await prisma.clubTrainingScheduleGroup.findFirst({
        where: {
          id: trainingGroupId,
          clubId: id,
        },
        select: {
          id: true,
          teamGroups: true,
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
        },
      })
    : null;
  if (trainingGroupId && !trainingGroup) {
    return NextResponse.json({ error: "Training group not found" }, { status: 404 });
  }

  const customTrainingGroup = customTrainingGroupId
    ? await prisma.clubCustomTrainingGroup.findFirst({
        where: {
          id: customTrainingGroupId,
          clubId: id,
        },
        select: {
          id: true,
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
          players: { select: { playerId: true } },
        },
      })
    : null;
  if (customTrainingGroupId && !customTrainingGroup) {
    return NextResponse.json({ error: "Custom training group not found" }, { status: 404 });
  }

  const groupSchedule = teamGroup === null
    ? null
    : await prisma.clubTrainingGroupSchedule.findUnique({
        where: {
          clubId_teamGroup: {
            clubId: id,
            teamGroup,
          },
        },
        select: {
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
        },
      });

  const trainingGroupOverride = !trainingGroup && teamGroup !== null
    ? await prisma.clubTrainingScheduleGroup.findFirst({
        where: {
          clubId: id,
          teamGroups: {
            has: teamGroup,
          },
          trainingDates: {
            isEmpty: false,
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
        },
      })
    : null;

  const resolvedTrainingDates =
    customTrainingGroup
      ? customTrainingGroup.trainingDates ?? []
      : trainingGroup
      ? trainingGroup.trainingDates ?? []
      : trainingGroupOverride?.trainingDates ?? groupSchedule?.trainingDates ?? club.trainingDates ?? [];
  const resolvedTrainingWeekdays =
    customTrainingGroup
      ? customTrainingGroup.trainingWeekdays ?? []
      : trainingGroup
      ? trainingGroup.trainingWeekdays ?? []
      : trainingGroupOverride?.trainingWeekdays ?? groupSchedule?.trainingWeekdays ?? club.trainingWeekdays ?? [];
  const resolvedTrainingWindowDays =
    customTrainingGroup?.trainingWindowDays ??
    trainingGroup?.trainingWindowDays ??
    trainingGroupOverride?.trainingWindowDays ??
    groupSchedule?.trainingWindowDays ??
    club.trainingWindowDays ??
    TRAINING_SELECTION_WINDOW_DAYS;
  const resolvedTrainingDateTimes = normalizeStoredTrainingDateTimes(
    customTrainingGroup
      ? customTrainingGroup.trainingDateTimes
      : trainingGroup
      ? trainingGroup.trainingDateTimes
      : trainingGroupOverride?.trainingDateTimes ?? groupSchedule?.trainingDateTimes ?? club.trainingDateTimes,
    resolvedTrainingDates,
  );
  const resolvedDefaultTrainingTime = safeNormalizeTrainingTime(
    customTrainingGroup
      ? customTrainingGroup.trainingTime
      : trainingGroup
      ? trainingGroup.trainingTime
      : trainingGroupOverride?.trainingTime ?? groupSchedule?.trainingTime ?? club.trainingTime,
  );
  const resolvedTrainingDurationMinutes =
    customTrainingGroup
      ? customTrainingGroup.trainingDurationMinutes
      : trainingGroup
      ? trainingGroup.trainingDurationMinutes
      : trainingGroupOverride?.trainingDurationMinutes ?? groupSchedule?.trainingDurationMinutes ?? club.trainingDurationMinutes;
  const resolvedTrainingFieldId =
    customTrainingGroup
      ? customTrainingGroup.trainingFieldId
      : trainingGroup
      ? trainingGroup.trainingFieldId
      : trainingGroupOverride?.trainingFieldId ?? groupSchedule?.trainingFieldId ?? club.trainingFieldId ?? null;
  const resolvedTrainingFieldPieceIds =
    customTrainingGroup
      ? customTrainingGroup.trainingFieldPieceIds
      : trainingGroup
      ? trainingGroup.trainingFieldPieceIds
      : trainingGroupOverride?.trainingFieldPieceIds ?? groupSchedule?.trainingFieldPieceIds ?? club.trainingFieldPieceIds ?? [];

  const scopeKey = getTrainingSessionScopeKey(
    customTrainingGroup
      ? { type: "customGroup", id: customTrainingGroup.id }
      : trainingGroup
        ? { type: "trainingGroup", id: trainingGroup.id }
        : teamGroup !== null
          ? { type: "teamGroup", teamGroup }
          : { type: "club" },
  );
  const monthDates = requestedMonth ? getDatesInMonth(monthKey) : [];
  const storedSessions = requestedMonth && monthDates.length > 0
    ? await prisma.trainingSession.findMany({
        where: {
          clubId: id,
          scopeKey,
          trainingDate: {
            gte: isoDateToUtcMidnight(monthDates[0]),
            lte: isoDateToUtcMidnight(monthDates[monthDates.length - 1]),
          },
          status: {
            not: "cancelled",
          },
        },
        orderBy: { trainingDate: "asc" },
        select: {
          trainingDate: true,
          trainingTime: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
        },
      })
    : [];
  const storedSessionByDate = new Map(storedSessions.map((session) => [utcDateToIsoDate(session.trainingDate), session]));
  const storedSessionDates = storedSessions.map((session) => utcDateToIsoDate(session.trainingDate));

  const upcomingDates = storedSessionDates.length > 0
    ? storedSessionDates
    : requestedMonth
      ? getConfiguredTrainingDatesForMonth({
          trainingDates: resolvedTrainingDates,
          weekdays: resolvedTrainingWeekdays,
          monthKey,
          timeZone: FIXED_TIME_ZONE,
        })
      : getConfiguredTrainingDates({
          trainingDates: resolvedTrainingDates,
          weekdays: resolvedTrainingWeekdays,
          windowDays: resolvedTrainingWindowDays,
          timeZone: FIXED_TIME_ZONE,
          maxDays: TRAINING_SELECTION_WINDOW_DAYS,
        });
  const trainingDate =
    requestedDate && upcomingDates.includes(requestedDate)
      ? requestedDate
      : upcomingDates[0] || "";
  const selectedSession = trainingDate ? storedSessionByDate.get(trainingDate) : null;
  const effectiveTrainingFieldId = selectedSession?.trainingFieldId ?? resolvedTrainingFieldId;
  const effectiveTrainingFieldPieceIds = selectedSession?.trainingFieldPieceIds ?? resolvedTrainingFieldPieceIds;
  const effectiveTrainingDurationMinutes = selectedSession?.trainingDurationMinutes ?? resolvedTrainingDurationMinutes;

  const trainingField = effectiveTrainingFieldId
    ? await prisma.field.findUnique({
        where: { id: effectiveTrainingFieldId },
        select: {
          id: true,
          name: true,
          fieldType: true,
          pieces: {
            select: { id: true, name: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      })
    : null;
  if (!trainingDate) {
    return NextResponse.json({
      clubId: club.id,
      clubName: club.name,
      trainingDate: "",
      weekday: 0,
      note: "",
      stats: {
        total: 0,
        optedOut: 0,
        attending: 0,
      },
      players: [],
      upcomingDates: [],
      teamGroup,
      trainingGroupId: trainingGroup?.id ?? null,
      customTrainingGroupId: customTrainingGroup?.id ?? null,
      trainingDurationMinutes: effectiveTrainingDurationMinutes,
      trainingFieldId: effectiveTrainingFieldId,
      trainingFieldPieceIds: effectiveTrainingFieldPieceIds,
      trainingField,
    });
  }

  const customPlayerIds = customTrainingGroup
    ? customTrainingGroup.players.map((item) => item.playerId)
    : [];

  const players = await prisma.player.findMany({
    where: {
      clubId: id,
      isActive: true,
      ...(customTrainingGroup ? { id: { in: customPlayerIds } } : {}),
      ...(trainingGroup ? { teamGroup: { in: trainingGroup.teamGroups } } : {}),
      ...(teamGroup !== null ? { teamGroup } : {}),
    },
    select: {
      id: true,
      fullName: true,
      teamGroup: true,
      createdAt: true,
      attendanceStartedAt: true,
      attendanceMemberships: true,
      cards: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { cardCode: true },
      },
    },
    orderBy: { fullName: "asc" },
  });
  const playerIds = players.map((player) => player.id);
  const trainingDateAsDate = isoDateToUtcMidnight(trainingDate);
  const upcomingDatesAsDate = upcomingDates.map((date) => isoDateToUtcMidnight(date));

  const [allOptOuts, note, sessionForDate, attendanceSessions] = await Promise.all([
    playerIds.length > 0 && upcomingDatesAsDate.length > 0
      ? prisma.trainingOptOut.findMany({
          where: {
            playerId: {
              in: playerIds,
            },
            trainingDate: {
              in: upcomingDatesAsDate,
            },
          },
          select: {
            playerId: true,
            trainingDate: true,
          },
        })
      : Promise.resolve([]),
    prisma.trainingNote.findFirst({
      where: {
        clubId: id,
        trainingDate: trainingDateAsDate,
        scopeKey,
      },
      select: {
        note: true,
      },
    }),
    prisma.trainingSession.findFirst({
      where: { clubId: id, scopeKey, trainingDate: trainingDateAsDate },
      select: { status: true },
    }),
    prisma.trainingSession.findMany({
      where: { clubId: id, scopeKey, trainingDate: { in: upcomingDatesAsDate }, status: { not: "cancelled" } },
      select: { trainingDate: true, players: { select: { playerId: true, present: true } } },
    }),
  ]);

  const optedOutCountByDate = new Map<string, number>();
  const selectedDateOptedOutSet = new Set<string>();
  const eligiblePlayersOnDate = (date: string) => players.filter((player) => isEligibleForMembership(
    player, date, storedSessionByDate.get(date)?.trainingTime ?? resolvedTrainingDateTimes[date] ?? resolvedDefaultTrainingTime, scopeKey,
  ));
  for (const item of allOptOuts) {
    const dateIso = utcDateToIsoDate(item.trainingDate);
    if (!eligiblePlayersOnDate(dateIso).some((player) => player.id === item.playerId)) continue;
    optedOutCountByDate.set(dateIso, (optedOutCountByDate.get(dateIso) ?? 0) + 1);
    if (dateIso === trainingDate) {
      selectedDateOptedOutSet.add(item.playerId);
    }
  }
  // Session attendance is authoritative after an individual training check-in.
  const selectedAttendance = new Map<string, boolean>();
  for (const session of trainingRequiresCheckIn(club.paymentWorkflow) ? attendanceSessions : []) {
    const date = utcDateToIsoDate(session.trainingDate);
    const attendance = new Map(session.players.filter((row) => row.playerId).map((row) => [row.playerId!, row.present]));
    const absentCount = players.filter((player) => attendance.has(player.id) ? !attendance.get(player.id) : allOptOuts.some((row) => row.playerId === player.id && utcDateToIsoDate(row.trainingDate) === date)).length;
    optedOutCountByDate.set(date, absentCount);
    if (date === trainingDate) for (const [playerId, present] of attendance) selectedAttendance.set(playerId, present);
  }

  const playersWithStatus = eligiblePlayersOnDate(trainingDate).map((player) => ({
    id: player.id,
    fullName: player.fullName,
    teamGroup: player.teamGroup,
    cardCode: player.cards[0]?.cardCode ?? null,
    optedOut: selectedAttendance.has(player.id) ? !selectedAttendance.get(player.id) : selectedDateOptedOutSet.has(player.id),
  }));
  const totalPlayers = playersWithStatus.length;

    return NextResponse.json({
      clubId: club.id,
      clubName: club.name,
      teamGroup,
      trainingGroupId: trainingGroup?.id ?? null,
      customTrainingGroupId: customTrainingGroup?.id ?? null,
      trainingDate,
      weekday: getWeekdayMondayFirst(trainingDate, FIXED_TIME_ZONE),
      trainingTime: selectedSession?.trainingTime ?? resolvedTrainingDateTimes[trainingDate] ?? resolvedDefaultTrainingTime,
      note: note?.note ?? "",
      trainingDurationMinutes: effectiveTrainingDurationMinutes,
      trainingFieldId: effectiveTrainingFieldId,
      trainingFieldPieceIds: effectiveTrainingFieldPieceIds,
      trainingField,
      sessionStatus: sessionForDate?.status ?? "scheduled",
      stats: {
        total: totalPlayers,
        optedOut: playersWithStatus.filter((player) => player.optedOut).length,
        attending: playersWithStatus.filter((player) => !player.optedOut).length,
      },
      players: playersWithStatus,
      upcomingDates: upcomingDates.map((date) => ({
        date,
        weekday: getWeekdayMondayFirst(date, FIXED_TIME_ZONE),
        trainingTime: storedSessionByDate.get(date)?.trainingTime ?? resolvedTrainingDateTimes[date] ?? resolvedDefaultTrainingTime,
        stats: {
          total: eligiblePlayersOnDate(date).length,
          optedOut: optedOutCountByDate.get(date) ?? 0,
          attending: Math.max(0, eligiblePlayersOnDate(date).length - (optedOutCountByDate.get(date) ?? 0)),
        },
      })),
    });
  } catch (error) {
    console.error("Training attendance GET error:", error);
    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const trainingDate = String((body as { trainingDate?: unknown }).trainingDate ?? "").trim();
  const noteRaw = (body as { note?: unknown }).note;
  const note = noteRaw === null || noteRaw === undefined ? "" : String(noteRaw).trim();
  if (body.trainingSessionId) {
    const row = await prisma.trainingSession.findFirst({ where: { id: String(body.trainingSessionId), clubId: id, scopeType: "coachGroup" }, select: { id: true, scopeId: true, trainingDate: true } });
    if (!row) return NextResponse.json({ error: "Training not found" }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      await tx.trainingSession.update({ where: { id: row.id }, data: { note: note || null } });
      if (row.scopeId) await tx.coachGroup.update({ where: { id: row.scopeId }, data: { updatedAt: new Date() } });
    });
    publishTrainingAttendanceUpdated(id, utcDateToIsoDate(row.trainingDate));
    return NextResponse.json({ success: true });
  }
  let teamGroup: number | null = null;
  let trainingGroupId: string | null = null;
  let customTrainingGroupId: string | null = null;
  try {
    teamGroup = parseOptionalTeamGroup((body as { teamGroup?: unknown }).teamGroup);
    trainingGroupId = parseOptionalTrainingGroupId((body as { trainingGroupId?: unknown }).trainingGroupId);
    customTrainingGroupId = parseOptionalCustomTrainingGroupId((body as { customTrainingGroupId?: unknown }).customTrainingGroupId);
  } catch {
    return NextResponse.json({ error: "Invalid training group filter" }, { status: 400 });
  }
  if ([teamGroup !== null, Boolean(trainingGroupId), Boolean(customTrainingGroupId)].filter(Boolean).length > 1) {
    return NextResponse.json({ error: "Use only one training group filter." }, { status: 400 });
  }

  if (!isIsoDate(trainingDate)) {
    return NextResponse.json({ error: "Invalid trainingDate" }, { status: 400 });
  }

  try {
    const club = await prisma.club.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }

  const trainingGroup = trainingGroupId
    ? await prisma.clubTrainingScheduleGroup.findFirst({
        where: { id: trainingGroupId, clubId: id },
        select: { id: true, teamGroups: true },
      })
    : null;
  if (trainingGroupId && !trainingGroup) {
    return NextResponse.json({ error: "Training group not found" }, { status: 404 });
  }

  const customTrainingGroup = customTrainingGroupId
    ? await prisma.clubCustomTrainingGroup.findFirst({
        where: { id: customTrainingGroupId, clubId: id },
        select: { id: true, players: { select: { playerId: true } } },
      })
    : null;
  if (customTrainingGroupId && !customTrainingGroup) {
    return NextResponse.json({ error: "Custom training group not found" }, { status: 404 });
  }

  const scopeKey = getTrainingSessionScopeKey(
    customTrainingGroup
      ? { type: "customGroup", id: customTrainingGroup.id }
      : trainingGroup
        ? { type: "trainingGroup", id: trainingGroup.id }
        : teamGroup !== null
          ? { type: "teamGroup", teamGroup }
          : { type: "club" },
  );

  const trainingDateAsDate = isoDateToUtcMidnight(trainingDate);
  const customPlayerIds = customTrainingGroup
    ? customTrainingGroup.players.map((item) => item.playerId)
    : [];
  const affectedPlayers = await prisma.player.findMany({
    where: {
      clubId: id,
      isActive: true,
      ...(customTrainingGroup ? { id: { in: customPlayerIds } } : {}),
      ...(trainingGroup ? { teamGroup: { in: trainingGroup.teamGroups } } : {}),
      ...(teamGroup !== null ? { teamGroup } : {}),
    },
    select: {
      cards: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { cardCode: true },
      },
    },
  });
  const affectedCardCodes = Array.from(
    new Set(
      affectedPlayers
        .map((player) => player.cards[0]?.cardCode?.trim().toUpperCase() ?? "")
        .filter((cardCode) => cardCode.length > 0),
    ),
  );

  if (!note) {
    await prisma.trainingNote.deleteMany({
      where: {
        clubId: id,
        trainingDate: trainingDateAsDate,
        scopeKey,
      },
    });
    for (const cardCode of affectedCardCodes) {
      publishMemberUpdated(cardCode, "training-updated");
    }
    publishTrainingAttendanceUpdated(id, trainingDate);
    return NextResponse.json({
      success: true,
      trainingDate,
      note: "",
    });
  }

  if (note.length > 1000) {
    return NextResponse.json({ error: "Note is too long (max 1000 chars)" }, { status: 400 });
  }

  const existing = await prisma.trainingNote.findFirst({
    where: { clubId: id, trainingDate: trainingDateAsDate, scopeKey },
    select: { id: true },
  });
  const saved = existing
    ? await prisma.trainingNote.update({
        where: { id: existing.id },
        data: { note, createdByUserId: session.sub, updatedAt: new Date() },
        select: { trainingDate: true, note: true },
      })
    : await prisma.trainingNote.create({
        data: { clubId: id, trainingDate: trainingDateAsDate, scopeKey, note, createdByUserId: session.sub },
        select: { trainingDate: true, note: true },
      });
  for (const cardCode of affectedCardCodes) {
    publishMemberUpdated(cardCode, "training-updated");
  }
  publishTrainingAttendanceUpdated(id, trainingDate);

    return NextResponse.json({
      success: true,
      trainingDate: utcDateToIsoDate(saved.trainingDate),
      note: saved.note ?? "",
    });
  } catch (error) {
    console.error("Training attendance PUT error:", error);
    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

function formatBgDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
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
  const playerId = String((body as { playerId?: unknown }).playerId ?? "").trim();
  const trainingDate = String((body as { trainingDate?: unknown }).trainingDate ?? "").trim();
  const optedOut = (body as { optedOut?: unknown }).optedOut;
  if (body.trainingSessionId) {
    if (typeof optedOut !== "boolean" || !playerId || !/^[0-9a-f-]{36}$/i.test(String(body.trainingSessionId))) return NextResponse.json({ error: "Invalid attendance" }, { status: 400 });
    const result = await prisma.trainingSessionPlayer.updateMany({ where: { playerId, trainingSessionId: String(body.trainingSessionId), trainingSession: { clubId, status: "scheduled" } }, data: { present: !optedOut, attendanceRecorded: true, reasonCode: optedOut ? "other" : null, reasonText: optedOut ? "Промяна направена от треньор" : null } });
    if (!result.count) return NextResponse.json({ error: "Training or player not found" }, { status: 404 });
    publishTrainingAttendanceUpdated(clubId, trainingDate);
    return NextResponse.json({ success: true });
  }

  if (!playerId) {
    return NextResponse.json({ error: "Missing playerId" }, { status: 400 });
  }
  if (!isIsoDate(trainingDate)) {
    return NextResponse.json({ error: "Invalid trainingDate" }, { status: 400 });
  }
  if (typeof optedOut !== "boolean") {
    return NextResponse.json({ error: "optedOut must be a boolean" }, { status: 400 });
  }

  try {
    const player = await prisma.player.findFirst({
      where: { id: playerId, clubId },
      select: {
        id: true,
        fullName: true,
        cards: {
          where: { isActive: true },
          select: { cardCode: true },
        },
      },
    });
    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const trainingDateAsDate = isoDateToUtcMidnight(trainingDate);

    const coachReasonText = "Промяна направена от треньор";
    await prisma.$transaction(async (tx) => {
      if (optedOut) {
        await tx.trainingOptOut.upsert({
        where: {
          playerId_trainingDate: {
            playerId: player.id,
            trainingDate: trainingDateAsDate,
          },
        },
        update: {
          reasonCode: "other",
          reasonText: "Промяна направена от треньор",
        },
        create: {
          playerId: player.id,
          trainingDate: trainingDateAsDate,
          reasonCode: "other",
          reasonText: "Промяна направена от треньор",
        },
        });
      } else {
        await tx.trainingOptOut.deleteMany({
        where: {
          playerId: player.id,
          trainingDate: trainingDateAsDate,
        },
        });
      }
      await updateTrainingSessionPlayerAttendance({
        tx,
        clubId,
        playerId: player.id,
        trainingDate,
        optedOut,
        reasonCode: "other",
        reasonText: coachReasonText,
      });
    });

    const firstCardCode = player.cards[0]?.cardCode ?? null;
    const formattedDate = formatBgDate(trainingDate);
    const memberPayload = {
      title: "Промяна в присъствието",
      body: optedOut
        ? `Треньорът е отбелязал отсъствие за тренировка на ${formattedDate}.`
        : `Треньорът е потвърдил присъствие за тренировка на ${formattedDate}.`,
      url: firstCardCode ? `/member/${encodeURIComponent(firstCardCode)}` : "/",
      icon: "/myteam-logo.webp",
      badge: "/myteam-logo.webp",
      tag: "training-attendance-updated",
      data: { type: "training_reminder", trainingDate },
    };

    try {
      await sendPushToMember(player.id, memberPayload, "training_reminder");
    } catch (error) {
      console.error("Member push send error (coach attendance change):", error);
    }

    for (const { cardCode } of player.cards) {
      publishMemberUpdated(cardCode, "training-updated");
    }
    publishTrainingAttendanceUpdated(clubId, trainingDate);

    return NextResponse.json({ success: true, playerId: player.id, trainingDate, optedOut });
  } catch (error) {
    console.error("Training attendance PATCH error:", error);
    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
