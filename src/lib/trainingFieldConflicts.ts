import { prisma } from "@/lib/db";

interface TrainingFieldConflictInput {
  clubId: string;
  trainingDates: string[];
  trainingDateTimes: Record<string, string>;
  trainingDurationMinutes: number;
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
  trainingFieldSelections?: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }>;
  exclude?: {
    type: "club" | "teamGroup" | "trainingGroup" | "customGroup" | "coachGroup";
    id?: string;
    teamGroup?: number | null;
    sessionId?: string;
    sessionIds?: string[];
  };
  excludeTeamGroups?: number[];
}

type ScheduleType = NonNullable<TrainingFieldConflictInput["exclude"]>["type"];

interface ExistingSchedule {
  sessionId?: string;
  label: string;
  type: ScheduleType;
  id?: string;
  teamGroup?: number | null;
  teamGroups?: number[];
  scopeKey: string;
  cancelledDates: Set<string>;
  trainingDates: string[];
  trainingDateTimes: unknown;
  trainingDurationMinutes: number;
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
  trainingFieldSelections: unknown;
}

export interface OccupiedFieldResource {
  date: string;
  fieldId: string;
  pieceIds: string[];
  label: string;
}

interface OccupiedResourcesInput {
  clubId: string;
  trainingDates: string[];
  trainingDateTimes: Record<string, string>;
  trainingDurationMinutes: number;
  exclude?: TrainingFieldConflictInput["exclude"];
  excludeTeamGroups?: number[];
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeStoredDateTimes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && parseTimeToMinutes(value) !== null) {
      result[date] = value.trim();
    }
  }
  return result;
}

function normalizeStoredFieldSelections(
  raw: unknown,
): Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const source = value as Record<string, unknown>;
    const trainingFieldId = typeof source.trainingFieldId === "string" && source.trainingFieldId.trim()
      ? source.trainingFieldId.trim()
      : null;
    const trainingFieldPieceIds = Array.isArray(source.trainingFieldPieceIds)
      ? source.trainingFieldPieceIds.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    result[date] = { trainingFieldId, trainingFieldPieceIds };
  }
  return result;
}

function getFieldSelectionForDate(
  schedule: Pick<ExistingSchedule, "trainingFieldId" | "trainingFieldPieceIds" | "trainingFieldSelections">,
  date: string,
) {
  const selections = normalizeStoredFieldSelections(schedule.trainingFieldSelections);
  return selections[date] ?? {
    trainingFieldId: schedule.trainingFieldId,
    trainingFieldPieceIds: schedule.trainingFieldPieceIds,
  };
}

function areNumberArraysEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  const left = [...(a ?? [])].sort((x, y) => x - y);
  const right = [...(b ?? [])].sort((x, y) => x - y);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areStringArraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areFieldSelectionsEqual(
  a: { trainingFieldId: string | null; trainingFieldPieceIds: string[] },
  b: { trainingFieldId: string | null; trainingFieldPieceIds: string[] },
): boolean {
  return a.trainingFieldId === b.trainingFieldId &&
    areStringArraysEqual(a.trainingFieldPieceIds, b.trainingFieldPieceIds);
}

function pickDateTimes(raw: Record<string, string>, dates: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const date of dates) {
    if (raw[date]) {
      result[date] = raw[date];
    }
  }
  return result;
}

function pickFieldSelections(
  raw: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }>,
  dates: string[],
) {
  const result: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }> = {};
  for (const date of dates) {
    if (raw[date]) {
      result[date] = raw[date];
    }
  }
  return result;
}

export function pickTrainingConflictCheckInput(input: {
  checkDates?: string[];
  previousDates: string[];
  previousDateTimes: unknown;
  previousDurationMinutes: number;
  previousFieldId?: string | null;
  previousFieldPieceIds?: string[];
  previousFieldSelections?: unknown;
  previousTeamGroups?: number[];
  nextDates: string[];
  nextDateTimes: Record<string, string>;
  nextDurationMinutes: number;
  nextFieldId?: string | null;
  nextFieldPieceIds?: string[];
  nextFieldSelections?: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }>;
  nextTeamGroups?: number[];
}): {
  trainingDates: string[];
  trainingDateTimes: Record<string, string>;
  trainingFieldSelections: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }>;
} {
  const previousDateSet = new Set(input.previousDates);
  const previousDateTimes = normalizeStoredDateTimes(input.previousDateTimes);
  const previousFieldSelections = normalizeStoredFieldSelections(input.previousFieldSelections);
  const nextFieldSelections = input.nextFieldSelections ?? {};
  const checkDateSet = input.checkDates
    ? new Set(input.checkDates.filter((date) => input.nextDates.includes(date)))
    : null;

  const globalChange =
    input.previousDurationMinutes !== input.nextDurationMinutes ||
    !areNumberArraysEqual(input.previousTeamGroups, input.nextTeamGroups) ||
    input.previousFieldId !== input.nextFieldId ||
    !areStringArraysEqual(input.previousFieldPieceIds, input.nextFieldPieceIds);

  const trainingDates = input.nextDates.filter((date) => {
    if (checkDateSet && !checkDateSet.has(date)) {
      return false;
    }
    if (globalChange || !previousDateSet.has(date)) {
      return true;
    }
    if ((previousDateTimes[date] ?? "") !== (input.nextDateTimes[date] ?? "")) {
      return true;
    }
    const previousSelection = previousFieldSelections[date] ?? {
      trainingFieldId: input.previousFieldId ?? null,
      trainingFieldPieceIds: input.previousFieldPieceIds ?? [],
    };
    const nextSelection = nextFieldSelections[date] ?? {
      trainingFieldId: input.nextFieldId ?? null,
      trainingFieldPieceIds: input.nextFieldPieceIds ?? [],
    };
    return !areFieldSelectionsEqual(previousSelection, nextSelection);
  });

  return {
    trainingDates,
    trainingDateTimes: pickDateTimes(input.nextDateTimes, trainingDates),
    trainingFieldSelections: pickFieldSelections(nextFieldSelections, trainingDates),
  };
}

function isSameExcludedSchedule(
  schedule: ExistingSchedule,
  exclude: TrainingFieldConflictInput["exclude"],
): boolean {
  if (!exclude || schedule.type !== exclude.type) {
    return false;
  }
  if (exclude.sessionId) return schedule.sessionId === exclude.sessionId;
  if (exclude.sessionIds) return Boolean(schedule.sessionId && exclude.sessionIds.includes(schedule.sessionId));
  if (exclude.type === "teamGroup") {
    return schedule.teamGroup === exclude.teamGroup;
  }
  if (exclude.type === "club") {
    return true;
  }
  return Boolean(exclude.id && schedule.id === exclude.id);
}

function isExcludedTeamGroupSchedule(
  schedule: ExistingSchedule,
  excludedTeamGroups: Set<number>,
): boolean {
  if (schedule.type === "teamGroup" && typeof schedule.teamGroup === "number") {
    return excludedTeamGroups.has(schedule.teamGroup);
  }
  if (schedule.type === "trainingGroup" && Array.isArray(schedule.teamGroups)) {
    return schedule.teamGroups.some((teamGroup) => excludedTeamGroups.has(teamGroup));
  }
  return false;
}

function isSameFieldResource(a: {
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
}, b: {
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
}): boolean {
  if (!a.trainingFieldId || !b.trainingFieldId || a.trainingFieldId !== b.trainingFieldId) {
    return false;
  }

  // Whole-field booking (empty array) conflicts with any other booking on the same field.
  if (a.trainingFieldPieceIds.length === 0 || b.trainingFieldPieceIds.length === 0) {
    return true;
  }

  // Both have specific pieces — conflict if any piece overlaps.
  return a.trainingFieldPieceIds.some((id) => b.trainingFieldPieceIds.includes(id));
}

function overlaps(startA: number, durationA: number, startB: number, durationB: number): boolean {
  return startA < startB + durationB && startB < startA + durationA;
}

function matchTeamGroupsOverlap(a: number[], b: number[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((teamGroup) => b.includes(teamGroup));
}

function matchScopesOverlap(input: {
  nextTeamGroups: number[];
  nextCustomGroupId?: string | null;
  existingTeamGroups: number[];
  existingCustomGroupId?: string | null;
}): boolean {
  const nextCustomGroupId = input.nextCustomGroupId ?? null;
  const existingCustomGroupId = input.existingCustomGroupId ?? null;

  if (nextCustomGroupId || existingCustomGroupId) {
    if (nextCustomGroupId && existingCustomGroupId) {
      return nextCustomGroupId === existingCustomGroupId;
    }
    return matchTeamGroupsOverlap(input.nextTeamGroups, input.existingTeamGroups);
  }

  return matchTeamGroupsOverlap(input.nextTeamGroups, input.existingTeamGroups);
}

function formatIsoDateForBgDisplay(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function formatMinutesAsTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatConflictMessage(input: {
  date: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
}): string {
  const startTime = formatMinutesAsTime(input.startMinutes);
  const endTime = formatMinutesAsTime(input.startMinutes + input.durationMinutes);
  return `Теренът вече е зает на ${formatIsoDateForBgDisplay(input.date)} от ${startTime} до ${endTime} за ${input.label}.`;
}

function formatTimeConflictMessage(input: {
  date: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
}): string {
  const startTime = formatMinutesAsTime(input.startMinutes);
  const endTime = formatMinutesAsTime(input.startMinutes + input.durationMinutes);
  return `На ${formatIsoDateForBgDisplay(input.date)} вече има тренировка от ${startTime} до ${endTime} за ${input.label}.`;
}

async function loadCancelledSessionSet(clubId: string, relevantDates: string[]) {
  if (relevantDates.length === 0) return new Set<string>();
  const rows = await prisma.trainingSession.findMany({
    where: {
      clubId,
      status: "cancelled",
      trainingDate: { in: relevantDates.map((date) => new Date(`${date}T00:00:00.000Z`)) },
    },
    select: { scopeKey: true, trainingDate: true },
  });
  return new Set(rows.map((row) => `${row.scopeKey}|${row.trainingDate.toISOString().slice(0, 10)}`));
}

function getCancelledDatesForScope(cancelledSet: Set<string>, scopeKey: string, relevantDates: string[]) {
  return new Set(relevantDates.filter((date) => cancelledSet.has(`${scopeKey}|${date}`)));
}

async function loadCoachSessionSchedules(clubId: string, relevantDates: string[]): Promise<ExistingSchedule[]> {
  const [sessions, groups] = await Promise.all([
    prisma.trainingSession.findMany({ where: { clubId, scopeType: "coachGroup", status: "scheduled", trainingDate: { in: relevantDates.map((d) => new Date(`${d}T00:00:00Z`)) } } }),
    prisma.coachGroup.findMany({ where: { clubId }, select: { id: true, name: true } }),
  ]);
  const names = new Map(groups.map((g) => [g.id, g.name]));
  return sessions.map((s) => {
    const date = s.trainingDate.toISOString().slice(0, 10);
    return { label: `треньорска група ${names.get(s.scopeId ?? "") ?? ""}`, type: "coachGroup", id: s.scopeId ?? undefined, sessionId: s.id, scopeKey: s.scopeKey, cancelledDates: new Set<string>(), trainingDates: [date], trainingDateTimes: { [date]: s.trainingTime }, trainingDurationMinutes: s.trainingDurationMinutes, trainingFieldId: s.trainingFieldId, trainingFieldPieceIds: s.trainingFieldPieceIds, trainingFieldSelections: null };
  });
}

async function loadSchedules(clubId: string, relevantDates: string[]): Promise<ExistingSchedule[]> {
  const [club, teamSchedules, trainingGroups, customGroups, coachGroups, cancelledSet] = await Promise.all([
    prisma.club.findUnique({
      where: { id: clubId },
      select: {
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    prisma.clubTrainingGroupSchedule.findMany({
      where: {
        clubId,
        trainingDates: { hasSome: relevantDates },
        trainingFieldId: { not: null },
      },
      select: {
        teamGroup: true,
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    prisma.clubTrainingScheduleGroup.findMany({
      where: {
        clubId,
        trainingDates: { hasSome: relevantDates },
        trainingFieldId: { not: null },
      },
      select: {
        id: true,
        name: true,
        teamGroups: true,
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    prisma.clubCustomTrainingGroup.findMany({
      where: {
        clubId,
        trainingDates: { hasSome: relevantDates },
        trainingFieldId: { not: null },
      },
      select: {
        id: true,
        name: true,
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    loadCoachSessionSchedules(clubId, relevantDates),
    loadCancelledSessionSet(clubId, relevantDates),
  ]);

  const schedules: ExistingSchedule[] = [];

  if (club?.trainingFieldId && club.trainingDates.some((date) => relevantDates.includes(date))) {
    schedules.push({
      label: "клубен график",
      type: "club",
      scopeKey: "club",
      cancelledDates: getCancelledDatesForScope(cancelledSet, "club", relevantDates),
      trainingDates: club.trainingDates,
      trainingDateTimes: club.trainingDateTimes,
      trainingDurationMinutes: club.trainingDurationMinutes,
      trainingFieldId: club.trainingFieldId,
      trainingFieldPieceIds: club.trainingFieldPieceIds,
      trainingFieldSelections: club.trainingFieldSelections,
    });
  }

  for (const schedule of teamSchedules) {
    schedules.push({
      label: `набор ${schedule.teamGroup}`,
      type: "teamGroup",
      teamGroup: schedule.teamGroup,
      scopeKey: `team_group:${schedule.teamGroup}`,
      cancelledDates: getCancelledDatesForScope(cancelledSet, `team_group:${schedule.teamGroup}`, relevantDates),
      trainingDates: schedule.trainingDates,
      trainingDateTimes: schedule.trainingDateTimes,
      trainingDurationMinutes: schedule.trainingDurationMinutes,
      trainingFieldId: schedule.trainingFieldId,
      trainingFieldPieceIds: schedule.trainingFieldPieceIds,
      trainingFieldSelections: schedule.trainingFieldSelections,
    });
  }

  for (const group of trainingGroups) {
    schedules.push({
      label: `сборен отбор ${group.name}`,
      type: "trainingGroup",
      id: group.id,
      teamGroups: group.teamGroups,
      scopeKey: `training_group:${group.id}`,
      cancelledDates: getCancelledDatesForScope(cancelledSet, `training_group:${group.id}`, relevantDates),
      trainingDates: group.trainingDates,
      trainingDateTimes: group.trainingDateTimes,
      trainingDurationMinutes: group.trainingDurationMinutes,
      trainingFieldId: group.trainingFieldId,
      trainingFieldPieceIds: group.trainingFieldPieceIds,
      trainingFieldSelections: group.trainingFieldSelections,
    });
  }

  for (const group of customGroups) {
    schedules.push({
      label: `персонализирана група ${group.name}`,
      type: "customGroup",
      id: group.id,
      scopeKey: `custom_group:${group.id}`,
      cancelledDates: getCancelledDatesForScope(cancelledSet, `custom_group:${group.id}`, relevantDates),
      trainingDates: group.trainingDates,
      trainingDateTimes: group.trainingDateTimes,
      trainingDurationMinutes: group.trainingDurationMinutes,
      trainingFieldId: group.trainingFieldId,
      trainingFieldPieceIds: group.trainingFieldPieceIds,
      trainingFieldSelections: group.trainingFieldSelections,
    });
  }

  schedules.push(...coachGroups);

  return schedules;
}

async function loadAllSchedules(clubId: string, relevantDates: string[]): Promise<ExistingSchedule[]> {
  const [club, teamSchedules, trainingGroups, customGroups, coachGroups, cancelledSet] = await Promise.all([
    prisma.club.findUnique({
      where: { id: clubId },
      select: {
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    prisma.clubTrainingGroupSchedule.findMany({
      where: { clubId, trainingDates: { hasSome: relevantDates } },
      select: {
        teamGroup: true,
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    prisma.clubTrainingScheduleGroup.findMany({
      where: { clubId, trainingDates: { hasSome: relevantDates } },
      select: {
        id: true,
        name: true,
        teamGroups: true,
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    prisma.clubCustomTrainingGroup.findMany({
      where: { clubId, trainingDates: { hasSome: relevantDates } },
      select: {
        id: true,
        name: true,
        trainingDates: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        trainingFieldSelections: true,
      },
    }),
    loadCoachSessionSchedules(clubId, relevantDates),
    loadCancelledSessionSet(clubId, relevantDates),
  ]);

  const schedules: ExistingSchedule[] = [];

  if (club && club.trainingDates.some((date) => relevantDates.includes(date))) {
    schedules.push({
      label: "клубен график",
      type: "club",
      scopeKey: "club",
      cancelledDates: getCancelledDatesForScope(cancelledSet, "club", relevantDates),
      trainingDates: club.trainingDates,
      trainingDateTimes: club.trainingDateTimes,
      trainingDurationMinutes: club.trainingDurationMinutes,
      trainingFieldId: club.trainingFieldId,
      trainingFieldPieceIds: club.trainingFieldPieceIds,
      trainingFieldSelections: club.trainingFieldSelections,
    });
  }

  for (const schedule of teamSchedules) {
    schedules.push({
      label: `набор ${schedule.teamGroup}`,
      type: "teamGroup",
      teamGroup: schedule.teamGroup,
      scopeKey: `team_group:${schedule.teamGroup}`,
      cancelledDates: getCancelledDatesForScope(cancelledSet, `team_group:${schedule.teamGroup}`, relevantDates),
      trainingDates: schedule.trainingDates,
      trainingDateTimes: schedule.trainingDateTimes,
      trainingDurationMinutes: schedule.trainingDurationMinutes,
      trainingFieldId: schedule.trainingFieldId,
      trainingFieldPieceIds: schedule.trainingFieldPieceIds,
      trainingFieldSelections: schedule.trainingFieldSelections,
    });
  }

  for (const group of trainingGroups) {
    schedules.push({
      label: `сборен отбор ${group.name}`,
      type: "trainingGroup",
      id: group.id,
      teamGroups: group.teamGroups,
      scopeKey: `training_group:${group.id}`,
      cancelledDates: getCancelledDatesForScope(cancelledSet, `training_group:${group.id}`, relevantDates),
      trainingDates: group.trainingDates,
      trainingDateTimes: group.trainingDateTimes,
      trainingDurationMinutes: group.trainingDurationMinutes,
      trainingFieldId: group.trainingFieldId,
      trainingFieldPieceIds: group.trainingFieldPieceIds,
      trainingFieldSelections: group.trainingFieldSelections,
    });
  }

  for (const group of customGroups) {
    schedules.push({
      label: `персонализирана група ${group.name}`,
      type: "customGroup",
      id: group.id,
      scopeKey: `custom_group:${group.id}`,
      cancelledDates: getCancelledDatesForScope(cancelledSet, `custom_group:${group.id}`, relevantDates),
      trainingDates: group.trainingDates,
      trainingDateTimes: group.trainingDateTimes,
      trainingDurationMinutes: group.trainingDurationMinutes,
      trainingFieldId: group.trainingFieldId,
      trainingFieldPieceIds: group.trainingFieldPieceIds,
      trainingFieldSelections: group.trainingFieldSelections,
    });
  }

  schedules.push(...coachGroups);

  return schedules;
}

export async function assertNoTrainingFieldConflict(input: TrainingFieldConflictInput): Promise<void> {
  const hasAnySelectedField = input.trainingFieldId || Object.values(input.trainingFieldSelections ?? {}).some(
    (selection) => selection.trainingFieldId,
  );
  if (!hasAnySelectedField || input.trainingDates.length === 0) {
    return;
  }

  const relevantDates = Array.from(new Set(input.trainingDates));
  const schedules = await loadSchedules(input.clubId, relevantDates);
  const excludedTeamGroups = new Set(input.excludeTeamGroups ?? []);

  for (const schedule of schedules) {
    if (
      isSameExcludedSchedule(schedule, input.exclude) ||
      isExcludedTeamGroupSchedule(schedule, excludedTeamGroups)
    ) {
      continue;
    }

    const scheduleDateTimes = normalizeStoredDateTimes(schedule.trainingDateTimes);
    for (const date of relevantDates) {
      if (!schedule.trainingDates.includes(date)) {
        continue;
      }
      if (schedule.cancelledDates.has(date)) {
        continue;
      }
      const inputSelection = input.trainingFieldSelections?.[date] ?? input;
      const scheduleSelection = getFieldSelectionForDate(schedule, date);
      if (!isSameFieldResource(scheduleSelection, inputSelection)) {
        continue;
      }
      const nextStart = parseTimeToMinutes(input.trainingDateTimes[date] ?? "");
      const existingTime = scheduleDateTimes[date] ?? "";
      const existingStart = parseTimeToMinutes(existingTime);
      if (nextStart === null || existingStart === null) {
        continue;
      }
      if (overlaps(nextStart, input.trainingDurationMinutes, existingStart, schedule.trainingDurationMinutes)) {
        throw new Error(formatConflictMessage({
          date,
          startMinutes: existingStart,
          durationMinutes: schedule.trainingDurationMinutes,
          label: schedule.label,
        }));
      }
    }
  }
}

export async function assertNoTrainingTimeConflict(input: {
  clubId: string;
  trainingDates: string[];
  trainingDateTimes: Record<string, string>;
  trainingDurationMinutes: number;
  exclude?: TrainingFieldConflictInput["exclude"];
  excludeTeamGroups?: number[];
  ignoreFieldResourceSchedules?: boolean;
}): Promise<void> {
  if (input.trainingDates.length === 0) return;

  const relevantDates = Array.from(new Set(input.trainingDates));
  const schedules = await loadAllSchedules(input.clubId, relevantDates);
  const excludedTeamGroups = new Set(input.excludeTeamGroups ?? []);

  for (const schedule of schedules) {
    if (
      isSameExcludedSchedule(schedule, input.exclude) ||
      isExcludedTeamGroupSchedule(schedule, excludedTeamGroups)
    ) {
      continue;
    }

    const scheduleDateTimes = normalizeStoredDateTimes(schedule.trainingDateTimes);
    for (const date of relevantDates) {
      if (!schedule.trainingDates.includes(date)) continue;
      if (schedule.cancelledDates.has(date)) continue;
      if (input.ignoreFieldResourceSchedules && getFieldSelectionForDate(schedule, date).trainingFieldId) {
        continue;
      }
      const nextStart = parseTimeToMinutes(input.trainingDateTimes[date] ?? "");
      const existingStart = parseTimeToMinutes(scheduleDateTimes[date] ?? "");
      if (nextStart === null || existingStart === null) continue;
      if (overlaps(nextStart, input.trainingDurationMinutes, existingStart, schedule.trainingDurationMinutes)) {
        throw new Error(formatTimeConflictMessage({
          date,
          startMinutes: existingStart,
          durationMinutes: schedule.trainingDurationMinutes,
          label: schedule.label,
        }));
      }
    }
  }
}

export async function getOccupiedFieldResources(input: OccupiedResourcesInput): Promise<OccupiedFieldResource[]> {
  if (input.trainingDates.length === 0) {
    return [];
  }

  const relevantDates = Array.from(new Set(input.trainingDates));
  const schedules = await loadSchedules(input.clubId, relevantDates);
  const excludedTeamGroups = new Set(input.excludeTeamGroups ?? []);

  const seen = new Set<string>();
  const resources: OccupiedFieldResource[] = [];

  for (const schedule of schedules) {
    if (
      isSameExcludedSchedule(schedule, input.exclude) ||
      isExcludedTeamGroupSchedule(schedule, excludedTeamGroups)
    ) {
      continue;
    }

    const scheduleDateTimes = normalizeStoredDateTimes(schedule.trainingDateTimes);

    for (const date of relevantDates) {
      if (!schedule.trainingDates.includes(date)) {
        continue;
      }
      if (schedule.cancelledDates.has(date)) {
        continue;
      }
      const scheduleSelection = getFieldSelectionForDate(schedule, date);
      if (!scheduleSelection.trainingFieldId) {
        continue;
      }
      const nextStart = parseTimeToMinutes(input.trainingDateTimes[date] ?? "");
      const existingStart = parseTimeToMinutes(scheduleDateTimes[date] ?? "");
      if (nextStart === null || existingStart === null) {
        continue;
      }
      if (overlaps(nextStart, input.trainingDurationMinutes, existingStart, schedule.trainingDurationMinutes)) {
        const key = `${date}:${scheduleSelection.trainingFieldId}:${[...scheduleSelection.trainingFieldPieceIds].sort().join(",")}:${schedule.label}`;
        if (!seen.has(key)) {
          seen.add(key);
          resources.push({
            date,
            fieldId: scheduleSelection.trainingFieldId,
            pieceIds: scheduleSelection.trainingFieldPieceIds,
            label: schedule.label,
          });
        }
      }
    }
  }

  return resources;
}

export interface MatchConflictResult {
  blocking: string | null;
  warning: string | null;
}

export async function checkAwayMatchTrainingConflict(input: {
  clubId: string;
  matchDate: string;
  matchTime: string;
  durationMinutes: number;
  teamGroups: number[];
  customGroupId?: string | null;
  isHome?: boolean;
  excludeMatchId?: string;
}): Promise<MatchConflictResult> {
  const matchStart = parseTimeToMinutes(input.matchTime);
  if (matchStart === null) return { blocking: null, warning: null };

  const { clubId, matchDate, durationMinutes, teamGroups } = input;

  const existingMatches = await prisma.clubMatch.findMany({
    where: {
      clubId,
      matchDate,
      ...(input.excludeMatchId ? { id: { not: input.excludeMatchId } } : {}),
    },
    select: { matchTime: true, durationMinutes: true, opponent: true, teamGroups: true, customGroupId: true },
  });

  for (const match of existingMatches) {
    const existingStart = parseTimeToMinutes(match.matchTime);
    if (existingStart === null) continue;
    if (overlaps(matchStart, durationMinutes, existingStart, match.durationMinutes)) {
      const startTime = formatMinutesAsTime(existingStart);
      const endTime = formatMinutesAsTime(existingStart + match.durationMinutes);
      if (matchScopesOverlap({
        nextTeamGroups: teamGroups,
        nextCustomGroupId: input.customGroupId,
        existingTeamGroups: match.teamGroups,
        existingCustomGroupId: match.customGroupId,
      })) {
        return {
          blocking: `Match overlaps with another match for the same team on ${formatIsoDateForBgDisplay(matchDate)} from ${startTime} to ${endTime} against ${match.opponent}.`,
          warning: null,
        };
      }
    }
  }
  return { blocking: null, warning: null };
}
