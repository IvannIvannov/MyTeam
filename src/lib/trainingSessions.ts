import { Prisma } from "@prisma/client";
import { trainingRequiresCheckIn } from "@/lib/trainingAttendanceDefaults";
import { prisma } from "@/lib/db";
import { isoDateToUtcMidnight, utcDateToIsoDate } from "@/lib/training";

type TrainingSessionScope =
  | { type: "club" }
  | { type: "teamGroup"; teamGroup: number }
  | { type: "trainingGroup"; id: string; teamGroups?: number[] }
  | { type: "customGroup"; id: string }
  | { type: "coachGroup"; id: string };

type TrainingFieldSelectionByDate = Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }>;
type TrainingSessionWriter = {
  club: Pick<typeof prisma.club, "findUniqueOrThrow">;
  trainingSession: {
    deleteMany(args: Prisma.TrainingSessionDeleteManyArgs): Promise<Prisma.BatchPayload>;
    upsert(args: Prisma.TrainingSessionUpsertArgs): Promise<{ id: string }>;
  };
  trainingSessionPlayer: {
    findMany(args: Prisma.TrainingSessionPlayerFindManyArgs): Promise<Array<{ playerId: string | null }>>;
    deleteMany(args: Prisma.TrainingSessionPlayerDeleteManyArgs): Promise<Prisma.BatchPayload>;
    createMany(args: Prisma.TrainingSessionPlayerCreateManyArgs): Promise<Prisma.BatchPayload>;
    updateMany(args: Prisma.TrainingSessionPlayerUpdateManyArgs): Promise<Prisma.BatchPayload>;
  };
  trainingOptOut: {
    createMany(args: Prisma.TrainingOptOutCreateManyArgs): Promise<Prisma.BatchPayload>;
    findMany(args: Prisma.TrainingOptOutFindManyArgs): Promise<Array<{ playerId: string; trainingDate: Date; reasonCode: string | null; reasonText: string | null }>>;
  };
  player: {
    findMany(args: Prisma.PlayerFindManyArgs): Promise<Array<{ id: string; fullName: string; teamGroup: number | null }>>;
  };
};

export function getTrainingSessionScopeKey(scope: TrainingSessionScope) {
  if (scope.type === "club") return "club";
  if (scope.type === "teamGroup") return `team_group:${scope.teamGroup}`;
  if (scope.type === "trainingGroup") return `training_group:${scope.id}`;
  if (scope.type === "customGroup") return `custom_group:${scope.id}`;
  return `coach_group:${scope.id}`;
}

export function getTrainingSessionScopeData(scope: TrainingSessionScope) {
  return {
    scopeType: scope.type,
    scopeKey: getTrainingSessionScopeKey(scope),
    scopeId: scope.type === "trainingGroup" || scope.type === "customGroup" || scope.type === "coachGroup" ? scope.id : null,
    teamGroup: scope.type === "teamGroup" ? scope.teamGroup : null,
    teamGroups: scope.type === "trainingGroup" ? scope.teamGroups ?? [] : [],
  };
}

export async function filterCancelledTrainingDatesForScope(input: {
  clubId: string;
  scope: TrainingSessionScope;
  trainingDates: string[];
}) {
  if (input.trainingDates.length === 0) return [];
  const uniqueDates = Array.from(new Set(input.trainingDates)).sort((a, b) => a.localeCompare(b));
  const cancelled = await findCancelledSessionsForScope({
    clubId: input.clubId,
    scopeKey: getTrainingSessionScopeKey(input.scope),
    trainingDates: uniqueDates,
  });
  if (cancelled.size === 0) return uniqueDates;
  return uniqueDates.filter((date) => !cancelled.has(date));
}

async function findCancelledSessionsForScope(input: {
  clubId: string;
  scopeKey: string;
  trainingDates: string[];
}) {
  const rows = await prisma.trainingSession.findMany({
    where: {
      clubId: input.clubId,
      scopeKey: input.scopeKey,
      status: "cancelled",
      trainingDate: { in: input.trainingDates.map((date) => isoDateToUtcMidnight(date)) },
    },
    select: { trainingDate: true },
  });
  return new Set(rows.map((row) => utcDateToIsoDate(row.trainingDate)));
}

export async function syncFutureTrainingSessions(input: {
  tx: TrainingSessionWriter;
  clubId: string;
  scope: TrainingSessionScope;
  trainingDates: string[];
  trainingDateTimes: Record<string, string>;
  trainingDurationMinutes: number;
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
  trainingFieldSelections?: TrainingFieldSelectionByDate;
  todayIso: string;
}) {
  const scopeData = getTrainingSessionScopeData(input.scope);
  const futureDates = Array.from(new Set(input.trainingDates.filter((date) => date >= input.todayIso))).sort((a, b) => a.localeCompare(b));

  await input.tx.trainingSession.deleteMany({
    where: {
      clubId: input.clubId,
      scopeKey: scopeData.scopeKey,
      trainingDate: {
        gte: isoDateToUtcMidnight(input.todayIso),
      },
      ...(futureDates.length > 0
        ? {
            NOT: {
              trainingDate: {
                in: futureDates.map((date) => isoDateToUtcMidnight(date)),
              },
            },
          }
        : {}),
    },
  });

  if (futureDates.length === 0) return;
  const club = await input.tx.club.findUniqueOrThrow({ where: { id: input.clubId }, select: { paymentWorkflow: true } });
  const requiresCheckIn = trainingRequiresCheckIn(club.paymentWorkflow);

  // Fetch players once for the entire scope — same result for every date.
  const players = await getExpectedPlayersForScope(input.tx, input.clubId, input.scope);

  // Fetch all opt-outs for all future dates in one query instead of one per date.
  const allOptOuts = players.length > 0
    ? await input.tx.trainingOptOut.findMany({
        where: {
          playerId: { in: players.map((p) => p.id) },
          trainingDate: { in: futureDates.map((date) => isoDateToUtcMidnight(date)) },
        },
        select: { playerId: true, trainingDate: true, reasonCode: true, reasonText: true },
      })
    : [];

  const optOutsByDate = new Map<string, Map<string, typeof allOptOuts[number]>>();
  for (const optOut of allOptOuts) {
    const dateIso = utcDateToIsoDate(optOut.trainingDate);
    let byPlayer = optOutsByDate.get(dateIso);
    if (!byPlayer) {
      byPlayer = new Map();
      optOutsByDate.set(dateIso, byPlayer);
    }
    byPlayer.set(optOut.playerId, optOut);
  }

  for (const date of futureDates) {
    const fieldSelection = input.trainingFieldSelections?.[date];
    const session = await input.tx.trainingSession.upsert({
      where: {
        clubId_scopeKey_trainingDate: {
          clubId: input.clubId,
          scopeKey: scopeData.scopeKey,
          trainingDate: isoDateToUtcMidnight(date),
          occurrenceKey: "",
        },
      },
      update: {
        ...scopeData,
        trainingTime: input.trainingDateTimes[date] ?? null,
        trainingDurationMinutes: input.trainingDurationMinutes,
        trainingFieldId: fieldSelection?.trainingFieldId ?? input.trainingFieldId,
        trainingFieldPieceIds: fieldSelection?.trainingFieldPieceIds ?? input.trainingFieldPieceIds,
        status: "scheduled",
      },
      create: {
        clubId: input.clubId,
        ...scopeData,
        trainingDate: isoDateToUtcMidnight(date),
        trainingTime: input.trainingDateTimes[date] ?? null,
        trainingDurationMinutes: input.trainingDurationMinutes,
        trainingFieldId: fieldSelection?.trainingFieldId ?? input.trainingFieldId,
        trainingFieldPieceIds: fieldSelection?.trainingFieldPieceIds ?? input.trainingFieldPieceIds,
        status: "scheduled",
      },
      select: { id: true },
    });
    const optOutByPlayerId = optOutsByDate.get(date) ?? new Map();
    const roster = await input.tx.trainingSessionPlayer.findMany({ where: { trainingSessionId: session.id }, select: { playerId: true } });
    const enrolled = new Set(roster.map((player) => player.playerId));
    await input.tx.trainingSessionPlayer.deleteMany({ where: { trainingSessionId: session.id, playerId: { notIn: players.map((player) => player.id) }, creditChargedAt: null, attendanceRecorded: false } });
    const newPlayers = players.filter((player) => !enrolled.has(player.id));
    // Legacy views use day-wide opt-outs. Seed only new roster entries so
    // saving a schedule never resets an existing attendance decision.
    if (newPlayers.length > 0) {
      if (requiresCheckIn) await input.tx.trainingOptOut.createMany({
        data: newPlayers.map((player) => ({ playerId: player.id, trainingDate: isoDateToUtcMidnight(date) })),
        skipDuplicates: true,
      });
      await input.tx.trainingSessionPlayer.createMany({
        data: newPlayers.map((player) => {
          const optOut = optOutByPlayerId.get(player.id);
          return {
            trainingSessionId: session.id,
            playerId: player.id,
            playerName: player.fullName,
            teamGroup: player.teamGroup,
            present: !requiresCheckIn && !optOut,
            reasonCode: optOut?.reasonCode ?? null,
            reasonText: optOut?.reasonText ?? null,
          };
        }),
        skipDuplicates: true,
      });
    }
  }
}

async function getExpectedPlayersForScope(
  tx: Pick<TrainingSessionWriter, "player">,
  clubId: string,
  scope: TrainingSessionScope,
) {
  return tx.player.findMany({
    where: {
      clubId,
      isActive: true,
      ...(scope.type === "teamGroup" ? { teamGroup: scope.teamGroup } : {}),
      ...(scope.type === "trainingGroup" ? { teamGroup: { in: scope.teamGroups ?? [] } } : {}),
      ...(scope.type === "customGroup" ? { customTrainingGroups: { some: { groupId: scope.id } } } : {}),
      ...(scope.type === "coachGroup" ? { coachGroups: { some: { id: scope.id } } } : {}),
    },
    select: {
      id: true,
      fullName: true,
      teamGroup: true,
    },
    orderBy: { fullName: "asc" },
  });
}

export async function updateTrainingSessionPlayerAttendance(input: {
  tx: Pick<TrainingSessionWriter, "trainingSessionPlayer">;
  clubId: string;
  playerId: string;
  trainingDate: string;
  optedOut: boolean;
  reasonCode?: string | null;
  reasonText?: string | null;
}) {
  await input.tx.trainingSessionPlayer.updateMany({
    where: {
      playerId: input.playerId,
      trainingSession: {
        clubId: input.clubId,
        scopeType: { not: "coachGroup" },
        trainingDate: isoDateToUtcMidnight(input.trainingDate),
      },
    },
    data: {
      present: !input.optedOut,
      attendanceRecorded: true,
      reasonCode: input.optedOut ? input.reasonCode ?? null : null,
      reasonText: input.optedOut ? input.reasonText ?? null : null,
    },
  });
}

export async function deleteFutureTrainingSessionsForScope(input: {
  tx: TrainingSessionWriter;
  clubId: string;
  scope: TrainingSessionScope;
  todayIso: string;
}) {
  await input.tx.trainingSession.deleteMany({
    where: {
      clubId: input.clubId,
      scopeKey: getTrainingSessionScopeKey(input.scope),
      trainingDate: {
        gte: isoDateToUtcMidnight(input.todayIso),
      },
    },
  });
}
