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
import {
  assertNoTrainingFieldConflict,
  assertNoTrainingTimeConflict,
  pickTrainingConflictCheckInput,
} from "@/lib/trainingFieldConflicts";
import {
  clubHasTrainingFields,
  parseTrainingFieldSelection,
  parseTrainingFieldSelectionsByDate,
  verifyTrainingFieldSelectionsByDate,
} from "@/lib/trainingFields";
import { deleteFutureTrainingSessionsForScope, syncFutureTrainingSessions } from "@/lib/trainingSessions";
import { parseCustomTrainingGroupColorFromBody } from "@/lib/customTrainingGroupColors";
import { isCustomTrainingGroupColorTakenInScope } from "@/lib/customTrainingGroupColorScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";


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
    if (timestamp < start || timestamp > end) throw new Error(`Training dates must be within the next ${TRAINING_SELECTION_WINDOW_DAYS} days.`);
    dates.push(date);
  }
  return Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
}

function normalizeStoredTrainingDateTimes(raw: unknown, trainingDates: string[]): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const allowedDates = new Set(trainingDates);
  const result: Record<string, string> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
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
}) {
  return {
    id: group.id,
    name: group.name,
    color: group.color,
    trainingDates: group.trainingDates,
    trainingTime: group.trainingTime,
    trainingDateTimes: normalizeStoredTrainingDateTimes(group.trainingDateTimes, group.trainingDates ?? []),
    trainingDurationMinutes: group.trainingDurationMinutes,
    trainingFieldId: group.trainingFieldId,
    trainingFieldPieceIds: group.trainingFieldPieceIds,
    trainingFieldSelections: group.trainingFieldSelections,
    coachGroupId: group.coachGroupId,
    trainingWeekdays: group.trainingWeekdays,
    playerIds: group.players.map((item) => item.playerId),
    players: group.players.map((item) => ({ id: item.playerId, fullName: item.player.fullName, teamGroup: item.player.teamGroup })),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId, groupId } = await params;
  try {
    const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.clubCustomTrainingGroup.deleteMany({ where: { id: groupId, clubId } });
      if (result.count > 0) {
        await deleteFutureTrainingSessionsForScope({
          tx,
          clubId,
          scope: { type: "customGroup", id: groupId },
          todayIso,
        });
      }
      return result;
    });
    if (deleted.count === 0) return NextResponse.json({ error: "Training group not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Custom training groups DELETE error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId, groupId } = await params;
  const body = await request.json().catch(() => ({}));
  const payload = body as {
    name?: unknown;
    playerIds?: unknown;
    trainingDates?: unknown;
    trainingTime?: unknown;
    trainingDateTimes?: unknown;
    trainingDurationMinutes?: unknown;
    trainingFieldId?: unknown;
    trainingFieldPieceIds?: unknown;
    trainingFieldSelections?: unknown;
    conflictCheckDates?: unknown;
    color?: unknown;
  };
  const hasName = Object.prototype.hasOwnProperty.call(payload, "name");
  const hasPlayerIds = Object.prototype.hasOwnProperty.call(payload, "playerIds");
  const hasTrainingDates = Object.prototype.hasOwnProperty.call(payload, "trainingDates");
  const hasTrainingTime = Object.prototype.hasOwnProperty.call(payload, "trainingTime");
  const hasTrainingDateTimes = Object.prototype.hasOwnProperty.call(payload, "trainingDateTimes");
  const hasTrainingDuration = Object.prototype.hasOwnProperty.call(payload, "trainingDurationMinutes");
  const hasTrainingField = Object.prototype.hasOwnProperty.call(payload, "trainingFieldId");
  const hasTrainingFieldPiece = Object.prototype.hasOwnProperty.call(payload, "trainingFieldPieceIds");
  const hasTrainingFieldSelections = Object.prototype.hasOwnProperty.call(payload, "trainingFieldSelections");
  const hasColor = Object.prototype.hasOwnProperty.call(payload, "color");
  if (!hasName && !hasPlayerIds && !hasTrainingDates && !hasTrainingTime && !hasTrainingDateTimes && !hasTrainingDuration && !hasTrainingField && !hasTrainingFieldPiece && !hasTrainingFieldSelections && !hasColor) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const existing = await prisma.clubCustomTrainingGroup.findFirst({
      where: { id: groupId, clubId },
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
        trainingFieldSelections: true,
        coachGroupId: true,
        players: { select: { playerId: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Training group not found." }, { status: 404 });

    let nextTrainingDates = existing.trainingDates ?? [];
    if (hasTrainingDates) nextTrainingDates = normalizeTrainingDates(payload.trainingDates);
    const conflictCheckDates = Array.isArray(payload.conflictCheckDates)
      ? Array.from(
          new Set(
            payload.conflictCheckDates
              .map((value) => String(value ?? "").trim())
              .filter((date) => nextTrainingDates.includes(date)),
          ),
        ).sort((a, b) => a.localeCompare(b))
      : undefined;
    const fallbackTrainingTime = hasTrainingTime ? normalizeTrainingTime(payload.trainingTime) : existing.trainingTime ?? null;
    const rawTrainingDateTimes = hasTrainingDateTimes ? payload.trainingDateTimes : existing.trainingDateTimes;
    const nextTrainingDateTimes = nextTrainingDates.length > 0
      ? buildTrainingDateTimes({ rawTrainingDateTimes, trainingDates: nextTrainingDates, fallbackTrainingTime })
      : {};
    const nextTrainingTime = fallbackTrainingTime ?? Object.values(nextTrainingDateTimes)[0] ?? null;
    let nextTrainingDurationMinutes = existing.trainingDurationMinutes;
    if (hasTrainingDuration) {
      try {
        nextTrainingDurationMinutes = normalizeTrainingDurationMinutes(payload.trainingDurationMinutes);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid training duration." },
          { status: 400 },
        );
      }
    }
    let nextTrainingFieldId = existing.trainingFieldId ?? null;
    let nextTrainingFieldPieceIds = existing.trainingFieldPieceIds ?? [];
    if (hasTrainingField || hasTrainingFieldPiece) {
      try {
        const selection = parseTrainingFieldSelection({
          trainingFieldId: hasTrainingField ? payload.trainingFieldId : nextTrainingFieldId,
          trainingFieldPieceIds: hasTrainingFieldPiece ? payload.trainingFieldPieceIds : nextTrainingFieldPieceIds,
        });
        nextTrainingFieldId = selection.trainingFieldId;
        nextTrainingFieldPieceIds = selection.trainingFieldPieceIds;
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid training field." },
          { status: 400 },
        );
      }
    }
    let hasTrainingFields = false;
    if (nextTrainingDates.length > 0 || hasTrainingField || hasTrainingFieldPiece || hasTrainingFieldSelections) {
      hasTrainingFields = await clubHasTrainingFields(clubId);
      if (!hasTrainingFields) {
        nextTrainingFieldId = null;
        nextTrainingFieldPieceIds = [];
      }
    }
    const nextTrainingFieldSelections = parseTrainingFieldSelectionsByDate({
      trainingFieldSelections: hasTrainingFieldSelections ? payload.trainingFieldSelections : existing.trainingFieldSelections,
      trainingDates: nextTrainingDates,
      fallback: { trainingFieldId: nextTrainingFieldId, trainingFieldPieceIds: nextTrainingFieldPieceIds },
    });
    if (nextTrainingDates.length > 0) {
      if (hasTrainingFields && !nextTrainingFieldId) {
        return NextResponse.json({ error: "Треньорът трябва да избере терен." }, { status: 400 });
      }
      if (hasTrainingFields) {
        try {
          await verifyTrainingFieldSelectionsByDate(clubId, nextTrainingFieldSelections);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : "Invalid training field." },
            { status: 400 },
          );
        }
      }
      try {
        const conflictCheck = pickTrainingConflictCheckInput({
          checkDates: conflictCheckDates,
          previousDates: existing.trainingDates ?? [],
          previousDateTimes: existing.trainingDateTimes,
          previousDurationMinutes: existing.trainingDurationMinutes,
          previousFieldId: existing.trainingFieldId ?? null,
          previousFieldPieceIds: existing.trainingFieldPieceIds ?? [],
          previousFieldSelections: existing.trainingFieldSelections,
          nextDates: nextTrainingDates,
          nextDateTimes: nextTrainingDateTimes,
          nextDurationMinutes: nextTrainingDurationMinutes,
          nextFieldId: nextTrainingFieldId,
          nextFieldPieceIds: nextTrainingFieldPieceIds,
          nextFieldSelections: nextTrainingFieldSelections,
        });
        if (hasTrainingFields) {
          await assertNoTrainingFieldConflict({
            clubId,
            trainingDates: conflictCheck.trainingDates,
            trainingDateTimes: conflictCheck.trainingDateTimes,
            trainingDurationMinutes: nextTrainingDurationMinutes,
            trainingFieldId: nextTrainingFieldId,
            trainingFieldPieceIds: nextTrainingFieldPieceIds,
            trainingFieldSelections: conflictCheck.trainingFieldSelections,
            exclude: { type: "customGroup", id: groupId },
          });
        }
        await assertNoTrainingTimeConflict({
          clubId,
          trainingDates: conflictCheck.trainingDates,
          trainingDateTimes: conflictCheck.trainingDateTimes,
          trainingDurationMinutes: nextTrainingDurationMinutes,
          exclude: { type: "customGroup", id: groupId },
          ignoreFieldResourceSchedules: hasTrainingFields,
        });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid training field schedule." },
          { status: 400 },
        );
      }
    }
    const nextTrainingWeekdays = Array.from(
      new Set(nextTrainingDates.map((date) => getWeekdayMondayFirst(date, FIXED_TIME_ZONE)).filter((value) => value >= 1 && value <= 7)),
    ).sort((a, b) => a - b);
    const playerIds = hasPlayerIds ? normalizePlayerIds(payload.playerIds) : existing.players.map((item) => item.playerId);
    const nextName = hasName ? String(payload.name ?? "").trim() : existing.name;
    if (!nextName) return NextResponse.json({ error: "Group name is required." }, { status: 400 });
    if (hasPlayerIds && playerIds.length === 0) {
      return NextResponse.json({ error: "В тази група няма избрани активни състезатели." }, { status: 400 });
    }

    if (hasPlayerIds) {
      const validPlayers = await prisma.player.findMany({
        where: { id: { in: playerIds }, clubId, isActive: true },
        select: { id: true },
      });
      if (validPlayers.length !== playerIds.length) {
        return NextResponse.json(
          { error: "Избраните състезатели трябва да са активни и да принадлежат към този клуб." },
          { status: 400 },
        );
      }
    }

    let nextColor = existing.color;
    if (hasColor) {
      try {
        nextColor = parseCustomTrainingGroupColorFromBody(payload.color);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Невалиден цвят." },
          { status: 400 },
        );
      }
      if (
        await isCustomTrainingGroupColorTakenInScope({
          clubId,
          coachGroupId: existing.coachGroupId,
          color: nextColor,
          excludeGroupId: groupId,
        })
      ) {
        return NextResponse.json(
          { error: "Този цвят вече се използва от друга група в този клуб." },
          { status: 400 },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.clubCustomTrainingGroup.update({
        where: { id: groupId },
        data: {
          name: nextName,
          ...(hasColor ? { color: nextColor } : {}),
          ...(hasTrainingDates || hasTrainingTime || hasTrainingDateTimes
            ? {
                trainingDates: nextTrainingDates,
                trainingTime: nextTrainingTime,
                trainingDateTimes: nextTrainingDateTimes,
                trainingWeekdays: nextTrainingWeekdays,
                trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
              }
            : {}),
          ...(hasTrainingDuration ? { trainingDurationMinutes: nextTrainingDurationMinutes } : {}),
          ...(hasTrainingField || hasTrainingFieldPiece || hasTrainingFieldSelections
            ? { trainingFieldId: nextTrainingFieldId, trainingFieldPieceIds: nextTrainingFieldPieceIds, trainingFieldSelections: nextTrainingFieldSelections }
            : {}),
        },
      });
      if (hasPlayerIds) {
        await tx.clubCustomTrainingGroupPlayer.deleteMany({
          where: { groupId },
        });
        if (playerIds.length > 0) {
          await tx.clubCustomTrainingGroupPlayer.createMany({
            data: playerIds.map((playerId) => ({ groupId, playerId })),
          });
        }
      }
    }, { timeout: 15000 });

    const updated = await prisma.clubCustomTrainingGroup.findUniqueOrThrow({
      where: { id: groupId },
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
        trainingFieldSelections: true,
        coachGroupId: true,
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
    if (
      hasTrainingDates ||
      hasTrainingTime ||
      hasTrainingDateTimes ||
      hasTrainingDuration ||
      hasTrainingField ||
      hasTrainingFieldPiece ||
      hasPlayerIds ||
      hasTrainingFieldSelections
    ) {
      const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
      await prisma.$transaction(
        (tx) =>
          syncFutureTrainingSessions({
            tx,
            clubId,
            scope: { type: "customGroup", id: groupId },
            trainingDates: updated.trainingDates ?? [],
            trainingDateTimes: normalizeStoredTrainingDateTimes(updated.trainingDateTimes, updated.trainingDates ?? []),
            trainingDurationMinutes: updated.trainingDurationMinutes,
            trainingFieldId: updated.trainingFieldId,
            trainingFieldPieceIds: updated.trainingFieldPieceIds,
            trainingFieldSelections: updated.trainingFieldSelections as Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }> | undefined,
            todayIso,
          }),
        { timeout: 30000 },
      );
    }

    let notifications = null;
    if (hasTrainingDates && shouldNotifyForTrainingDatesChange(existing.trainingDates ?? [], updated.trainingDates ?? [])) {
      notifications = await sendTrainingScheduleNotifications({
        clubId,
        playerIds: updated.players.map((item) => item.playerId),
        previousDates: existing.trainingDates ?? [],
        trainingDates: updated.trainingDates,
      });
    }

    return NextResponse.json({ ...serializeGroup(updated), notifications });
  } catch (error) {
    console.error("Custom training groups PATCH error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
