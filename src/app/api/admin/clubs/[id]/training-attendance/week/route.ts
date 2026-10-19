import { matchEventTypeLabel } from "@/lib/matchEventType";
import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getConfiguredTrainingDates, getTodayIsoDateInTimeZone } from "@/lib/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";

const WEEK_DAYS = 7;

function isTransientPrismaConnectionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { code?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  return code === "P1001" || code === "P2024";
}

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  return session;
}

function hasTrainingOnDate(input: {
  date: string;
  trainingDates?: string[] | null;
  weekdays?: number[] | null;
  windowDays?: number;
}) {
  const configured = getConfiguredTrainingDates({
    trainingDates: input.trainingDates ?? [],
    weekdays: input.weekdays ?? [],
    windowDays: input.windowDays ?? TRAINING_SELECTION_WINDOW_DAYS,
    timeZone: FIXED_TIME_ZONE,
    maxDays: TRAINING_SELECTION_WINDOW_DAYS,
  });
  return configured.includes(input.date);
}

function resolveTime(
  date: string,
  trainingTime: string | null,
  trainingDateTimes: unknown,
): string | null {
  if (trainingDateTimes && typeof trainingDateTimes === "object" && !Array.isArray(trainingDateTimes)) {
    const dtMap = trainingDateTimes as Record<string, unknown>;
    const v = dtMap[date];
    if (typeof v === "string" && /^\d{2}:\d{2}$/.test(v)) return v;
  }
  if (typeof trainingTime === "string" && /^\d{2}:\d{2}$/.test(trainingTime)) return trainingTime;
  return null;
}

function getSevenDates(todayIso: string): string[] {
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const d = new Date(`${todayIso}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

type WeekSession = {
  id: string;
  date: string;
  trainingTime: string | null;
  scopeType: "teamGroup" | "trainingGroup";
  eventType: "training" | "match";
  label: string;
  teamGroups: number[];
  color?: string | null;
  location?: string;
  scopeLabel?: string;
  isHome?: boolean;
  durationMinutes?: number;
  customGroupId?: string | null;
  limitedSpots?: { id: string; maxSpots: number; registeredCount: number } | null;
};

function formatTeamGroupsLabel(teamGroups: number[]): string {
  if (teamGroups.length === 0) return "Всички";
  return `Набор ${teamGroups.join("/")}`;
}

function resolveMatchScopeLabel(
  teamGroups: number[],
  trainingGroups: Array<{ name: string; teamGroups: number[] }>,
): string {
  if (teamGroups.length === 0) return "Всички";
  const normalized = [...teamGroups].sort((a, b) => a - b);
  const matchingTrainingGroup = trainingGroups.find((group) => {
    const groupTeamGroups = [...(group.teamGroups ?? [])].sort((a, b) => a - b);
    return groupTeamGroups.length === normalized.length && groupTeamGroups.every((value, index) => value === normalized[index]);
  });
  return matchingTrainingGroup?.name || formatTeamGroupsLabel(normalized);
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
  const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
  const dates = getSevenDates(todayIso);

  try {
    const [club, teamSchedules, trainingGroups, customTrainingGroups, clubMatches, limitedEvents, cancelledSessions] = await Promise.all([
      prisma.club.findUnique({
        where: { id },
        select: {
          id: true,
          trainingDates: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingGroupMode: true,
        },
      }),
      prisma.clubTrainingGroupSchedule.findMany({
        where: { clubId: id },
        select: {
          teamGroup: true,
          trainingDates: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingTime: true,
          trainingDateTimes: true,
        },
      }),
      prisma.clubTrainingScheduleGroup.findMany({
        where: { clubId: id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          teamGroups: true,
          trainingDates: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingTime: true,
          trainingDateTimes: true,
        },
      }),
      prisma.clubCustomTrainingGroup.findMany({
        where: { clubId: id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          color: true,
          trainingDates: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingTime: true,
          trainingDateTimes: true,
        },
      }),
      prisma.clubMatch.findMany({
        where: { clubId: id, matchDate: { in: dates } },
        select: { id: true, eventType: true, opponent: true, location: true, matchDate: true, matchTime: true, teamGroups: true, isHome: true, durationMinutes: true, customGroupId: true, customGroup: { select: { name: true, color: true } } },
      }),
      prisma.limitedTrainingEvent.findMany({
        where: { clubId: id, trainingDate: { in: dates.map((d) => new Date(d + "T00:00:00.000Z")) } },
        select: { id: true, scopeKey: true, trainingDate: true, maxSpots: true, _count: { select: { registrations: true } } },
      }),
      prisma.trainingSession.findMany({
        where: { clubId: id, status: "cancelled", trainingDate: { in: dates.map((d) => new Date(d + "T00:00:00.000Z")) } },
        select: { scopeKey: true, trainingDate: true },
      }),
    ]);

    const cancelledSet = new Set<string>();
    for (const cs of cancelledSessions) {
      cancelledSet.add(`${cs.scopeKey}|${cs.trainingDate.toISOString().slice(0, 10)}`);
    }

    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    // Build a lookup: "scopeKey|YYYY-MM-DD" → limited event data
    const limitedEventByKey = new Map<string, { id: string; maxSpots: number; registeredCount: number }>();
    for (const ev of limitedEvents) {
      const dateIso = ev.trainingDate.toISOString().slice(0, 10);
      limitedEventByKey.set(`${ev.scopeKey}|${dateIso}`, {
        id: ev.id,
        maxSpots: ev.maxSpots,
        registeredCount: ev._count.registrations,
      });
    }

    const sessions: WeekSession[] = [];
    const [coachSessions, coachGroups] = await Promise.all([
      prisma.trainingSession.findMany({ where: { clubId: id, scopeType: "coachGroup", status: "scheduled", trainingDate: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } }, select: { id: true, scopeId: true, trainingDate: true, trainingTime: true, trainingDurationMinutes: true } }),
      prisma.coachGroup.findMany({ where: { clubId: id }, select: { id: true, name: true } }),
    ]);
    const coachNames = new Map(coachGroups.map((g) => [g.id, g.name]));
    for (const item of coachSessions) sessions.push({ id: `coach-${item.scopeId}-${item.id}`, date: item.trainingDate.toISOString().slice(0, 10), trainingTime: item.trainingTime, durationMinutes: item.trainingDurationMinutes, scopeType: "trainingGroup", eventType: "training", label: coachNames.get(item.scopeId ?? "") ?? "Треньорска група", teamGroups: [], limitedSpots: limitedEventByKey.get(`coach_group:${item.scopeId}:session:${item.id}|${item.trainingDate.toISOString().slice(0, 10)}`) ?? null });

    if (club.trainingGroupMode === "custom_group") {
      for (const date of dates) {
        for (const group of customTrainingGroups) {
          const hasTraining = hasTrainingOnDate({
            date,
            trainingDates: group.trainingDates,
            weekdays: group.trainingWeekdays,
            windowDays: group.trainingWindowDays,
          });
          if (!hasTraining) continue;
          if (cancelledSet.has(`custom_group:${group.id}|${date}`)) continue;
          sessions.push({
            id: `${date}-custom-${group.id}`,
            date,
            trainingTime: resolveTime(date, group.trainingTime, group.trainingDateTimes),
            scopeType: "trainingGroup",
            eventType: "training",
            label: group.name || "Custom group",
            teamGroups: [],
            color: group.color ?? null,
            limitedSpots: limitedEventByKey.get(`custom_group:${group.id}|${date}`) ?? null,
          });
        }
      }

      for (const match of clubMatches) {
        sessions.push({
          id: `match-${match.id}`,
          date: match.matchDate,
          trainingTime: match.matchTime,
          scopeType: "teamGroup",
          eventType: "match",
          label: `${matchEventTypeLabel(match.eventType)} · ${match.opponent}`,
          teamGroups: match.teamGroups,
          location: match.location,
          scopeLabel: match.customGroup?.name ?? resolveMatchScopeLabel(match.teamGroups, []),
          isHome: match.isHome,
          durationMinutes: match.durationMinutes,
          color: match.customGroup?.color ?? null,
          customGroupId: match.customGroupId ?? null,
        });
      }

      sessions.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.label.localeCompare(b.label, "bg");
      });

      return NextResponse.json({ dates, sessions });
    }

    const teamScheduleByGroup = new Map<number, (typeof teamSchedules)[number]>();
    for (const schedule of teamSchedules) {
      teamScheduleByGroup.set(schedule.teamGroup, schedule);
    }

    const trainingGroupOverrideByTeamGroup = new Map<number, (typeof trainingGroups)[number]>();
    for (const group of trainingGroups) {
      const hasExplicitDates = Array.isArray(group.trainingDates) && group.trainingDates.length > 0;
      if (!hasExplicitDates) continue;
      for (const teamGroup of group.teamGroups ?? []) {
        if (!Number.isInteger(teamGroup) || trainingGroupOverrideByTeamGroup.has(teamGroup)) continue;
        trainingGroupOverrideByTeamGroup.set(teamGroup, group);
      }
    }

    const allTeamGroups = Array.from(
      new Set([
        ...teamSchedules.map((item) => item.teamGroup),
        ...trainingGroups.flatMap((item) => item.teamGroups ?? []),
      ]),
    )
      .filter((value) => Number.isInteger(value))
      .sort((a, b) => a - b);

    for (const date of dates) {
      const coveredTeamGroups = new Set<number>();

      for (const group of trainingGroups) {
        const normalizedGroups = Array.from(
          new Set((group.teamGroups ?? []).filter((v) => Number.isInteger(v))),
        ).sort((a, b) => a - b);
        if (normalizedGroups.length === 0) continue;

        const hasTraining = hasTrainingOnDate({
          date,
          trainingDates: group.trainingDates,
          weekdays: group.trainingWeekdays,
          windowDays: group.trainingWindowDays,
        });
        if (!hasTraining) continue;
        if (cancelledSet.has(`training_group:${group.id}|${date}`)) continue;

        for (const tg of normalizedGroups) coveredTeamGroups.add(tg);
        sessions.push({
          id: `${date}-group-${group.id}`,
          date,
          trainingTime: resolveTime(date, group.trainingTime, group.trainingDateTimes),
          scopeType: "trainingGroup",
          eventType: "training",
          label: group.name || "Сборен отбор",
          teamGroups: normalizedGroups,
        });
      }

      for (const teamGroup of allTeamGroups) {
        if (coveredTeamGroups.has(teamGroup)) continue;
        const groupSchedule = teamScheduleByGroup.get(teamGroup);
        const override = trainingGroupOverrideByTeamGroup.get(teamGroup);
        const hasTraining = hasTrainingOnDate({
          date,
          trainingDates: override?.trainingDates ?? groupSchedule?.trainingDates ?? club.trainingDates,
          weekdays: override?.trainingWeekdays ?? groupSchedule?.trainingWeekdays ?? club.trainingWeekdays,
          windowDays: override?.trainingWindowDays ?? groupSchedule?.trainingWindowDays ?? club.trainingWindowDays,
        });
        if (!hasTraining) continue;
        if (cancelledSet.has(`team_group:${teamGroup}|${date}`) || cancelledSet.has(`club|${date}`)) continue;

        const resolvedSchedule = groupSchedule ?? null;
        sessions.push({
          id: `${date}-team-${teamGroup}`,
          date,
          trainingTime: resolveTime(
            date,
            resolvedSchedule?.trainingTime ?? club.trainingTime,
            resolvedSchedule?.trainingDateTimes ?? club.trainingDateTimes,
          ),
          scopeType: "teamGroup",
          eventType: "training",
          label: `Отбор ${teamGroup}`,
          teamGroups: [teamGroup],
          limitedSpots: limitedEventByKey.get(`team_group:${teamGroup}|${date}`) ?? null,
        });
      }
    }

    for (const match of clubMatches) {
      sessions.push({
        id: `match-${match.id}`,
        date: match.matchDate,
        trainingTime: match.matchTime,
        scopeType: "teamGroup",
        eventType: "match",
        label: `${matchEventTypeLabel(match.eventType)} · ${match.opponent}`,
        teamGroups: match.teamGroups,
        location: match.location,
        scopeLabel: match.customGroup?.name ?? resolveMatchScopeLabel(match.teamGroups, trainingGroups),
        isHome: match.isHome,
        durationMinutes: match.durationMinutes,
        color: match.customGroup?.color ?? null,
        customGroupId: match.customGroupId ?? null,
      });
    }

    sessions.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.eventType !== b.eventType) return a.eventType === "training" ? -1 : 1;
      if (a.scopeType !== b.scopeType) return a.scopeType === "teamGroup" ? -1 : 1;
      return a.label.localeCompare(b.label, "bg");
    });

    return NextResponse.json({ dates, sessions });
  } catch (error) {
    console.error("Training attendance week GET error:", error);
    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
