import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import {
  getConfiguredTrainingDates,
  getTodayIsoDateInTimeZone,
  getWeekdayMondayFirst,
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
  normalizeStoredTrainingFieldSelections,
  parseTrainingFieldSelection,
  parseTrainingFieldSelectionsByDate,
  verifyTrainingFieldSelectionsByDate,
} from "@/lib/trainingFields";
import { filterCancelledTrainingDatesForScope, syncFutureTrainingSessions } from "@/lib/trainingSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const FIXED_TIME_ZONE = "Europe/Sofia";


function parseTeamGroupValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error("Invalid teamGroup");
  }
  return parsed;
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
    const time = typeof value === "string" ? value.trim() : "";
    const normalized = normalizeTrainingTime(time);
    if (normalized) {
      result[date] = normalized;
    }
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
      if (!allowedDates.has(date)) {
        throw new Error("Training date times contain date outside selected training days.");
      }
      const normalized = normalizeTrainingTime(value);
      if (!normalized) {
        throw new Error("Training time is required for each selected day.");
      }
      result[date] = normalized;
    }
  }

  if (Object.keys(result).length === 0 && input.fallbackTrainingTime) {
    for (const date of input.trainingDates) {
      result[date] = input.fallbackTrainingTime;
    }
  }

  for (const date of input.trainingDates) {
    if (!result[date]) {
      throw new Error("Training time is required for each selected day.");
    }
  }

  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "\u041d\u044f\u043c\u0430\u0442\u0435 \u0434\u043e\u0441\u0442\u044a\u043f." }, { status: 401 });
  }

  const { id } = await params;
  const teamGroupRaw = request.nextUrl.searchParams.get("teamGroup");
  let teamGroup: number | null = null;
  try {
    teamGroup = parseTeamGroupValue(teamGroupRaw);
  } catch {
    return NextResponse.json({ error: "Invalid teamGroup" }, { status: 400 });
  }

  const club = await prisma.club.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      reminderDay: true,
      overdueDay: true,
      reminderHour: true,
      reminderMinute: true,
      secondReminderDay: true,
      secondReminderHour: true,
      secondReminderMinute: true,
      thirdReminderDay: true,
      thirdReminderHour: true,
      thirdReminderMinute: true,
      overdueHour: true,
      overdueMinute: true,
      trainingDates: true,
      trainingTime: true,
      trainingDateTimes: true,
      trainingDurationMinutes: true,
      trainingFieldId: true,
      trainingFieldPieceIds: true,
      trainingFieldSelections: true,
      trainingWeekdays: true,
      trainingWindowDays: true,
    },
  });

  if (!club) {
    return NextResponse.json({ error: "\u041e\u0442\u0431\u043e\u0440\u044a\u0442 \u043d\u0435 \u0435 \u043d\u0430\u043c\u0435\u0440\u0435\u043d." }, { status: 404 });
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
          id: true,
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
          trainingFieldSelections: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
        },
      });

  const trainingGroupOverride = teamGroup === null
    ? null
    : await prisma.clubTrainingScheduleGroup.findFirst({
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
          id: true,
          trainingDates: true,
          trainingTime: true,
          trainingDateTimes: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
          trainingFieldSelections: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
        },
      });

  const configuredTrainingDates = getConfiguredTrainingDates({
    trainingDates: trainingGroupOverride?.trainingDates ?? groupSchedule?.trainingDates ?? club.trainingDates,
    weekdays: trainingGroupOverride?.trainingWeekdays ?? groupSchedule?.trainingWeekdays ?? club.trainingWeekdays,
    windowDays: trainingGroupOverride?.trainingWindowDays ?? groupSchedule?.trainingWindowDays ?? club.trainingWindowDays,
    timeZone: FIXED_TIME_ZONE,
    maxDays: TRAINING_SELECTION_WINDOW_DAYS,
  });
  const trainingDates = await filterCancelledTrainingDatesForScope({
    clubId: id,
    scope: trainingGroupOverride
      ? { type: "trainingGroup", id: trainingGroupOverride.id }
      : teamGroup !== null
        ? { type: "teamGroup", teamGroup }
        : { type: "club" },
    trainingDates: configuredTrainingDates,
  });

  return NextResponse.json({
    ...club,
    teamGroup,
    trainingDates,
    trainingTime: trainingGroupOverride?.trainingTime ?? groupSchedule?.trainingTime ?? club.trainingTime ?? null,
    trainingDurationMinutes:
      trainingGroupOverride?.trainingDurationMinutes ??
      groupSchedule?.trainingDurationMinutes ??
      club.trainingDurationMinutes,
    trainingFieldId: trainingGroupOverride?.trainingFieldId ?? groupSchedule?.trainingFieldId ?? club.trainingFieldId ?? null,
    trainingFieldPieceIds: trainingGroupOverride?.trainingFieldPieceIds ?? groupSchedule?.trainingFieldPieceIds ?? club.trainingFieldPieceIds ?? null,
    trainingFieldSelections: normalizeStoredTrainingFieldSelections(
      trainingGroupOverride?.trainingFieldSelections ?? groupSchedule?.trainingFieldSelections ?? club.trainingFieldSelections,
      trainingDates,
      {
        trainingFieldId: trainingGroupOverride?.trainingFieldId ?? groupSchedule?.trainingFieldId ?? club.trainingFieldId ?? null,
        trainingFieldPieceIds: trainingGroupOverride?.trainingFieldPieceIds ?? groupSchedule?.trainingFieldPieceIds ?? club.trainingFieldPieceIds ?? [],
      },
    ),
    trainingDateTimes: normalizeStoredTrainingDateTimes(
      trainingGroupOverride?.trainingDateTimes ?? groupSchedule?.trainingDateTimes ?? club.trainingDateTimes,
      trainingDates,
    ),
    trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "\u041d\u044f\u043c\u0430\u0442\u0435 \u0434\u043e\u0441\u0442\u044a\u043f." }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reminderDay = Number.parseInt(String((body as { reminderDay?: unknown }).reminderDay ?? ""), 10);
  const overdueDay = Number.parseInt(String((body as { overdueDay?: unknown }).overdueDay ?? ""), 10);
  const reminderHour = Number.parseInt(String((body as { reminderHour?: unknown }).reminderHour ?? ""), 10);
  const reminderMinute = Number.parseInt(String((body as { reminderMinute?: unknown }).reminderMinute ?? ""), 10);
  const secondReminderDayRaw = (body as { secondReminderDay?: unknown }).secondReminderDay;
  const secondReminderHourRaw = (body as { secondReminderHour?: unknown }).secondReminderHour;
  const secondReminderMinuteRaw = (body as { secondReminderMinute?: unknown }).secondReminderMinute;
  const thirdReminderDayRaw = (body as { thirdReminderDay?: unknown }).thirdReminderDay;
  const thirdReminderHourRaw = (body as { thirdReminderHour?: unknown }).thirdReminderHour;
  const thirdReminderMinuteRaw = (body as { thirdReminderMinute?: unknown }).thirdReminderMinute;
  const overdueHour = Number.parseInt(String((body as { overdueHour?: unknown }).overdueHour ?? ""), 10);
  const overdueMinute = Number.parseInt(String((body as { overdueMinute?: unknown }).overdueMinute ?? ""), 10);
  const rawTrainingDates = (body as { trainingDates?: unknown }).trainingDates;
  const rawTrainingTime = (body as { trainingTime?: unknown }).trainingTime;
  const rawTrainingDateTimes = (body as { trainingDateTimes?: unknown }).trainingDateTimes;
  const rawTrainingDurationMinutes = (body as { trainingDurationMinutes?: unknown }).trainingDurationMinutes;
  const rawTrainingFieldId = (body as { trainingFieldId?: unknown }).trainingFieldId;
  const rawTrainingFieldPieceId = (body as { trainingFieldPieceIds?: unknown }).trainingFieldPieceIds;
  const rawTrainingFieldSelections = (body as { trainingFieldSelections?: unknown }).trainingFieldSelections;
  const rawConflictCheckDates = (body as { conflictCheckDates?: unknown }).conflictCheckDates;
  const rawWeekdays = (body as { trainingWeekdays?: unknown }).trainingWeekdays;
  const rawWindowDays = Number.parseInt(String((body as { trainingWindowDays?: unknown }).trainingWindowDays ?? ""), 10);
  const rawTeamGroup = (body as { teamGroup?: unknown }).teamGroup;

  let teamGroup: number | null = null;
  let trainingTime: string | null = null;
  let trainingDurationMinutes = 60;
  let trainingFieldSelection = { trainingFieldId: null as string | null, trainingFieldPieceIds: [] as string[] };
  try {
    teamGroup = parseTeamGroupValue(rawTeamGroup);
    trainingTime = normalizeTrainingTime(rawTrainingTime);
    trainingDurationMinutes = normalizeTrainingDurationMinutes(rawTrainingDurationMinutes);
    trainingFieldSelection = parseTrainingFieldSelection({
      trainingFieldId: rawTrainingFieldId,
      trainingFieldPieceIds: rawTrainingFieldPieceId,
    });
  } catch {
    return NextResponse.json({ error: "Invalid teamGroup, trainingTime, trainingDurationMinutes, or training field" }, { status: 400 });
  }

  if (!Number.isInteger(reminderDay) || reminderDay < 1 || reminderDay > 28) {
    return NextResponse.json({ error: "\u0414\u0435\u043d\u044f\u0442 \u0437\u0430 \u043c\u0435\u0441\u0435\u0447\u043d\u043e \u043d\u0430\u043f\u043e\u043c\u043d\u044f\u043d\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u043c\u0435\u0436\u0434\u0443 1 \u0438 28." }, { status: 400 });
  }
  if (!Number.isInteger(overdueDay) || overdueDay < 1 || overdueDay > 28) {
    return NextResponse.json({ error: "\u0414\u0435\u043d\u044f\u0442 \u0437\u0430 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0438\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u043c\u0435\u0436\u0434\u0443 1 \u0438 28." }, { status: 400 });
  }
  if (!Number.isInteger(reminderHour) || reminderHour < 0 || reminderHour > 23) {
    return NextResponse.json({ error: "\u0427\u0430\u0441\u044a\u0442 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u043c\u0435\u0436\u0434\u0443 0 \u0438 23." }, { status: 400 });
  }
  if (!Number.isInteger(reminderMinute) || reminderMinute < 0 || reminderMinute > 59) {
    return NextResponse.json({ error: "\u041c\u0438\u043d\u0443\u0442\u0438\u0442\u0435 \u0437\u0430 \u043c\u0435\u0441\u0435\u0447\u043d\u043e \u043d\u0430\u043f\u043e\u043c\u043d\u044f\u043d\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0441\u0430 \u043c\u0435\u0436\u0434\u0443 0 \u0438 59." }, { status: 400 });
  }
  const hasSecondReminder =
    (secondReminderDayRaw !== undefined && secondReminderDayRaw !== null && String(secondReminderDayRaw).trim() !== "") ||
    (secondReminderHourRaw !== undefined && secondReminderHourRaw !== null && String(secondReminderHourRaw).trim() !== "") ||
    (secondReminderMinuteRaw !== undefined && secondReminderMinuteRaw !== null && String(secondReminderMinuteRaw).trim() !== "");
  let secondReminderDay: number | null = null;
  let secondReminderHour: number | null = null;
  let secondReminderMinute: number | null = null;
  if (hasSecondReminder) {
    secondReminderDay = Number.parseInt(String(secondReminderDayRaw ?? ""), 10);
    secondReminderHour = Number.parseInt(String(secondReminderHourRaw ?? ""), 10);
    secondReminderMinute = Number.parseInt(String(secondReminderMinuteRaw ?? ""), 10);
    if (!Number.isInteger(secondReminderDay) || secondReminderDay < 1 || secondReminderDay > 28) {
      return NextResponse.json({ error: "\u0412\u0442\u043e\u0440\u0438\u044f\u0442 \u0434\u0435\u043d \u0437\u0430 \u043c\u0435\u0441\u0435\u0447\u043d\u043e \u043d\u0430\u043f\u043e\u043c\u043d\u044f\u043d\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u043c\u0435\u0436\u0434\u0443 1 \u0438 28." }, { status: 400 });
    }
    if (secondReminderDay === reminderDay) {
      return NextResponse.json({ error: "\u0412\u0442\u043e\u0440\u0438\u044f\u0442 \u0434\u0435\u043d \u0437\u0430 \u043d\u0430\u043f\u043e\u043c\u043d\u044f\u043d\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u0440\u0430\u0437\u043b\u0438\u0447\u0435\u043d \u043e\u0442 \u043f\u044a\u0440\u0432\u0438\u044f." }, { status: 400 });
    }
    if (!Number.isInteger(secondReminderHour) || secondReminderHour < 0 || secondReminderHour > 23) {
      return NextResponse.json({ error: "\u0412\u0442\u043e\u0440\u0438\u044f\u0442 \u0447\u0430\u0441 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u043c\u0435\u0436\u0434\u0443 0 \u0438 23." }, { status: 400 });
    }
    if (!Number.isInteger(secondReminderMinute) || secondReminderMinute < 0 || secondReminderMinute > 59) {
      return NextResponse.json({ error: "\u0412\u0442\u043e\u0440\u0438\u0442\u0435 \u043c\u0438\u043d\u0443\u0442\u0438 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0441\u0430 \u043c\u0435\u0436\u0434\u0443 0 \u0438 59." }, { status: 400 });
    }
  }
  const hasThirdReminder =
    (thirdReminderDayRaw !== undefined && thirdReminderDayRaw !== null && String(thirdReminderDayRaw).trim() !== "") ||
    (thirdReminderHourRaw !== undefined && thirdReminderHourRaw !== null && String(thirdReminderHourRaw).trim() !== "") ||
    (thirdReminderMinuteRaw !== undefined && thirdReminderMinuteRaw !== null && String(thirdReminderMinuteRaw).trim() !== "");
  let thirdReminderDay: number | null = null;
  let thirdReminderHour: number | null = null;
  let thirdReminderMinute: number | null = null;
  if (hasThirdReminder) {
    if (!hasSecondReminder) {
      return NextResponse.json({ error: "Трето напомняне може да се добави само след второ напомняне." }, { status: 400 });
    }
    thirdReminderDay = Number.parseInt(String(thirdReminderDayRaw ?? ""), 10);
    thirdReminderHour = Number.parseInt(String(thirdReminderHourRaw ?? ""), 10);
    thirdReminderMinute = Number.parseInt(String(thirdReminderMinuteRaw ?? ""), 10);
    if (!Number.isInteger(thirdReminderDay) || thirdReminderDay < 1 || thirdReminderDay > 28) {
      return NextResponse.json({ error: "Третият ден за месечно напомняне трябва да е между 1 и 28." }, { status: 400 });
    }
    if (thirdReminderDay === reminderDay || thirdReminderDay === secondReminderDay) {
      return NextResponse.json({ error: "Третият ден за напомняне трябва да е различен от другите напомняния." }, { status: 400 });
    }
    if (!Number.isInteger(thirdReminderHour) || thirdReminderHour < 0 || thirdReminderHour > 23) {
      return NextResponse.json({ error: "Третият час трябва да е между 0 и 23." }, { status: 400 });
    }
    if (!Number.isInteger(thirdReminderMinute) || thirdReminderMinute < 0 || thirdReminderMinute > 59) {
      return NextResponse.json({ error: "Третите минути трябва да са между 0 и 59." }, { status: 400 });
    }
  }
  if (!Number.isInteger(overdueHour) || overdueHour < 0 || overdueHour > 23) {
    return NextResponse.json({ error: "\u0427\u0430\u0441\u044a\u0442 \u0437\u0430 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0438\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0435 \u043c\u0435\u0436\u0434\u0443 0 \u0438 23." }, { status: 400 });
  }
  if (!Number.isInteger(overdueMinute) || overdueMinute < 0 || overdueMinute > 59) {
    return NextResponse.json({ error: "\u041c\u0438\u043d\u0443\u0442\u0438\u0442\u0435 \u0437\u0430 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0438\u0435 \u0442\u0440\u044f\u0431\u0432\u0430 \u0434\u0430 \u0441\u0430 \u043c\u0435\u0436\u0434\u0443 0 \u0438 59." }, { status: 400 });
  }

  let trainingDates: string[] = [];
  let conflictCheckDates: string[] | undefined;
  if (Array.isArray(rawTrainingDates)) {
    const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
    const start = isoDateToUtcMidnight(todayIso).getTime();
    const end = start + (TRAINING_SELECTION_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000;

    for (const value of rawTrainingDates) {
      const date = String(value ?? "").trim();
      if (!isIsoDate(date)) {
        return NextResponse.json({ error: "Training dates must be valid ISO dates." }, { status: 400 });
      }
      const timestamp = isoDateToUtcMidnight(date).getTime();
      if (timestamp < start || timestamp > end) {
        return NextResponse.json(
          { error: `Training dates must be within the next ${TRAINING_SELECTION_WINDOW_DAYS} days.` },
          { status: 400 },
        );
      }
      trainingDates.push(date);
    }

    trainingDates = Array.from(new Set(trainingDates)).sort((a, b) => a.localeCompare(b));
    if (Array.isArray(rawConflictCheckDates)) {
      conflictCheckDates = Array.from(
        new Set(
          rawConflictCheckDates
            .map((value) => String(value ?? "").trim())
            .filter((date) => trainingDates.includes(date)),
        ),
      ).sort((a, b) => a.localeCompare(b));
    }
  } else {
    const trainingWeekdays = Array.isArray(rawWeekdays)
      ? Array.from(
          new Set(
            rawWeekdays
              .map((value) => Number.parseInt(String(value), 10))
              .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
          ),
        ).sort((a, b) => a - b)
      : [];
    const trainingWindowDays = Number.isInteger(rawWindowDays) ? rawWindowDays : TRAINING_SELECTION_WINDOW_DAYS;
    trainingDates = getConfiguredTrainingDates({
      weekdays: trainingWeekdays,
      windowDays: trainingWindowDays,
      timeZone: FIXED_TIME_ZONE,
      maxDays: TRAINING_SELECTION_WINDOW_DAYS,
    });
  }
  const hasTrainingFields = trainingDates.length > 0 ? await clubHasTrainingFields(id) : false;
  if (!hasTrainingFields) {
    trainingFieldSelection = { trainingFieldId: null, trainingFieldPieceIds: [] };
  }
  const previousTrainingSchedule = teamGroup === null
    ? await prisma.club.findUnique({
        where: { id },
        select: {
          trainingDates: true,
          trainingDateTimes: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
          trainingFieldSelections: true,
        },
      })
    : await prisma.clubTrainingGroupSchedule.findUnique({
        where: { clubId_teamGroup: { clubId: id, teamGroup } },
        select: {
          trainingDates: true,
          trainingDateTimes: true,
          trainingDurationMinutes: true,
          trainingFieldId: true,
          trainingFieldPieceIds: true,
          trainingFieldSelections: true,
        },
      });
  let trainingDateTimes: Record<string, string> = {};
  let trainingFieldSelections: Record<string, { trainingFieldId: string | null; trainingFieldPieceIds: string[] }> = {};
  if (trainingDates.length > 0) {
    if (hasTrainingFields && !trainingFieldSelection.trainingFieldId) {
      return NextResponse.json({ error: "Треньорът трябва да избере терен." }, { status: 400 });
    }
    try {
      trainingFieldSelections = parseTrainingFieldSelectionsByDate({
        trainingFieldSelections: rawTrainingFieldSelections,
        trainingDates,
        fallback: trainingFieldSelection,
      });
      if (hasTrainingFields && trainingDates.some((date) => !trainingFieldSelections[date]?.trainingFieldId)) {
        return NextResponse.json({ error: "Треньорът трябва да избере терен за всеки тренировъчен ден." }, { status: 400 });
      }
      if (hasTrainingFields) {
        await verifyTrainingFieldSelectionsByDate(id, trainingFieldSelections);
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid training field." },
        { status: 400 },
      );
    }
    try {
      trainingDateTimes = buildTrainingDateTimes({
        rawTrainingDateTimes,
        trainingDates,
        fallbackTrainingTime: trainingTime,
      });
      const conflictCheck = pickTrainingConflictCheckInput({
        checkDates: conflictCheckDates,
        previousDates: previousTrainingSchedule?.trainingDates ?? [],
        previousDateTimes: previousTrainingSchedule?.trainingDateTimes,
        previousDurationMinutes: previousTrainingSchedule?.trainingDurationMinutes ?? trainingDurationMinutes,
        previousFieldId: previousTrainingSchedule?.trainingFieldId ?? null,
        previousFieldPieceIds: previousTrainingSchedule?.trainingFieldPieceIds ?? [],
        previousFieldSelections: previousTrainingSchedule?.trainingFieldSelections,
        previousTeamGroups: teamGroup === null ? [] : [teamGroup],
        nextDates: trainingDates,
        nextDateTimes: trainingDateTimes,
        nextDurationMinutes: trainingDurationMinutes,
        nextFieldId: trainingFieldSelection.trainingFieldId,
        nextFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
        nextFieldSelections: trainingFieldSelections,
        nextTeamGroups: teamGroup === null ? [] : [teamGroup],
      });
      if (hasTrainingFields) {
        await assertNoTrainingFieldConflict({
          clubId: id,
          trainingDates: conflictCheck.trainingDates,
          trainingDateTimes: conflictCheck.trainingDateTimes,
          trainingDurationMinutes,
          trainingFieldId: trainingFieldSelection.trainingFieldId,
          trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
          trainingFieldSelections: conflictCheck.trainingFieldSelections,
          exclude: teamGroup === null
            ? { type: "club" }
            : { type: "teamGroup", teamGroup },
          excludeTeamGroups: teamGroup === null ? [] : [teamGroup],
        });
      }
      await assertNoTrainingTimeConflict({
        clubId: id,
        trainingDates: conflictCheck.trainingDates,
        trainingDateTimes: conflictCheck.trainingDateTimes,
        trainingDurationMinutes,
        exclude: teamGroup === null
          ? { type: "club" }
          : { type: "teamGroup", teamGroup },
        excludeTeamGroups: teamGroup === null ? [] : [teamGroup],
        ignoreFieldResourceSchedules: hasTrainingFields,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid training date times." },
        { status: 400 },
      );
    }
  }

  const trainingWeekdays = Array.from(
    new Set(trainingDates.map((date) => getWeekdayMondayFirst(date, FIXED_TIME_ZONE)).filter((value) => value >= 1 && value <= 7)),
  ).sort((a, b) => a - b);

  const previousGroupSchedule = teamGroup === null ? null : previousTrainingSchedule;

  const updated = await prisma.club.update({
    where: { id },
    data: {
      reminderDay,
      overdueDay,
      reminderHour,
      reminderMinute,
      secondReminderDay,
      secondReminderHour,
      secondReminderMinute,
      thirdReminderDay,
      thirdReminderHour,
      thirdReminderMinute,
      overdueHour,
      overdueMinute,
      reminderTz: FIXED_TIME_ZONE,
      ...(teamGroup === null
        ? {
      trainingDates,
          trainingTime,
          trainingDateTimes,
          trainingDurationMinutes,
          trainingFieldId: trainingFieldSelection.trainingFieldId,
          trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
          trainingFieldSelections,
          trainingWeekdays,
      trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      reminderDay: true,
      overdueDay: true,
      reminderHour: true,
      reminderMinute: true,
      secondReminderDay: true,
      secondReminderHour: true,
      secondReminderMinute: true,
      thirdReminderDay: true,
      thirdReminderHour: true,
      thirdReminderMinute: true,
      overdueHour: true,
      overdueMinute: true,
      trainingDates: true,
      trainingTime: true,
      trainingDateTimes: true,
      trainingDurationMinutes: true,
      trainingFieldId: true,
      trainingFieldPieceIds: true,
      trainingFieldSelections: true,
      trainingWeekdays: true,
      trainingWindowDays: true,
    },
  });

  if (teamGroup !== null) {
    await prisma.clubTrainingGroupSchedule.upsert({
      where: {
        clubId_teamGroup: {
          clubId: id,
          teamGroup,
        },
      },
      update: {
        trainingDates,
        trainingTime,
        trainingDateTimes,
        trainingDurationMinutes,
        trainingFieldId: trainingFieldSelection.trainingFieldId,
        trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
        trainingFieldSelections,
        trainingWeekdays,
        trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
      },
      create: {
        clubId: id,
        teamGroup,
        trainingDates,
        trainingTime,
        trainingDateTimes,
        trainingDurationMinutes,
        trainingFieldId: trainingFieldSelection.trainingFieldId,
        trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
        trainingFieldSelections,
        trainingWeekdays,
        trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
      },
    });
    const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
    await prisma.$transaction(
      (tx) =>
        syncFutureTrainingSessions({
          tx,
          clubId: id,
          scope: { type: "teamGroup", teamGroup },
          trainingDates,
          trainingDateTimes,
          trainingDurationMinutes,
          trainingFieldId: trainingFieldSelection.trainingFieldId,
          trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
          trainingFieldSelections,
          todayIso,
        }),
      { timeout: 30000 },
    );

    const groupsContainingTeamGroup = await prisma.clubTrainingScheduleGroup.findMany({
      where: {
        clubId: id,
        teamGroups: {
          has: teamGroup,
        },
      },
      select: {
        id: true,
        teamGroups: true,
      },
    });

    for (const group of groupsContainingTeamGroup) {
      const nextTeamGroups = group.teamGroups.filter((value) => value !== teamGroup);
      if (nextTeamGroups.length < 2) {
        await prisma.clubTrainingScheduleGroup.delete({
          where: { id: group.id },
        });
        continue;
      }

      await prisma.clubTrainingScheduleGroup.update({
        where: { id: group.id },
        data: {
          teamGroups: nextTeamGroups,
        },
      });
    }

    let notifications = null;
    if (
      shouldNotifyForTrainingDatesChange(
        previousGroupSchedule?.trainingDates ?? [],
        trainingDates,
      )
    ) {
      notifications = await sendTrainingScheduleNotifications({
        clubId: id,
        teamGroups: [teamGroup],
        previousDates: previousGroupSchedule?.trainingDates ?? [],
        trainingDates,
      });
    }

    return NextResponse.json({
      ...updated,
      teamGroup,
      trainingDates,
      trainingTime,
      trainingDateTimes,
      trainingDurationMinutes,
      trainingFieldId: trainingFieldSelection.trainingFieldId,
      trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
      trainingFieldSelections,
      trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
      notifications,
    });
  }

  const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
  await prisma.$transaction(
    (tx) =>
      syncFutureTrainingSessions({
        tx,
        clubId: id,
        scope: { type: "club" },
        trainingDates,
        trainingDateTimes,
        trainingDurationMinutes,
        trainingFieldId: trainingFieldSelection.trainingFieldId,
        trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
        trainingFieldSelections,
        todayIso,
      }),
    { timeout: 30000 },
  );

  return NextResponse.json({
    ...updated,
    teamGroup,
    trainingDates,
    trainingTime,
    trainingDateTimes,
    trainingDurationMinutes,
    trainingFieldId: trainingFieldSelection.trainingFieldId,
    trainingFieldPieceIds: trainingFieldSelection.trainingFieldPieceIds,
    trainingFieldSelections,
    trainingWindowDays: TRAINING_SELECTION_WINDOW_DAYS,
  });
}
