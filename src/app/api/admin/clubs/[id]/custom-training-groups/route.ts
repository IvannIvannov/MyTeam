import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import {
  getWeekdayMondayFirst,
  getTodayIsoDateInTimeZone,
  isIsoDate,
  isoDateToUtcMidnight,
  normalizeTrainingDurationMinutes,
  normalizeTrainingTime,
} from "@/lib/training";
import {
  sendTrainingScheduleNotifications,
  shouldNotifyForTrainingDatesChange,
} from "@/lib/push/trainingScheduleNotifications";
import { assertNoTrainingFieldConflict, assertNoTrainingTimeConflict } from "@/lib/trainingFieldConflicts";
import {
  clubHasTrainingFields,
  parseTrainingFieldSelection,
  parseTrainingFieldSelectionsByDate,
  verifyTrainingFieldSelection,
  verifyTrainingFieldSelectionsByDate,
} from "@/lib/trainingFields";
import { filterCancelledTrainingDatesForScope, syncFutureTrainingSessions } from "@/lib/trainingSessions";
import { parseCustomTrainingGroupColorFromBody } from "@/lib/customTrainingGroupColors";
import { isCustomTrainingGroupColorTakenInScope } from "@/lib/customTrainingGroupColorScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

function normalizePlayerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function normalizeTrainingDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
  const start = isoDateToUtcMidnight(todayIso).getTime();
  const end = start + (TRAINING_SELECTION_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000;
  const dates: string[] = [];
  for (const value of raw) {
    const date = String(value ?? "").trim();
    if (!isIsoDate(date)) throw new Error("Training dates must be valid ISO dates.");
    const timestamp = isoDateToUtcMidnight(date).getTime();
    if (timestamp < start || timestamp > end) {
      throw new Error(`Training dates must be within the next ${TRAINING_SELECTION_WINDOW_DAYS} days.`);
    }
    dates.push(date);
  }
  return Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
}

function normalizeStoredTrainingDateTimes(raw: unknown, trainingDates: string[]): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const allowedDates = new Set(trainingDates);
  const result: Record<string, string> = {};
  for (const [date, value] of Object.entries(source)) {
    if (!allowedDates.has(date)) continue;
    const normalized = normalizeTrainingTime(value);
    if (normalized) result[date] = normalized;
  }
  return result;
}

function buildTrainingDateTimes(input: {
  rawTrainingDateTimes: unknown;
  trainingDates: string[];
  fallbackTrainingTime: string | null;
}) {
  const allowedDates = new Set(input.trainingDates);
  const result: Record<string, string> = {};
  if (input.rawTrainingDateTimes && typeof input.rawTrainingDateTimes === "object" && !Array.isArray(input.rawTrainingDateTimes)) {
    for (const [date, value] of Object.entries(input.rawTrainingDateTimes as Record<string, unknown>)) {
      if (!allowedDates.has(date)) throw new Error("Training date times contain date outside selected training days.");
      const normalized = normalizeTrainingTime(value);
      if (!normalized) throw new Error("Training time is required for each selected day.");
      result[date] = normalized;
    }
  }
  if (Object.keys(result).length === 0 && input.fallbackTrainingTime) {
    for (const date of input.trainingDates) result[date] = input.fallbackTrainingTime;
  }
  for (const date of input.trainingDates) {
    if (!result[date]) throw new Error("Training time is required for each selected day.");
  }
  return result;
}

function serializeGroup(group: {
  id: string;
  name: string;
  color: string | null;
  trainingDates: string[];
  trainingTime: string | null;
  trainingDateTimes: unknown;
  trainingDurationMinutes: number;
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
  trainingFieldSelections?: unknown;
  coachGroupId: string | null;
  trainingWeekdays: number[];
  createdAt: Date;
  updatedAt: Date;
  players: Array<{ playerId: string; player: { fullName: string; teamGroup: number | null } }>;
}, visibleTrainingDates = group.trainingDates) {
  return {
    id: group.id,
    name: group.name,
    color: group.color,
    trainingDates: visibleTrainingDates,
    trainingTime: group.trainingTime,
    trainingDateTimes: normalizeStoredTrainingDateTimes(group.trainingDateTimes, visibleTrainingDates ?? []),
    trainingDurationMinutes: group.trainingDurationMinutes,
    trainingFieldId: group.trainingFieldId,
    trainingFieldPieceIds: group.trainingFieldPieceIds,
    trainingFieldSelections: group.trainingFieldSelections,
    coachGroupId: group.coachGroupId,
    trainingWeekdays: group.trainingWeekdays,
    playerIds: group.players.map((item) => item.playerId),
    players: group.players.map((item) => ({
      id: item.playerId,
      fullName: item.player.fullName,
      teamGroup: item.player.teamGroup,
    })),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const coachGroupIdRaw = request.nextUrl.searchParams.get("coachGroupId");
  if (coachGroupIdRaw && !UUID_REGEX.test(coachGroupIdRaw)) {
    return NextResponse.json({ error: "Невалидна треньорска група." }, { status: 400 });
  }
  const coachGroupId = coachGroupIdRaw || null;
  try {
    const groups = await prisma.clubCustomTrainingGroup.findMany({
      where: { clubId: id, coachGroupId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        color: true,
        trainingDates: true,
        trainingTime: true,
        trainingDateTimes: true,
        trainingDurationMinutes: true,
        trainingFieldId: true,
        trainingFieldPieceIds: true,
        coachGroupId: true,
        trainingFieldSelections: true,
        trainingWeekdays: true,
        createdAt: true,
        updatedAt: true,
        players: {
          orderBy: { player: { fullName: "asc" } },
          select: {
            playerId: true,
            player: { select: { fullName: true, teamGroup: true } },
          },
        },
      },
    });
    const serialized = await Promise.all(groups.map(async (group) => {
      const trainingDates = await filterCancelledTrainingDatesForScope({
        clubId: id,
        scope: { type: "customGroup", id: group.id },
        trainingDates: group.trainingDates ?? [],
      });
      return serializeGroup(group, trainingDates);
    }));
    return NextResponse.json(serialized);
  } catch (error) {
    console.error("Custom training groups GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const name = String((body as { name?: unknown }).name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  const coachGroupIdRaw = (body as { coachGroupId?: unknown }).coachGroupId;
  if (coachGroupIdRaw !== undefined && coachGroupIdRaw !== null && typeof coachGroupIdRaw !== "string") {
    return NextResponse.json({ error: "Невалидна треньорска група." }, { status: 400 });
  }
  const coachGroupIdValue = typeof coachGroupIdRaw === "string" ? coachGroupIdRaw.trim() : "";
  if (coachGroupIdValue && !UUID_REGEX.test(coachGroupIdValue)) {
    return NextResponse.json({ error: "Невалидна треньорска група." }, { status: 400 });
  }
  const coachGroupId = coachGroupIdValue || null;
  if (coachGroupId) {
    const coachGroup = await prisma.coachGroup.findFirst({
      where: { id: coachGroupId, clubId: id },
      select: { id: true },
    });
    if (!coachGroup) {
      return NextResponse.json({ error: "Треньорската група не е намерена." }, { status: 400 });
    }
  }

  let paletteColor: string;
  try {
    paletteColor = parseCustomTrainingGroupColorFromBody((body as { color?: unknown }).color);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Невалиден цвят." },
      { status: 400 },
    );
  }
  if (await isCustomTrainingGroupColorTakenInScope({ clubId: id, coachGroupId, color: paletteColor })) {
    return NextResponse.json(
      { error: "Този цвят вече се използва от друга група в този клуб." },
      { status: 400 },
    );
  }

  const playerIds = normalizePlayerIds((body as { playerIds?: unknown }).playerIds);
  const rawTrainingDates = (body as { trainingDates?: unknown }).trainingDates;
  const rawTrainingTime = (body as { trainingTime?: unknown }).trainingTime;
  const rawTrainingDateTimes = (body as { trainingDateTimes?: unknown }).trainingDateTimes;
  const rawTrainingDurationMinutes = (body as { trainingDurationMinutes?: unknown }).trainingDurationMinutes;
  const rawTrainingFieldId = (body as { trainingFieldId?: unknown }).trainingFieldId;
  const rawTrainingFieldPieceId = (body as { trainingFieldPieceIds?: unknown }).trainingFieldPieceIds;
  const rawTrainingFieldSelections = (body as { trainingFieldSelections?: unknown }).trainingFieldSelections;
  let trainingTime: string | null = null;
  let trainingDurationMinutes = 60;
  let trainingFieldSelection = { trainingFieldId: null as string | null, trainingFieldPieceIds: [] as string[] };
  let trainingFieldSelections: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }> = {};
  let trainingDates: string[] = [];
  let trainingDateTimes: Record<string, string> = {};
  try {
    trainingTime = normalizeTrainingTime(rawTrainingTime);
    trainingDurationMinutes = rawTrainingDurationMinutes === undefined
      ? 60
      : normalizeTrainingDurationMinutes(rawTrainingDurationMinutes);
    trainingFieldSelection = parseTrainingFieldSelection({
      trainingFieldId: rawTrainingFieldId,
      trainingFieldPieceIds: rawTrainingFieldPieceId,
    });
    trainingDates = normalizeTrainingDates(rawTrainingDates);
    const hasTrainingFields = trainingDates.length > 0 ? await clubHasTrainingFields(id) : false;
    if (!hasTrainingFields) {
      trainingFieldSelection = { trainingFieldId: null, trainingFieldPieceIds: [] };
    }
    if (trainingDates.length > 0) {
      if (hasTrainingFields && !trainingFieldSelection.trainingFieldId) {
        throw new Error("Треньорът трябва да избере терен.");
      }
      if (hasTrainingFields) {
        await verifyTrainingFieldSelection(id, trainingFieldSelection);
      }
      trainingFieldSelections = parseTrainingFieldSelectionsByDate({
        trainingFieldSelections: rawTrainingFieldSelections,
        trainingDates,
        fallback: trainingFieldSelection,
      });
      if (hasTrainingFields) {
        await verifyTrainingFieldSelectionsByDate(id, trainingFieldSelections);
      }
      trainingDateTimes = buildTrainingDateTimes({
        rawTrainingDateTimes,
        trainingDates,
        fallbackTrainingTime: trainingTime,
      });
      if (hasTrainingFields) {
        await assertNoTrainingFieldConflict({
          clubId: id,
          trainingDates,
          trainingDateTimes,
          trainingDurationMinutes,
          trainingFieldId: trainingFieldSelection.trainingFieldId,
          trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
          trainingFieldSelections,
        });
      }
      await assertNoTrainingTimeConflict({
        clubId: id,
        trainingDates,
        trainingDateTimes,
        trainingDurationMinutes,
        ignoreFieldResourceSchedules: hasTrainingFields,
      });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid training schedule." }, { status: 400 });
  }
  const persistedTrainingTime = trainingTime ?? Object.values(trainingDateTimes)[0] ?? null;
  const trainingWeekdays = Array.from(
    new Set(trainingDates.map((date) => getWeekdayMondayFirst(date, FIXED_TIME_ZONE)).filter((value) => value >= 1 && value <= 7)),
  ).sort((a, b) => a - b);

  try {
    if (playerIds.length === 0) {
      return NextResponse.json({ error: "В тази група няма избрани активни състезатели." }, { status: 400 });
    }
    const created = await prisma.$transaction(async (tx) => {
      const players = playerIds.length
        ? await tx.player.findMany({
            where: { id: { in: playerIds }, clubId: id, isActive: true },
            select: { id: true },
          })
        : [];
      if (players.length !== playerIds.length) throw new Error("INVALID_PLAYERS");
      const group = await tx.clubCustomTrainingGroup.create({
        data: {
          clubId: id,
          coachGroupId,
          color: paletteColor,
          name,
          trainingDates,
          trainingTime: persistedTrainingTime,
          trainingDateTimes,
          trainingDurationMinutes,
          trainingFieldId: trainingFieldSelection.trainingFieldId,
          trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
          trainingFieldSelections,
          trainingWeekdays,
          trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
        },
        select: { id: true },
      });
      if (playerIds.length > 0) {
        await tx.clubCustomTrainingGroupPlayer.createMany({
          data: playerIds.map((playerId) => ({ groupId: group.id, playerId })),
        });
      }
      await syncFutureTrainingSessions({
        tx,
        clubId: id,
        scope: { type: "customGroup", id: group.id },
        trainingDates,
        trainingDateTimes,
        trainingDurationMinutes,
        trainingFieldId: trainingFieldSelection.trainingFieldId,
        trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
        trainingFieldSelections,
        todayIso: getTodayIsoDateInTimeZone(FIXED_TIME_ZONE),
      });
      return tx.clubCustomTrainingGroup.findUniqueOrThrow({
        where: { id: group.id },
        select: {
          id: true,
          name: true,
          color: true,
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
          coachGroupId: true,
          trainingFieldSelections: true,
          trainingWeekdays: true,
          createdAt: true,
          updatedAt: true,
          players: {
            orderBy: { player: { fullName: "asc" } },
            select: {
              playerId: true,
              player: { select: { fullName: true, teamGroup: true } },
            },
          },
        },
      });
    }, { timeout: 30000 });

    let notifications = null;
    if (shouldNotifyForTrainingDatesChange([], created.trainingDates ?? [])) {
      notifications = await sendTrainingScheduleNotifications({
        clubId: id,
        playerIds,
        previousDates: [],
        trainingDates: created.trainingDates,
      });
    }

    return NextResponse.json({ ...serializeGroup(created), notifications }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PLAYERS") {
      return NextResponse.json({ error: "Избраните състезатели трябва да са активни и да принадлежат към този клуб." }, { status: 400 });
    }
    console.error("Custom training groups POST error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
