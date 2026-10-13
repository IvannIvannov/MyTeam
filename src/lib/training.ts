import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function formatDatePartsToIso(parts: Intl.DateTimeFormatPart[]) {
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to build date parts");
  }

  return `${year}-${month}-${day}`;
}

export function getTodayIsoDateInTimeZone(timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatDatePartsToIso(formatter.formatToParts(new Date()));
}

export function isoDateToUtcMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function utcDateToIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return utcDateToIsoDate(parsed) === value;
}

export function isValidTrainingTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim());
}

export function normalizeTrainingTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = String(raw).trim();
  if (!value) {
    return null;
  }
  if (!isValidTrainingTime(value)) {
    throw new Error("Invalid trainingTime. Use HH:mm.");
  }
  return value;
}

export function normalizeTrainingDurationMinutes(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
    throw new Error("Invalid trainingDurationMinutes. Use minutes between 1 and 1440.");
  }
  return parsed;
}

export function getWeekdayMondayFirst(isoDate: string, timeZone: string): number {
  const probe = new Date(`${isoDate}T12:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  const short = formatter.format(probe);
  return WEEKDAY_TO_INDEX[short] ?? 0;
}

export function getUpcomingTrainingDates(input: {
  weekdays: number[];
  windowDays: number;
  timeZone: string;
}): string[] {
  const weekdaysSet = new Set(
    input.weekdays
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
      .map((value) => Number(value)),
  );
  if (weekdaysSet.size === 0 || input.windowDays <= 0) {
    return [];
  }

  const todayIso = getTodayIsoDateInTimeZone(input.timeZone);
  const start = isoDateToUtcMidnight(todayIso).getTime();
  const result: string[] = [];

  for (let offset = 0; offset < input.windowDays; offset += 1) {
    const date = new Date(start + offset * MS_PER_DAY);
    const iso = utcDateToIsoDate(date);
    const weekday = getWeekdayMondayFirst(iso, input.timeZone);
    if (weekdaysSet.has(weekday)) {
      result.push(iso);
    }
  }

  return result;
}

export function getConfiguredTrainingDates(input: {
  trainingDates?: string[] | null;
  weekdays?: number[] | null;
  windowDays?: number;
  timeZone: string;
  maxDays?: number;
}): string[] {
  const maxDays = Number.isInteger(input.maxDays) && Number(input.maxDays) > 0 ? Number(input.maxDays) : TRAINING_SELECTION_WINDOW_DAYS;
  const todayIso = getTodayIsoDateInTimeZone(input.timeZone);
  const start = isoDateToUtcMidnight(todayIso).getTime();
  const end = start + (maxDays - 1) * MS_PER_DAY;

  if (Array.isArray(input.trainingDates) && input.trainingDates.length > 0) {
    const explicitDates = Array.from(
      new Set(
        input.trainingDates
          .map((value) => String(value).trim())
          .filter((value) => isIsoDate(value))
          .filter((value) => {
            const timestamp = isoDateToUtcMidnight(value).getTime();
            return timestamp >= start && timestamp <= end;
          }),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return explicitDates;
  }

  const fallbackWindowDays =
    Number.isInteger(input.windowDays) && Number(input.windowDays) > 0 ? Number(input.windowDays) : maxDays;
  return getUpcomingTrainingDates({
    weekdays: Array.isArray(input.weekdays) ? input.weekdays : [],
    windowDays: fallbackWindowDays,
    timeZone: input.timeZone,
  });
}
