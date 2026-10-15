import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getConfiguredTrainingDates, getTodayIsoDateInTimeZone, isoDateToUtcMidnight } from "@/lib/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";


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
  const todayAsDate = isoDateToUtcMidnight(todayIso);

  try {
    const [club, teamSchedules, trainingGroups, customTrainingGroups, players, note] = await Promise.all([
      prisma.club.findUnique({
        where: { id },
        select: {
          id: true,
          trainingDates: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
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
        },
      }),
      prisma.clubCustomTrainingGroup.findMany({
        where: { clubId: id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          trainingDates: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          players: { select: { playerId: true } },
        },
      }),
      prisma.player.findMany({
        where: {
          clubId: id,
          isActive: true,
        },
        select: {
          id: true,
          teamGroup: true,
        },
      }),
      prisma.trainingNote.findFirst({
        where: {
          clubId: id,
          trainingDate: todayAsDate,
          scopeKey: "club",
        },
        select: {
          note: true,
        },
      }),
    ]);

    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    const playerIds = players.map((player) => player.id);
    const optOuts = playerIds.length
      ? await prisma.trainingOptOut.findMany({
          where: {
            trainingDate: todayAsDate,
            playerId: {
              in: playerIds,
            },
          },
          select: {
            playerId: true,
          },
        })
      : [];

    const playerTeamGroupById = new Map<string, number>();
    const totalByTeamGroup = new Map<number, number>();
    for (const player of players) {
      if (!Number.isInteger(player.teamGroup)) {
        continue;
      }
      const teamGroup = Number(player.teamGroup);
      playerTeamGroupById.set(player.id, teamGroup);
      totalByTeamGroup.set(teamGroup, (totalByTeamGroup.get(teamGroup) ?? 0) + 1);
    }

    const optedOutByTeamGroup = new Map<number, number>();
    for (const optOut of optOuts) {
      const teamGroup = playerTeamGroupById.get(optOut.playerId);
      if (typeof teamGroup !== "number") {
        continue;
      }
      optedOutByTeamGroup.set(teamGroup, (optedOutByTeamGroup.get(teamGroup) ?? 0) + 1);
    }

    if (club.trainingGroupMode === "custom_group") {
      const optedOutPlayerIds = new Set(optOuts.map((item) => item.playerId));
      const sessions = customTrainingGroups
        .filter((group) =>
          hasTrainingOnDate({
            date: todayIso,
            trainingDates: group.trainingDates,
            weekdays: group.trainingWeekdays,
            windowDays: group.trainingWindowDays,
          }),
        )
        .map((group) => {
          const playerIds = Array.from(new Set(group.players.map((item) => item.playerId)));
          const total = playerIds.length;
          const optedOut = playerIds.filter((playerId) => optedOutPlayerIds.has(playerId)).length;
          return {
            id: `custom-${group.id}`,
            scopeType: "trainingGroup" as const,
            label: group.name || "Custom group",
            teamGroups: [],
            stats: {
              total,
              optedOut,
              attending: Math.max(0, total - optedOut),
            },
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, "bg"));

      return NextResponse.json({
        date: todayIso,
        note: note?.note ?? "",
        sessions,
      });
    }

    const teamScheduleByGroup = new Map<number, (typeof teamSchedules)[number]>();
    for (const schedule of teamSchedules) {
      teamScheduleByGroup.set(schedule.teamGroup, schedule);
    }

    const trainingGroupOverrideByTeamGroup = new Map<number, (typeof trainingGroups)[number]>();
    for (const group of trainingGroups) {
      const hasExplicitDates = Array.isArray(group.trainingDates) && group.trainingDates.length > 0;
      if (!hasExplicitDates) {
        continue;
      }
      for (const teamGroup of group.teamGroups ?? []) {
        if (!Number.isInteger(teamGroup) || trainingGroupOverrideByTeamGroup.has(teamGroup)) {
          continue;
        }
        trainingGroupOverrideByTeamGroup.set(teamGroup, group);
      }
    }

    const allTeamGroups = Array.from(
      new Set([
        ...Array.from(totalByTeamGroup.keys()),
        ...teamSchedules.map((item) => item.teamGroup),
        ...trainingGroups.flatMap((item) => item.teamGroups ?? []),
      ]),
    )
      .filter((value) => Number.isInteger(value))
      .sort((a, b) => a - b);

    const sessions: Array<{
      id: string;
      scopeType: "teamGroup" | "trainingGroup";
      label: string;
      teamGroups: number[];
      stats: {
        total: number;
        attending: number;
        optedOut: number;
      };
    }> = [];

    const todayTrainingGroups: Array<{
      id: string;
      name: string;
      teamGroups: number[];
    }> = [];
    for (const group of trainingGroups) {
      const normalizedGroups = Array.from(
        new Set((group.teamGroups ?? []).filter((value) => Number.isInteger(value))),
      ).sort((a, b) => a - b);
      if (normalizedGroups.length === 0) {
        continue;
      }
      const hasTraining = hasTrainingOnDate({
        date: todayIso,
        trainingDates: group.trainingDates,
        weekdays: group.trainingWeekdays,
        windowDays: group.trainingWindowDays,
      });
      if (!hasTraining) {
        continue;
      }
      todayTrainingGroups.push({
        id: group.id,
        name: group.name || "Сборен отбор",
        teamGroups: normalizedGroups,
      });
      const total = normalizedGroups.reduce((sum, teamGroup) => sum + (totalByTeamGroup.get(teamGroup) ?? 0), 0);
      const optedOut = normalizedGroups.reduce((sum, teamGroup) => sum + (optedOutByTeamGroup.get(teamGroup) ?? 0), 0);
      sessions.push({
        id: `group-${group.id}`,
        scopeType: "trainingGroup",
        label: group.name || "Сборен отбор",
        teamGroups: normalizedGroups,
        stats: {
          total,
          optedOut,
          attending: Math.max(0, total - optedOut),
        },
      });
    }

    const teamGroupsCoveredByTrainingGroups = new Set(
      todayTrainingGroups.flatMap((group) => group.teamGroups),
    );

    for (const teamGroup of allTeamGroups) {
      if (teamGroupsCoveredByTrainingGroups.has(teamGroup)) {
        continue;
      }
      const groupSchedule = teamScheduleByGroup.get(teamGroup);
      const override = trainingGroupOverrideByTeamGroup.get(teamGroup);
      const hasTraining = hasTrainingOnDate({
        date: todayIso,
        trainingDates: override?.trainingDates ?? groupSchedule?.trainingDates ?? club.trainingDates,
        weekdays: override?.trainingWeekdays ?? groupSchedule?.trainingWeekdays ?? club.trainingWeekdays,
        windowDays: override?.trainingWindowDays ?? groupSchedule?.trainingWindowDays ?? club.trainingWindowDays,
      });
      if (!hasTraining) {
        continue;
      }
      const total = totalByTeamGroup.get(teamGroup) ?? 0;
      const optedOut = optedOutByTeamGroup.get(teamGroup) ?? 0;
      sessions.push({
        id: `team-${teamGroup}`,
        scopeType: "teamGroup",
        label: `Отбор ${teamGroup}`,
        teamGroups: [teamGroup],
        stats: {
          total,
          optedOut,
          attending: Math.max(0, total - optedOut),
        },
      });
    }

    sessions.sort((a, b) => {
      if (a.scopeType !== b.scopeType) {
        return a.scopeType === "teamGroup" ? -1 : 1;
      }
      return a.label.localeCompare(b.label, "bg");
    });

    return NextResponse.json({
      date: todayIso,
      note: note?.note ?? "",
      sessions,
    });
  } catch (error) {
    console.error("Training attendance today GET error:", error);
    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
