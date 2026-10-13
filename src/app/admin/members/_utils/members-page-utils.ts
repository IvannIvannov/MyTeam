import { TRAINING_SELECTION_WINDOW_DAYS } from "@/lib/trainingScheduleWindow";
import type { Member, MemberCard, PaymentLog, PlayerStatus, StatusMeta, TrainingFieldSelection, TrainingTimeMode } from "../_types/members-page-types";
import { isCustomTrainingGroupPaletteColor } from "@/lib/customTrainingGroupColors";

// Reports-related imports
const MONTHS = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];



const TRAINING_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DEFAULT_TRAINING_DURATION_MINUTES = 60;

const TRAINING_WEEKDAY_SHORT_BG = Array.from({ length: 7 }, (_, index) =>
  new Intl.DateTimeFormat("bg-BG", { weekday: "short" })
    .format(new Date(Date.UTC(2024, 0, index + 1)))
    .replace(".", ""),
);

const TRAINING_WEEKDAY_LONG_BG = Array.from({ length: 7 }, (_, index) => {
  const day = new Intl.DateTimeFormat("bg-BG", { weekday: "long" }).format(new Date(Date.UTC(2024, 0, index + 1)));
  return day.charAt(0).toUpperCase() + day.slice(1);
});

function normalizeMember(item: unknown): Member {
  const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
  const fullName = String(raw.fullName ?? "").trim();
  const cards: MemberCard[] = Array.isArray(raw.cards)
    ? raw.cards.map((card) => {
      const cardRaw = typeof card === "object" && card !== null ? (card as Record<string, unknown>) : {};
      return {
        cardCode: String(cardRaw.cardCode ?? ""),
        isActive: Boolean(cardRaw.isActive),
      };
    })
    : [];
  const activeCard = cards.find((c) => c.isActive);
  const nfcTagId = activeCard?.cardCode ?? cards[0]?.cardCode ?? "";
  const paymentLogs: PaymentLog[] = Array.isArray(raw.paymentLogs)
    ? raw.paymentLogs.map((log) => {
      const logRaw = typeof log === "object" && log !== null ? (log as Record<string, unknown>) : {};
      return {
        id: String(logRaw.id ?? ""),
        paidFor: String(logRaw.paidFor ?? ""),
        paidAt: String(logRaw.paidAt ?? ""),
      };
    })
    : [];
  const rawStatus = raw.status;
  const status: PlayerStatus =
    rawStatus === "paid" || rawStatus === "warning" || rawStatus === "overdue" || rawStatus === "paused"
      ? rawStatus
      : "paid";

  const imageUrl = raw.imageUrl ? String(raw.imageUrl) : null;
  const avatarUrl = raw.avatarUrl ? String(raw.avatarUrl) : imageUrl;
  const clubRaw = typeof raw.club === "object" && raw.club !== null ? (raw.club as Record<string, unknown>) : null;

  return {
    id: String(raw.id ?? ""),
    fullName,
    nfcTagId,
    status,
    teamGroup: typeof raw.teamGroup === "number" ? raw.teamGroup : null,
    coachGroupIds: Array.isArray(raw.coachGroupIds) ? (raw.coachGroupIds as unknown[]).map((v) => String(v ?? "")).filter(Boolean) : [],
    customTrainingGroupColors: Array.isArray(raw.customTrainingGroupColors)
      ? (raw.customTrainingGroupColors as unknown[])
          .map((v) => String(v ?? "").trim())
          .filter((c) => isCustomTrainingGroupPaletteColor(c))
      : [],
    jerseyNumber: raw.jerseyNumber ? String(raw.jerseyNumber) : null,
    parentPhone: raw.parentPhone ? String(raw.parentPhone) : null,
    playerPhone: raw.playerPhone ? String(raw.playerPhone) : null,
    avatarUrl,
    imageUrl,
    imagePublicId: raw.imagePublicId ? String(raw.imagePublicId) : null,
    birthDate: raw.birthDate ? String(raw.birthDate) : null,
    lastPaymentDate: raw.lastPaymentDate ? String(raw.lastPaymentDate) : null,
    paymentAmount: raw.paymentAmount === null || raw.paymentAmount === undefined ? null : String(raw.paymentAmount),
    club: clubRaw
      ? {
        id: String(clubRaw.id ?? ""),
        name: String(clubRaw.name ?? ""),
      }
      : undefined,
    paymentLogs,
    cards,
    isActive: Boolean(raw.isActive ?? true),
  };
}

function toIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getTodayIsoDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatBirthDateForExport(value: string | null): string {
  if (!value) {
    return "-";
  }

  const isoMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleDateString("en-GB", { timeZone: "UTC" });
}

function formatIsoDateForDisplay(value: string): string {
  const isoMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) {
    return value;
  }
  const [, year, month, day] = isoMatch;
  return `${day}.${month}.${year}`;
}

function getNextTrainingCalendarDates(days = TRAINING_SELECTION_WINDOW_DAYS): string[] {
  const startIso = getTodayIsoDate();
  const start = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const result: string[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    result.push(toIsoDateOnly(new Date(start + offset * 24 * 60 * 60 * 1000)));
  }

  return result;
}

function getWeekdayMondayFirstIndex(isoDate: string): number {
  const day = new Date(`${isoDate}T12:00:00.000Z`).getUTCDay();
  return (day + 6) % 7;
}

function normalizeTrainingDateTimes(
  raw: unknown,
  selectedDates: string[],
  fallbackTrainingTime?: string | null,
): Record<string, string> {
  const selectedSet = new Set(selectedDates);
  const normalized: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!selectedSet.has(date)) {
        continue;
      }
      const time = typeof value === "string" ? value.trim() : "";
      if (TRAINING_TIME_REGEX.test(time)) {
        normalized[date] = time;
      }
    }
  }
  const fallback = typeof fallbackTrainingTime === "string" ? fallbackTrainingTime.trim() : "";
  if (TRAINING_TIME_REGEX.test(fallback)) {
    for (const date of selectedDates) {
      if (!normalized[date]) {
        normalized[date] = fallback;
      }
    }
  }
  return normalized;
}

function getUniformTrainingTime(dates: string[], dateTimes: Record<string, string>): string {
  if (dates.length === 0) {
    return "";
  }
  const first = (dateTimes[dates[0]] ?? "").trim();
  if (!TRAINING_TIME_REGEX.test(first)) {
    return "";
  }
  return dates.every((date) => (dateTimes[date] ?? "").trim() === first) ? first : "";
}

function normalizeTrainingDurationInput(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1440 ? parsed : DEFAULT_TRAINING_DURATION_MINUTES;
}

function getTrainingDurationFormValue(raw: unknown): string {
  return String(normalizeTrainingDurationInput(raw));
}

function normalizeOptionalId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

function normalizeTrainingFieldSelections(
  raw: unknown,
  dates: string[],
  fallback?: TrainingFieldSelection,
): Record<string, TrainingFieldSelection> {
  const allowedDates = new Set(dates);
  const result: Record<string, TrainingFieldSelection> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!allowedDates.has(date) || !value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const source = value as Record<string, unknown>;
      const trainingFieldId = normalizeOptionalId(source.trainingFieldId);
      result[date] = {
        trainingFieldId,
        trainingFieldPieceIds: Array.isArray(source.trainingFieldPieceIds)
          ? source.trainingFieldPieceIds.map(String).filter(Boolean)
          : [],
      };
    }
  }
  for (const date of dates) {
    if (!result[date] && fallback?.trainingFieldId) {
      result[date] = {
        trainingFieldId: fallback.trainingFieldId,
        trainingFieldPieceIds: fallback.trainingFieldPieceIds,
      };
    }
  }
  return result;
}

function inferTrainingTimeMode(dates: string[], dateTimes: Record<string, string>): TrainingTimeMode {
  if (dates.length <= 1) {
    return "all";
  }
  if (getUniformTrainingTime(dates, dateTimes)) {
    return "all";
  }

  const weekdayToTime = new Map<number, string>();
  let isByWeekday = true;
  for (const date of dates) {
    const time = (dateTimes[date] ?? "").trim();
    if (!TRAINING_TIME_REGEX.test(time)) {
      isByWeekday = false;
      break;
    }
    const weekday = getWeekdayMondayFirstIndex(date);
    const prev = weekdayToTime.get(weekday);
    if (!prev) {
      weekdayToTime.set(weekday, time);
      continue;
    }
    if (prev !== time) {
      isByWeekday = false;
      break;
    }
  }

  return isByWeekday ? "byWeekday" : "perDay";
}

function parseSelectedTeamGroup(selectedGroup: string): number | null {
  if (selectedGroup === "all") {
    return null;
  }
  const parsed = Number.parseInt(selectedGroup, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(normalized);
  const output = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }

  return output;
}

function buildCalendarMonths(dates: string[]) {
  const monthKeys = Array.from(
    new Set(
      dates.map((date) => {
        const [year, month] = date.split("-").map((value) => Number.parseInt(value ?? "", 10));
        return `${year}-${String(month).padStart(2, "0")}`;
      }),
    ),
  );

  return monthKeys
    .map((key) => {
      const [year, month] = key.split("-").map((value) => Number.parseInt(value ?? "", 10));
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return null;
      }

      const firstDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const leadingEmpty = getWeekdayMondayFirstIndex(firstDate);
      const cells: Array<string | null> = Array.from({ length: leadingEmpty }, () => null);

      for (let day = 1; day <= daysInMonth; day += 1) {
        cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
      }
      while (cells.length % 7 !== 0) {
        cells.push(null);
      }

      return {
        key,
        label: `${MONTHS[month - 1] ?? ""} ${year}`,
        cells,
      };
    })
    .filter((month): month is { key: string; label: string; cells: Array<string | null> } => month !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}

const getStatusMeta = (status: PlayerStatus): StatusMeta => {
  if (status === "paid") return {
    label: "Платено",
    color: "#32cd32",
    bg: "rgba(50,205,50,0.2)",
    border: "rgba(50,205,50,0.3)",
    cls: "badge--paid",
  };
  if (status === "warning") return {
    label: "Напомняне",
    color: "#ffd700",
    bg: "rgba(255,215,0,0.2)",
    border: "rgba(255,215,0,0.3)",
    cls: "badge--reminder",
  };
  if (status === "paused") return {
    label: "Пауза",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.2)",
    border: "rgba(96,165,250,0.3)",
    cls: "badge--reminder",
  };
  return {
    label: "Просрочено",
    color: "#ff4d4d",
    bg: "rgba(255,77,77,0.2)",
    border: "rgba(255,77,77,0.3)",
    cls: "badge--overdue",
  };
};

export {
  MONTHS,
  TRAINING_SELECTION_WINDOW_DAYS,
  TRAINING_TIME_REGEX,
  DEFAULT_TRAINING_DURATION_MINUTES,
  TRAINING_WEEKDAY_SHORT_BG,
  TRAINING_WEEKDAY_LONG_BG,
  normalizeMember,
  toIsoDateOnly,
  getTodayIsoDate,
  formatBirthDateForExport,
  formatIsoDateForDisplay,
  getNextTrainingCalendarDates,
  getWeekdayMondayFirstIndex,
  normalizeTrainingDateTimes,
  getUniformTrainingTime,
  normalizeTrainingDurationInput,
  getTrainingDurationFormValue,
  normalizeOptionalId,
  normalizeTrainingFieldSelections,
  inferTrainingTimeMode,
  parseSelectedTeamGroup,
  urlBase64ToUint8Array,
  buildCalendarMonths,
  getStatusMeta,
};
