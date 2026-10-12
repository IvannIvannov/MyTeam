"use client";
import { getTrainingCountdownCandidates, getTrainingDateTimeMs } from "@/lib/memberScheduleCountdown";

import { use, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NotificationText } from "@/components/NotificationText";
import MemberTrainingSessions from "@/components/MemberTrainingSessions";
import { uploadImage } from "@/lib/uploadImage";
import { extractUploadPathFromCloudinaryUrl } from "@/lib/cloudinaryImagePath";
import { getCompatiblePushSubscription } from "@/lib/push/browser";
import "./page.css";

interface MemberProfile {
  id: string;
  cardCode: string;
  name: string;
  clubId?: string | null;
  clubName?: string | null;
  clubSports?: string | null;
  clubLogoUrl?: string | null;
  clubRulesDocuments?: { id: string; name: string }[];
  paymentWorkflow?: "calendar_month" | "rolling_30_days" | "training_credits" | "training_credits_30_days";
  onlinePaymentEnabled?: boolean;
  defaultOnlineTrainingCredits?: number;
  remainingTrainingCredits?: number;
  avatarUrl?: string | null;
  jerseyNumber?: string | null;
  parentPhone?: string | null;
  playerPhone?: string | null;
  birthDate?: string | null;
  isActive?: boolean;
  team_group?: number | null;
  status?: "paid" | "warning" | "overdue" | "paused";
  last_payment_date?: string | null;
  notifications?: Array<{
    id: string;
    title: string;
    sentAt: string;
  }>;
  paymentLogs?: Array<{
    id: string;
    paidFor: string;
    paidAt: string;
  }>;
  paymentWaivers?: Array<{
    id: string;
    waivedFor: string;
    reason?: string | null;
    createdAt: string;
    createdBy: string;
  }>;
  firstBillingMonth?: string | null;
  isPausedThisMonth?: boolean;
  discounts?: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    badgeText: string | null;
    code: string | null;
    storeUrl: string | null;
    terms: string[];
    themeColor: string | null;
  }>;
}

interface LimitedEventInfo {
  id: string;
  maxSpots: number;
  spotsRemaining: number;
  isRegistered: boolean;
  isConfirmed: boolean;
  waitlistPosition: number | null;
}

interface TrainingSessionItem {
  id?: string;
  optedOut?: boolean;
  optOutReasonCode?: string | null;
  optOutReasonText?: string | null;
  scopeKey: string;
  note?: string;
  trainingTime?: string;
  trainingDurationMinutes?: number;
  trainingFieldName?: string | null;
  trainingFieldType?: string | null;
  trainingFieldPieces?: string[];
  trainingFieldPieceNames?: string[];
  limitedEvent?: LimitedEventInfo | null;
}

interface TrainingDayStatus {
  date: string;
  weekday: number;
  optedOut: boolean;
  optOutReasonCode?: TrainingOptOutReasonCode | null;
  optOutReasonText?: string | null;
  trainingTime?: string;
  trainingDurationMinutes?: number;
  note: string;
  trainingFieldName?: string | null;
  trainingFieldType?: string | null;
  trainingFieldPieces?: string[];
  trainingFieldPieceNames?: string[];
  limitedEvent?: LimitedEventInfo | null;
  sessions: TrainingSessionItem[];
}

interface IrisOnlinePayment {
  id: string;
  orderId: string;
  paymentHash: string;
  paymentLink: string;
  shortPaymentLink?: string | null;
  amount: string;
  currency: string;
  status: "WAITING" | "FAILED" | "CONFIRMED";
  qrUrl: string;
}

interface MemberMatch {
  id: string;
  opponent: string;
  location: string;
  matchDate: string;
  matchTime: string;
  isHome: boolean;
  durationMinutes: number | null;
  teamGroups: number[];
}

type TrainingOptOutReasonCode = "injury" | "sick" | "other";

const SPEED_LINES = [8, 16, 24, 33, 42, 54, 65, 76, 85, 93];

const MONTH_NAMES_BG = [
  "Яну", "Фев", "Мар", "Апр", "Май", "Юни",
  "Юли", "Авг", "Сеп", "Окт", "Ное", "Дек",
];

const MONTH_NAMES_BG_FULL = [
  "Януари", "Февруари", "Март", "Април", "Май", "Юни",
  "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември",
];

const TRAINING_WEEKDAY_LABELS_BG: Record<number, string> = {
  1: "Понеделник",
  2: "Вторник",
  3: "Сряда",
  4: "Четвъртък",
  5: "Петък",
  6: "Събота",
  7: "Неделя",
};
const TRAINING_WEEKDAY_SHORT_BG = Array.from({ length: 7 }, (_, index) =>
  new Intl.DateTimeFormat("bg-BG", { weekday: "short" })
    .format(new Date(Date.UTC(2024, 0, 1 + index)))
    .replace(".", ""),
);

const TRAINING_FIELD_TYPES = new Set(["football", "basketball", "tennis", "volleyball", "boxing", "karate", "swimming"]);

function normalizeTrainingFieldType(raw: unknown, fallbackSport?: string | null): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (TRAINING_FIELD_TYPES.has(value)) return value;

  const sport = String(fallbackSport ?? "").trim().toLowerCase();
  if (/basket|баскетбол/.test(sport)) return "basketball";
  if (/tenis|тенис/.test(sport)) return "tennis";
  if (/voley|волей/.test(sport)) return "volleyball";
  if (/box|бокс/.test(sport)) return "boxing";
  if (/karat|karate|карате|taekwon|таекуондо|judo|джудо/.test(sport)) return "karate";
  if (/swim|плув|басейн/.test(sport)) return "swimming";
  return "football";
}

const STATUS_MAP = {
  paid: { label: "ТАКСА: ПЛАТЕНА", cls: "green glow" },
  warning: { label: "ПРЕДСТОЯЩО ПЛАЩАНЕ", cls: "yellow glow-yellow" },
  overdue: { label: "ТАКСА: ДЪЛЖИМА", cls: "red glow-red" },
} as const;

const ShareIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v13" />
    <path d="m16 6-4-4-4 4" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
  </svg>
);

const BellIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
  </svg>
);

const BellOffIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 8.21 3.342" />
    <path d="m2 2 20 20" />
  </svg>
);

const SpinnerIcon = ({ size = 16 }: { size?: number }) => (
  <svg className="spin-icon" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const FileTextIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);

const PrinterIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

const ArrowLeftIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const LogoutIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const XIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const ChevronIcon = ({ direction }: { direction: "left" | "right" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {direction === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
  </svg>
);

// ── Helpers ──────────────────────────────────────────────
function parseYearMonth(dateStr: string): { year: number; month: number } {
  const d = new Date(dateStr);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

function cmpYM(a: { year: number; month: number }, b: { year: number; month: number }) {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function addMonths(ym: { year: number; month: number }, n: number) {
  const d = new Date(ym.year, ym.month + n, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function toISOMonth(ym: { year: number; month: number }) {
  const mm = String(ym.month + 1).padStart(2, "0");
  return `${ym.year}-${mm}-01T00:00:00.000Z`;
}

function buildTrainingCalendarMonth(year: number, month: number) {
  const displayMonth = month + 1;
  const daysInMonth = new Date(Date.UTC(year, displayMonth, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const leadingEmptyDays = (firstWeekday + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: leadingEmptyDays }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(displayMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return {
    key: `${year}-${displayMonth}`,
    label: `${MONTH_NAMES_BG_FULL[month] ?? ""} ${year}`,
    cells,
  };
}

function formatIsoDateForBgDisplay(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatMonthYearInBgUtc(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const text = parsed.toLocaleDateString("bg-BG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatTrainingDuration(minutes?: number): string {
  if (!Number.isInteger(minutes) || !minutes || minutes < 1) {
    return "";
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function MemberCardPage({
  params,
}: {
  params: Promise<{ cardCode: string }>;
}) {
  const { cardCode } = use(params);
  const normalizedCardCode = cardCode.trim().toUpperCase();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [member, setMember] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCoach, setIsCoach] = useState(false);
  const [viewerRoleChecked, setViewerRoleChecked] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [pushStatusMessage, setPushStatusMessage] = useState("");
  const [pushStatusTone, setPushStatusTone] = useState<"success" | "danger">("success");
  const [pushErrorMessage, setPushErrorMessage] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [activeDiscount, setActiveDiscount] = useState<{
    id: string;
    name: string;
    logoUrl: string | null;
    badgeText: string | null;
    code: string | null;
    storeUrl: string | null;
    terms: string[];
    themeColor?: string | null;
    validUntil?: string | null;
  } | null>(null);
  const [activeDiscountCodeCopied, setActiveDiscountCodeCopied] = useState(false);
  const [allDiscountsModalOpen, setAllDiscountsModalOpen] = useState(false);
  const [isIPhoneDevice, setIsIPhoneDevice] = useState(false);
  const [isStandaloneMode, setIsStandaloneMode] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreviewUrl, setEditImagePreviewUrl] = useState("");
  const [editForm, setEditForm] = useState({
    fullName: "",
    birthDate: "",
    teamGroup: "",
    jerseyNumber: "",
    parentPhone: "",
    playerPhone: "",
  });

  // Notifications
  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    url?: string | null;
    sentAt: string;
    readAt: string | null;
  }>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [lastHandledPushOpenTs, setLastHandledPushOpenTs] = useState<string | null>(null);

  // Payment modal
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentModalMode, setPaymentModalMode] = useState<"create" | "delete">("create");
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [selectedYM, setSelectedYM] = useState<{ year: number; month: number } | null>(null);
  const [selectedPaymentDeleteMonths, setSelectedPaymentDeleteMonths] = useState<Array<{ year: number; month: number }>>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [irisPaymentLoading, setIrisPaymentLoading] = useState(false);
  const [irisStatusLoading, setIrisStatusLoading] = useState(false);
  const [irisPayment, setIrisPayment] = useState<IrisOnlinePayment | null>(null);
  const irisPaymentRequestIdRef = useRef(0);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentTrainingCredits, setPaymentTrainingCredits] = useState("");
  const [trainingCreditLoading, setTrainingCreditLoading] = useState(false);
  const [trainingCreditError, setTrainingCreditError] = useState<string | null>(null);
  const [trainingCreditSuccess, setTrainingCreditSuccess] = useState<string | null>(null);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseActionLoading, setPauseActionLoading] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [selectedPauseMonths, setSelectedPauseMonths] = useState<Array<{ year: number; month: number }>>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<{
    id: string;
    paidFor: string;
    paidAt: string;
  } | null>(null);
  const [trainingDays, setTrainingDays] = useState<TrainingDayStatus[]>([]);
  const [trainingWindowDays, setTrainingWindowDays] = useState(30);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [memberMatches, setMemberMatches] = useState<MemberMatch[]>([]);
  const [trainingSavingDate, setTrainingSavingDate] = useState<string | null>(null);
  const [registerSavingEventId, setRegisterSavingEventId] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [trainingModalOpen, setTrainingModalOpen] = useState(false);
  const [trainingCalendarMonth, setTrainingCalendarMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [trainingDetailsDate, setTrainingDetailsDate] = useState<string | null>(null);
  const [trainingNotePopupOpen, setTrainingNotePopupOpen] = useState(false);
  const [trainingAttendancePopupOpen, setTrainingAttendancePopupOpen] = useState(false);
  const [trainingDayPopupTab, setTrainingDayPopupTab] = useState<"training" | "match">("training");
  const [matchDetailsPopupOpen, setMatchDetailsPopupOpen] = useState(false);
  const [matchDetailsMatch, setMatchDetailsMatch] = useState<MemberMatch | null>(null);
  const [trainingConfirmModalOpen, setTrainingConfirmModalOpen] = useState(false);
  const [trainingConfirmAction, setTrainingConfirmAction] = useState<"attend" | "optOut" | null>(null);
  const [trainingOptOutReasonCode, setTrainingOptOutReasonCode] = useState<TrainingOptOutReasonCode | "">("");
  const [birthdayCardOpen, setBirthdayCardOpen] = useState(false);
  const [trainingOptOutReasonText, setTrainingOptOutReasonText] = useState("");
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());

  // ── Derived: paid months set ─────────────────────────
  const paidSet = new Set<string>(
    (member?.paymentLogs ?? []).map(({ paidFor }) => {
      const { year, month } = parseYearMonth(paidFor);
      return `${year}-${month}`;
    })
  );
  const waivedSet = new Set<string>(
    (member?.paymentWaivers ?? []).map(({ waivedFor }) => {
      const { year, month } = parseYearMonth(waivedFor);
      return `${year}-${month}`;
    })
  );
  const settledSet = new Set<string>([...paidSet, ...waivedSet]);

  // Demo clubs can test payments before billing activation; start from current month.
  const firstBillingYM: { year: number; month: number } | null = (() => {
    if (!member) return null;
    if (!member.firstBillingMonth) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() };
    }
    return parseYearMonth(member.firstBillingMonth);
  })();
  const selectedPauseKeys = new Set(
    selectedPauseMonths.map((item) => `${item.year}-${item.month}`),
  );
  const selectedPaymentDeleteKeys = new Set(
    selectedPaymentDeleteMonths.map((item) => `${item.year}-${item.month}`),
  );
  const canApplyPause = selectedPauseMonths.some(
    (item) => !waivedSet.has(`${item.year}-${item.month}`),
  );
  const canRemovePause = selectedPauseMonths.some(
    (item) => waivedSet.has(`${item.year}-${item.month}`),
  );
  const trainingDaysSorted = [...trainingDays].sort((a, b) => a.date.localeCompare(b.date));
  const trainingDaysWithNotes = trainingDaysSorted.filter((item) => item.note.trim().length > 0);
  const trainingByDate = new Map(trainingDaysSorted.map((item) => [item.date, item]));
  const matchesByDate = new Map<string, MemberMatch[]>();
  for (const m of memberMatches) {
    const existing = matchesByDate.get(m.matchDate) ?? [];
    existing.push(m);
    matchesByDate.set(m.matchDate, existing);
  }
  const trainingDetailsItem = trainingDetailsDate ? trainingByDate.get(trainingDetailsDate) ?? null : null;
  const trainingDetailsMatches = trainingDetailsDate ? (matchesByDate.get(trainingDetailsDate) ?? []) : [];
  const today = new Date();
  const isRollingThirtyDayPayment = member?.paymentWorkflow === "rolling_30_days";
  const isTrainingCreditsPayment = member?.paymentWorkflow === "training_credits";
  const isTrainingCreditsThirtyDayPayment = member?.paymentWorkflow === "training_credits_30_days";
  const isTrainingCreditBasedPayment = isTrainingCreditsPayment || isTrainingCreditsThirtyDayPayment;
  const isThirtyDayBasedPayment = isRollingThirtyDayPayment || isTrainingCreditsThirtyDayPayment;
  const remainingTrainingCredits = Math.max(0, Number(member?.remainingTrainingCredits ?? 0));
  const rollingPaymentWindow = (() => {
    if (!isThirtyDayBasedPayment || !member?.paymentLogs?.length) return null;
    const latestPaidStart = [...member.paymentLogs]
      .map(({ paidFor }) => new Date(paidFor))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latestPaidStart) return null;

    const paidUntil = new Date(latestPaidStart.getTime() + 30 * 24 * 60 * 60 * 1000);
    const remainingMs = paidUntil.getTime() - Date.now();
    const remainingDays = remainingMs > 0 ? Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) : 0;

    return { latestPaidStart, paidUntil, remainingDays };
  })();
  const hasActiveRollingPayment = Boolean(
    isRollingThirtyDayPayment && rollingPaymentWindow && rollingPaymentWindow.remainingDays > 0,
  );
  const hasActiveTrainingCreditWindow = Boolean(
    isTrainingCreditsThirtyDayPayment && rollingPaymentWindow && rollingPaymentWindow.remainingDays > 0,
  );
  const hasActiveTrainingCreditsThirtyDayPayment = Boolean(
    isTrainingCreditsThirtyDayPayment && hasActiveTrainingCreditWindow && remainingTrainingCredits > 0,
  );
  const todayDateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const trainingMonths = [buildTrainingCalendarMonth(trainingCalendarMonth.year, trainingCalendarMonth.month)];
  const nextScheduleEvent =
    [
      ...getTrainingCountdownCandidates(trainingDaysSorted),
      ...memberMatches.map((match) => ({
        type: "match" as const,
        date: match.matchDate,
        time: match.matchTime?.trim() || null,
        opponent: match.opponent,
        targetMs: getTrainingDateTimeMs(match.matchDate, match.matchTime),
      })),
    ]
      .filter((entry) => Number.isFinite(entry.targetMs))
      .sort((a, b) => a.targetMs - b.targetMs)
      .find((entry) => entry.targetMs >= countdownNowMs) ?? null;
  const nextScheduleCountdown = (() => {
    if (!nextScheduleEvent) {
      return null;
    }
    const diffMs = Math.max(0, nextScheduleEvent.targetMs - countdownNowMs);
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
  })();

  // Last paid month
  const lastPaidYM: { year: number; month: number } | null = (() => {
    if (!member?.paymentLogs?.length) return null;
    return [...member.paymentLogs]
      .map(({ paidFor }) => parseYearMonth(paidFor))
      .sort((a, b) => cmpYM(b, a))[0];
  })();

  // Next unpaid = first month not settled, anchored to firstBillingYM
  const firstUnpaidYM: { year: number; month: number } | null = (() => {
    if (!firstBillingYM) return null;

    let candidate = lastPaidYM ? addMonths(lastPaidYM, 1) : firstBillingYM;

    while (settledSet.has(`${candidate.year}-${candidate.month}`)) {
      candidate = addMonths(candidate, 1);
    }

    if (cmpYM(candidate, firstBillingYM) < 0) return firstBillingYM;

    return candidate;
  })();
  const paymentModalYM = firstUnpaidYM ?? { year: today.getFullYear(), month: today.getMonth() };

  const openPaymentModal = () => {
    setPaymentModalMode("create");
    setCalendarYear(paymentModalYM.year);
    setSelectedYM(paymentModalYM);
    setPaymentTrainingCredits("");
    setIrisPayment(null);
    setSelectedPaymentDeleteMonths([]);
    setPaymentError(
      isTrainingCreditBasedPayment && Number(member?.defaultOnlineTrainingCredits ?? 0) <= 0
        ? "Онлайн плащането за тренировки не е конфигурирано."
        : null,
    );
    setPaymentModalOpen(true);
  };

  const openPaymentDeleteModal = () => {
    const initialYear = lastPaidYM?.year ?? firstUnpaidYM?.year ?? new Date().getFullYear();
    setPaymentModalMode("delete");
    setCalendarYear(initialYear);
    setSelectedYM(null);
    setSelectedPaymentDeleteMonths([]);
    setPaymentError(null);
    setPaymentModalOpen(true);
  };

  // Month state
  type MonthState = "paid" | "waived" | "deleteSelected" | "selected" | "next" | "available" | "disabled";
  const getMonthState = (ym: { year: number; month: number }): MonthState => {
    const key = `${ym.year}-${ym.month}`;
    if (selectedPaymentDeleteKeys.has(key)) return "deleteSelected";
    if (paidSet.has(key)) return "paid";
    if (waivedSet.has(key)) return "waived";
    if (paymentModalMode === "delete") return "disabled";
    if (firstBillingYM && cmpYM(ym, firstBillingYM) < 0) return "disabled";
    if (!firstUnpaidYM || cmpYM(ym, firstUnpaidYM) < 0) return "disabled";
    const isNext = firstUnpaidYM && key === `${firstUnpaidYM.year}-${firstUnpaidYM.month}`;
    if (selectedYM && `${selectedYM.year}-${selectedYM.month}` === key) return "selected";
    if (isNext) return "next";
    return "available";
  };

  const handleMonthClick = (ym: { year: number; month: number }) => {
    const key = `${ym.year}-${ym.month}`;
    if (paidSet.has(key)) {
      if (paymentModalMode !== "delete") return;
      setSelectedPaymentDeleteMonths((prev) => {
        const exists = prev.some((item) => `${item.year}-${item.month}` === key);
        return exists
          ? prev.filter((item) => `${item.year}-${item.month}` !== key)
          : [...prev, ym];
      });
      return;
    }
    if (waivedSet.has(key)) return;
    if (paymentModalMode === "delete") return;
    if (!firstUnpaidYM) return;
    if (cmpYM(ym, firstUnpaidYM) < 0) return;
    setSelectedPaymentDeleteMonths([]);
    setSelectedYM(ym);
    if (irisPayment || irisPaymentLoading) {
      void createIrisPaymentForSelection(ym);
    }
  };

  // Fetch notifications
  const fetchNotifications = async () => {
    setLoadingNotifications(true);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}/notifications`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handleNotificationsPanelOpen = async () => {
    if (isAdmin || isCoach) {
      return;
    }
    setNotificationsPanelOpen(true);
    await fetchNotifications();

    // Mark all as read when opening the panel
    if (unreadCount > 0) {
      try {
        const response = await fetch(`/api/members/${normalizedCardCode}/notifications/read`, {
          method: "POST",
        });
        if (response.ok) {
          setNotifications(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })));
          setUnreadCount(0);
        }
      } catch (error) {
        console.error("Failed to mark notifications as read:", error);
      }
    }
  };

  const getOptOutDatesFromDays = (days: TrainingDayStatus[]) =>
    days
      .filter((item) => item.optedOut)
      .map((item) => item.date)
      .sort((a, b) => a.localeCompare(b));

  const fetchTrainingDays = async (): Promise<TrainingDayStatus[]> => {
    setTrainingLoading(true);
    setTrainingError(null);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}/training`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно зареждане на тренировките.",
        );
      }

      const payload = await response.json();
      const trainingPayloadClubSports =
        String(payload?.clubSports ?? "").trim() ||
        member?.clubSports ||
        null;
      const days = Array.isArray(payload?.dates)
        ? payload.dates
          .map((item: unknown) => {
            const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
            return {
              date: String(raw.date ?? ""),
              weekday: Number(raw.weekday ?? 0),
              optedOut: Boolean(raw.optedOut),
              optOutReasonCode:
                raw.optOutReasonCode === "injury" || raw.optOutReasonCode === "sick" || raw.optOutReasonCode === "other"
                  ? raw.optOutReasonCode
                  : null,
              optOutReasonText: String(raw.optOutReasonText ?? "").trim() || null,
              trainingTime: String(raw.trainingTime ?? "").trim(),
              trainingDurationMinutes: Number.isInteger(Number(raw.trainingDurationMinutes))
                ? Number(raw.trainingDurationMinutes)
                : undefined,
              trainingFieldName: String(raw.trainingFieldName ?? "").trim() || null,
              trainingFieldType: normalizeTrainingFieldType(raw.trainingFieldType, trainingPayloadClubSports),
              trainingFieldPieces: Array.isArray(raw.trainingFieldPieces)
                ? raw.trainingFieldPieces.map((name) => String(name ?? "").trim()).filter(Boolean)
                : [],
              trainingFieldPieceNames: Array.isArray(raw.trainingFieldPieceNames)
                ? raw.trainingFieldPieceNames.map((name) => String(name ?? "").trim()).filter(Boolean)
                : [],
              note: String(raw.note ?? ""),
              limitedEvent: (() => {
                const le = raw.limitedEvent;
                if (!le || typeof le !== "object") return null;
                const l = le as Record<string, unknown>;
                if (typeof l.id !== "string" || !l.id) return null;
                const isRegistered = Boolean(l.isRegistered);
                const isConfirmed = isRegistered && Boolean(l.isConfirmed);
                return {
                  id: l.id,
                  maxSpots: Number(l.maxSpots),
                  spotsRemaining: Number(l.spotsRemaining),
                  isRegistered,
                  isConfirmed,
                  waitlistPosition: isRegistered && !isConfirmed && typeof l.waitlistPosition === "number" ? l.waitlistPosition : null,
                } satisfies LimitedEventInfo;
              })(),
              sessions: (() => {
                const parseLimitedEvent = (le: unknown): LimitedEventInfo | null => {
                  if (!le || typeof le !== "object") return null;
                  const l = le as Record<string, unknown>;
                  if (typeof l.id !== "string" || !l.id) return null;
                  const isRegistered = Boolean(l.isRegistered);
                  const isConfirmed = isRegistered && Boolean(l.isConfirmed);
                  return {
                    id: l.id,
                    maxSpots: Number(l.maxSpots),
                    spotsRemaining: Number(l.spotsRemaining),
                    isRegistered,
                    isConfirmed,
                    waitlistPosition: isRegistered && !isConfirmed && typeof l.waitlistPosition === "number" ? l.waitlistPosition : null,
                  };
                };
                const rawSessions = Array.isArray(raw.sessions) ? raw.sessions : null;
                if (!rawSessions || rawSessions.length === 0) {
                  // Fallback: synthesize single session from top-level fields
                  return [
                    {
                      scopeKey: "",
                      note: String(raw.note ?? "").trim(),
                      trainingTime: String(raw.trainingTime ?? "").trim(),
                      trainingDurationMinutes: Number.isInteger(Number(raw.trainingDurationMinutes)) ? Number(raw.trainingDurationMinutes) : undefined,
                      trainingFieldName: String(raw.trainingFieldName ?? "").trim() || null,
                      trainingFieldType: normalizeTrainingFieldType(raw.trainingFieldType, trainingPayloadClubSports),
                      trainingFieldPieces: Array.isArray(raw.trainingFieldPieces) ? (raw.trainingFieldPieces as unknown[]).map((n) => String(n ?? "").trim()).filter(Boolean) : [],
                      trainingFieldPieceNames: Array.isArray(raw.trainingFieldPieceNames) ? (raw.trainingFieldPieceNames as unknown[]).map((n) => String(n ?? "").trim()).filter(Boolean) : [],
                      limitedEvent: parseLimitedEvent(raw.limitedEvent),
                    } satisfies TrainingSessionItem,
                  ];
                }
                return (rawSessions as unknown[]).map((s) => {
                  const rs = typeof s === "object" && s !== null ? (s as Record<string, unknown>) : {};
                  return {
                    id: typeof rs.id === "string" ? rs.id : undefined,
                    optedOut: Boolean(rs.optedOut),
                    optOutReasonCode: typeof rs.optOutReasonCode === "string" ? rs.optOutReasonCode : null,
                    optOutReasonText: typeof rs.optOutReasonText === "string" ? rs.optOutReasonText : null,
                    scopeKey: String(rs.scopeKey ?? ""),
                    note: String(rs.note ?? "").trim(),
                    trainingTime: String(rs.trainingTime ?? "").trim(),
                    trainingDurationMinutes: Number.isInteger(Number(rs.trainingDurationMinutes)) ? Number(rs.trainingDurationMinutes) : undefined,
                    trainingFieldName: String(rs.trainingFieldName ?? "").trim() || null,
                    trainingFieldType: normalizeTrainingFieldType(rs.trainingFieldType, trainingPayloadClubSports),
                    trainingFieldPieces: Array.isArray(rs.trainingFieldPieces) ? (rs.trainingFieldPieces as unknown[]).map((n) => String(n ?? "").trim()).filter(Boolean) : [],
                    trainingFieldPieceNames: Array.isArray(rs.trainingFieldPieceNames) ? (rs.trainingFieldPieceNames as unknown[]).map((n) => String(n ?? "").trim()).filter(Boolean) : [],
                    limitedEvent: parseLimitedEvent(rs.limitedEvent),
                  } satisfies TrainingSessionItem;
                });
              })(),
            } satisfies TrainingDayStatus;
          })
          .filter((item: TrainingDayStatus) => /^\d{4}-\d{2}-\d{2}$/.test(item.date))
        : [];
      const nextWindowDays = Number.parseInt(String(payload?.trainingWindowDays ?? "30"), 10);
      setTrainingWindowDays(Number.isInteger(nextWindowDays) && nextWindowDays > 0 ? nextWindowDays : 30);
      setTrainingDays(days);
      return days;
    } catch (error) {
      console.error("Failed to fetch training schedule:", error);
      setTrainingError(error instanceof Error ? error.message : "Възникна грешка.");
      setTrainingDays([]);
      return [];
    } finally {
      setTrainingLoading(false);
    }
  };

  const fetchMemberMatches = async () => {
    try {
      const res = await fetch(`/api/members/${normalizedCardCode}/matches`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { matches?: MemberMatch[] };
        setMemberMatches(data.matches ?? []);
      }
    } catch {
      // non-critical — calendar still shows trainings
    }
  };

  const openTrainingModal = async () => {
    setTrainingError(null);
    setTrainingNotePopupOpen(false);
    setTrainingDetailsDate(trainingDaysSorted[0]?.date ?? null);
    const today = new Date();
    setTrainingCalendarMonth({ year: today.getFullYear(), month: today.getMonth() });
    setTrainingModalOpen(true);
    const [latestDays] = await Promise.all([fetchTrainingDays(), fetchMemberMatches()]);
    setTrainingDetailsDate(latestDays[0]?.date ?? null);
  };

  const closeTrainingModal = () => {
    setTrainingNotePopupOpen(false);
    setTrainingDetailsDate(trainingDaysSorted[0]?.date ?? null);
    setTrainingModalOpen(false);
  };

  const trackDiscount = (partner: string, action: "view" | "copy" | "link_click") => {
    void fetch(`/api/members/${normalizedCardCode}/discount-usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partner, action }),
    }).catch(() => { });
  };

  const refreshMember = async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
      if (!response.ok) {
        setMember(null);
        setError("Профилът не е намерен.");
        return null;
      }
      const data = (await response.json()) as MemberProfile;
      setMember(data);
      return data;
    } catch (e) {
      console.error("Failed to fetch member:", e);
      setError("Възникна грешка при зареждане.");
      return null;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Fetch member
  useEffect(() => {
    void refreshMember({ showLoading: true });
  }, [normalizedCardCode]);

  useEffect(() => {
    void Promise.all([fetchTrainingDays(), fetchMemberMatches()]);
  }, [normalizedCardCode]);

  useEffect(() => {
    if (!member?.birthDate) return;
    const bday = new Date(member.birthDate);
    const now = new Date();
    const isBirthday = bday.getUTCMonth() === now.getMonth() && bday.getUTCDate() === now.getDate();
    if (!isBirthday) return;
    const sessionKey = `birthdayShown_${member.cardCode}`;
    const fromNotification = searchParams.get("openBirthday") === "1";
    if (fromNotification || !sessionStorage.getItem(sessionKey)) {
      setBirthdayCardOpen(true);
      sessionStorage.setItem(sessionKey, "1");
    }
  }, [member, searchParams]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Live updates via SSE (no polling)
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const source = new EventSource(`/api/members/${normalizedCardCode}/events`);

    source.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!payload || typeof payload !== "object") {
        return;
      }

      const type = "type" in payload ? String((payload as { type?: unknown }).type ?? "") : "";

      if (type === "ping" || type === "connected") {
        return;
      }

      if (
        type === "member-updated" ||
        type === "status-updated" ||
        type === "payment-history-updated" ||
        type === "notification-created"
      ) {
        void refreshMember();
      }

      if (type === "training-updated") {
        void Promise.all([fetchTrainingDays(), fetchMemberMatches()]);
      }

      if (type === "notification-created") {
        void (async () => {
          try {
            const response = await fetch(`/api/members/${normalizedCardCode}/notifications`, {
              cache: "no-store",
            });
            if (!response.ok) {
              return;
            }
            const data = await response.json();
            setUnreadCount(data.unreadCount || 0);
            if (notificationsPanelOpen) {
              setNotifications(data.notifications || []);
            }
          } catch (error) {
            console.error("Failed to refresh notifications after event:", error);
          }
        })();
      }
    };

    source.onerror = () => {
      // Let browser auto-reconnect.
    };

    return () => {
      source.close();
    };
  }, [normalizedCardCode, notificationsPanelOpen]);

  // Re-fetch dynamic data when app returns to foreground (SSE is lost while backgrounded on mobile).
  useEffect(() => {
    const refreshForegroundData = () => {
      void refreshMember();
      void Promise.all([fetchTrainingDays(), fetchMemberMatches()]);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshForegroundData();
    };
    const handleFocus = () => refreshForegroundData();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [normalizedCardCode]);

  useEffect(() => {
    if (!isThirtyDayBasedPayment || !rollingPaymentWindow || rollingPaymentWindow.remainingDays <= 0) {
      return;
    }

    const msUntilExpiry = rollingPaymentWindow.paidUntil.getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      void refreshMember();
      return;
    }

    const timeout = window.setTimeout(() => {
      void refreshMember();
    }, Math.min(msUntilExpiry + 1000, 2_147_483_647));

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    isThirtyDayBasedPayment,
    rollingPaymentWindow?.paidUntil.getTime(),
    rollingPaymentWindow?.remainingDays,
    normalizedCardCode,
  ]);

  // Fetch unread notification count on page load
  useEffect(() => {
    if (isAdmin || isCoach) {
      setUnreadCount(0);
      return;
    }

    const fetchUnreadCount = async () => {
      try {
        const response = await fetch(`/api/members/${normalizedCardCode}/notifications`, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          setUnreadCount(data.unreadCount || 0);
        }
      } catch (error) {
        console.error("Failed to fetch unread count:", error);
      }
    };
    void fetchUnreadCount();
  }, [normalizedCardCode, isAdmin, isCoach]);

  useEffect(() => {
    if (!member) {
      return;
    }

    setEditForm({
      fullName: member.name ?? "",
      birthDate: member.birthDate ? new Date(member.birthDate).toISOString().slice(0, 10) : "",
      teamGroup: member.team_group !== null && member.team_group !== undefined ? String(member.team_group) : "",
      jerseyNumber: member.jerseyNumber ?? "",
      parentPhone: member.parentPhone ?? "",
      playerPhone: member.playerPhone ?? "",
    });
    setEditImageFile(null);
    setEditImagePreviewUrl("");
  }, [member]);

  useEffect(() => {
    if (!editImageFile) {
      setEditImagePreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(editImageFile);
    setEditImagePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [editImageFile]);

  useEffect(() => {
    if (isAdmin || isCoach) {
      return;
    }

    const pushOpenTs = searchParams.get("pushOpenTs");
    const fromPush = searchParams.get("fromPush") === "1" && Boolean(pushOpenTs);
    const shouldOpenBell = fromPush && searchParams.get("openBell") === "1";
    const shouldOpenTraining = fromPush && searchParams.get("openTraining") === "1";
    const shouldOpenBirthday = searchParams.get("openBirthday") === "1";

    if (!shouldOpenBell && !shouldOpenTraining && !shouldOpenBirthday) {
      return;
    }

    // Bell/training require a new push event for deduplication; birthday does not
    if ((shouldOpenBell || shouldOpenTraining) && (!pushOpenTs || pushOpenTs === lastHandledPushOpenTs)) {
      if (!shouldOpenBirthday) return;
    }

    if (pushOpenTs && pushOpenTs !== lastHandledPushOpenTs) {
      setLastHandledPushOpenTs(pushOpenTs);
    }

    if (shouldOpenTraining) {
      void openTrainingModal();
    }

    if (shouldOpenBirthday) {
      setBirthdayCardOpen(true);
    }

    if (shouldOpenBell) {
      setNotificationsPanelOpen(true);
      void (async () => {
        setLoadingNotifications(true);
        try {
          const response = await fetch(`/api/members/${normalizedCardCode}/notifications`, { cache: "no-store" });
          if (response.ok) {
            const data = await response.json();
            setNotifications(data.notifications || []);
            setUnreadCount(data.unreadCount || 0);
          }
        } catch (error) {
          console.error("Failed to fetch notifications:", error);
        } finally {
          setLoadingNotifications(false);
        }

        try {
          const response = await fetch(`/api/members/${normalizedCardCode}/notifications/read`, {
            method: "POST",
          });
          if (response.ok) {
            setNotifications(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })));
            setUnreadCount(0);
          }
        } catch (error) {
          console.error("Failed to mark notifications as read:", error);
        }
      })();
    }

    const cleanedParams = new URLSearchParams(searchParams.toString());
    cleanedParams.delete("fromPush");
    cleanedParams.delete("openBell");
    cleanedParams.delete("openTraining");
    cleanedParams.delete("openBirthday");
    cleanedParams.delete("pushOpenTs");
    const cleanedQuery = cleanedParams.toString();
    const cleanPath = `/member/${encodeURIComponent(normalizedCardCode)}`;
    router.replace(cleanedQuery ? `${cleanPath}?${cleanedQuery}` : cleanPath, { scroll: false });
  }, [normalizedCardCode, lastHandledPushOpenTs, router, searchParams, isAdmin, isCoach]);

  useEffect(() => {
    const checkAdminSession = async () => {
      try {
        const response = await fetch("/api/admin/check-session", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          setIsAdmin(false);
          setIsCoach(false);
          setViewerRoleChecked(true);
          return;
        }
        const payload = (await response.json()) as { isAdmin?: boolean; isCoach?: boolean };
        setIsAdmin(Boolean(payload.isAdmin));
        setIsCoach(Boolean(payload.isCoach));
        setViewerRoleChecked(true);
      } catch {
        setIsAdmin(false);
        setIsCoach(false);
        setViewerRoleChecked(true);
      }
    };

    void checkAdminSession();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ua = window.navigator.userAgent || "";
    setIsIPhoneDevice(/iPhone/i.test(ua));
    const standaloneByDisplayMode = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const standaloneByNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandaloneMode(standaloneByDisplayMode || standaloneByNavigator);
  }, []);

  useEffect(() => {
    const detectExistingPushSubscription = async () => {
      if (typeof window === "undefined") {
        return;
      }

      const supportsPush =
        window.isSecureContext &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!supportsPush) {
        setIsPushEnabled(false);
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const existingSubscription = await registration.pushManager.getSubscription();
        if (!existingSubscription) {
          setIsPushEnabled(false);
          return;
        }

        const search = new URLSearchParams({
          endpoint: existingSubscription.endpoint,
        });
        const response = await fetch(
          `/api/members/${encodeURIComponent(normalizedCardCode)}/push-subscriptions?${search.toString()}`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          setIsPushEnabled(false);
          return;
        }

        const payload = (await response.json()) as { isActive?: unknown };
        setIsPushEnabled(Boolean(payload.isActive));
      } catch (subscriptionError) {
        console.error("Detect push subscription error:", subscriptionError);
        setIsPushEnabled(false);
      }
    };

    void detectExistingPushSubscription();
  }, []);

  const handleEnablePushNotifications = async () => {
    setPushStatusMessage("");
    setPushStatusTone("success");
    setPushErrorMessage("");

    if (typeof window === "undefined") {
      return;
    }

    const supportsPush =
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!supportsPush) {
      setPushErrorMessage("Push is not supported on this device or HTTPS is missing.");
      return;
    }

    setIsEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushErrorMessage("Notification permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const keyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
      if (!keyResponse.ok) {
        const payload = await keyResponse.json().catch(() => ({}));
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Missing VAPID server configuration."
        );
      }

      const { publicKey } = (await keyResponse.json()) as { publicKey: string };

      const subscription = await getCompatiblePushSubscription(registration, publicKey);

      const saveResponse = await fetch(
        `/api/members/${encodeURIComponent(normalizedCardCode)}/push-subscriptions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        }
      );

      if (!saveResponse.ok) {
        const payload = await saveResponse.json().catch(() => ({}));
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Failed to enable push notifications."
        );
      }

      setIsPushEnabled(true);
      setPushStatusMessage("");
      setPushStatusTone("success");
    } catch (pushError) {
      console.error("Enable push error:", pushError);
      setPushErrorMessage(
        pushError instanceof Error ? pushError.message : "Unexpected push setup error."
      );
      setIsPushEnabled(false);
    } finally {
      setIsEnablingPush(false);
    }
  };

  const handleDisablePushNotifications = async () => {
    setPushStatusMessage("");
    setPushStatusTone("danger");
    setPushErrorMessage("");

    if (typeof window === "undefined") {
      return;
    }

    const supportsPush =
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!supportsPush) {
      setPushErrorMessage("Push is not supported on this device or HTTPS is missing.");
      return;
    }

    setIsEnablingPush(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const existingSubscription = await registration.pushManager.getSubscription();
      if (!existingSubscription) {
        setIsPushEnabled(false);
        setPushStatusMessage("Известията вече са изключени.");
        setPushStatusTone("danger");
        return;
      }

      const endpoint = existingSubscription.endpoint;

      const deleteResponse = await fetch(
        `/api/members/${encodeURIComponent(normalizedCardCode)}/push-subscriptions`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }
      );

      if (!deleteResponse.ok) {
        const payload = await deleteResponse.json().catch(() => ({}));
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Failed to disable push notifications."
        );
      }

      const deletePayload = (await deleteResponse.json().catch(() => ({}))) as {
        shouldUnsubscribeBrowser?: unknown;
      };

      if (deletePayload.shouldUnsubscribeBrowser !== false) {
        await existingSubscription.unsubscribe();
      }

      setIsPushEnabled(false);
      setPushStatusMessage("Известията са изключени.");
      setPushStatusTone("danger");
    } catch (pushError) {
      console.error("Disable push error:", pushError);
      setPushErrorMessage(
        pushError instanceof Error ? pushError.message : "Unexpected push disable error."
      );
    } finally {
      setIsEnablingPush(false);
    }
  };

  // Submit payment
  const handlePayment = async () => {
    if (!selectedYM || !member) return;
    const parsedTrainingCredits = Number(paymentTrainingCredits);
    if (isTrainingCreditBasedPayment && (!Number.isInteger(parsedTrainingCredits) || parsedTrainingCredits < 1)) {
      setPaymentError("Въведете брой тренировки по-голям от 0.");
      return;
    }
    if (hasActiveTrainingCreditsThirtyDayPayment) {
      setPaymentError("Плащане може да се отчете, когато тренировките станат 0 или 30-дневният срок изтече.");
      return;
    }
    setPaymentLoading(true);
    setPaymentError(null);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paidFor: isThirtyDayBasedPayment || isTrainingCreditBasedPayment ? new Date().toISOString() : toISOMonth(selectedYM),
          ...(isTrainingCreditBasedPayment ? { remainingTrainings: parsedTrainingCredits } : {}),
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Грешка при плащане");
      }
      const refreshed = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
      if (refreshed.ok) setMember(await refreshed.json());
      setSelectedPaymentDeleteMonths([]);
      setPaymentModalOpen(false);
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Възникна грешка");
    } finally {
      setPaymentLoading(false);
    }
  };

  const createIrisPaymentForSelection = async (targetYM: { year: number; month: number }) => {
    if (!member) return;
    if (hasActiveRollingPayment) {
      setPaymentError(`Остават ${rollingRemainingText}`);
      return;
    }
    if (hasActiveTrainingCreditsThirtyDayPayment) {
      setPaymentError("Онлайн плащане е достъпно, когато тренировките станат 0 или 30-дневният срок изтече.");
      return;
    }
    if (isTrainingCreditBasedPayment && Number(member.defaultOnlineTrainingCredits ?? 0) <= 0) {
      setPaymentError("Онлайн плащането за тренировки не е конфигурирано.");
      return;
    }

    const requestId = irisPaymentRequestIdRef.current + 1;
    irisPaymentRequestIdRef.current = requestId;
    setIrisPaymentLoading(true);
    setPaymentError(null);
    setIrisPayment(null);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}/irispay/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paidFor: isThirtyDayBasedPayment || isTrainingCreditBasedPayment ? new Date().toISOString() : toISOMonth(targetYM),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== irisPaymentRequestIdRef.current) return;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "Грешка при създаване на онлайн плащане",
        );
      }
      setIrisPayment(payload.payment as IrisOnlinePayment);
    } catch (e) {
      if (requestId !== irisPaymentRequestIdRef.current) return;
      setPaymentError(e instanceof Error ? e.message : "Възникна грешка");
    } finally {
      if (requestId === irisPaymentRequestIdRef.current) {
        setIrisPaymentLoading(false);
      }
    }
  };

  const handleIrisPayment = async () => {
    if (!selectedYM) return;
    await createIrisPaymentForSelection(selectedYM);
  };

  const handleIrisStatusCheck = async () => {
    if (!irisPayment) return;
    setIrisStatusLoading(true);
    setPaymentError(null);
    try {
      const response = await fetch(
        `/api/members/${normalizedCardCode}/irispay/payment/${encodeURIComponent(irisPayment.paymentHash)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "Грешка при проверка на плащането",
        );
      }
      const nextStatus = payload.status as IrisOnlinePayment["status"];
      setIrisPayment((prev) => prev ? { ...prev, status: nextStatus } : prev);
      if (nextStatus === "CONFIRMED") {
        const refreshed = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
        if (refreshed.ok) setMember(await refreshed.json());
      }
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Възникна грешка");
    } finally {
      setIrisStatusLoading(false);
    }
  };

  const handleTrainingCreditCheckIn = async () => {
    if (!member || trainingCreditLoading) return;
    setTrainingCreditLoading(true);
    setTrainingCreditError(null);
    setTrainingCreditSuccess(null);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}/training-credit/check-in`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "Грешка при чекиране на тренировка",
        );
      }
      const refreshed = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
      if (refreshed.ok) {
        setMember((await refreshed.json()) as MemberProfile);
      } else if (typeof payload?.remainingTrainingCredits === "number") {
        setMember((prev) => prev
          ? {
              ...prev,
              remainingTrainingCredits: payload.remainingTrainingCredits,
              status: payload.status === "paid" ? "paid" : "overdue",
            }
          : prev);
      }
      const remaining = typeof payload?.remainingTrainingCredits === "number"
        ? Math.max(0, payload.remainingTrainingCredits)
        : null;
      setTrainingCreditSuccess(
        remaining === null
          ? "Тренировката е отчетена успешно."
          : `Тренировката е отчетена. Остават ${remaining}.`,
      );
    } catch (e) {
      setTrainingCreditError(e instanceof Error ? e.message : "Възникна грешка");
    } finally {
      setTrainingCreditLoading(false);
    }
  };

  const handleDeletePayments = async () => {
    if (!member || selectedPaymentDeleteMonths.length === 0) return;
    setPaymentLoading(true);
    setPaymentError(null);
    try {
      const response = await fetch(`/api/members/${normalizedCardCode}/payment`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paidFor: selectedPaymentDeleteMonths.map((item) => toISOMonth(item)),
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          typeof err?.error === "string" && err.error.trim()
            ? err.error
            : "Грешка при изтриване на плащания",
        );
      }

      const refreshed = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
      if (refreshed.ok) {
        setMember((await refreshed.json()) as MemberProfile);
      }
      setSelectedPaymentDeleteMonths([]);
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : "Възникна грешка");
    } finally {
      setPaymentLoading(false);
    }
  };

  const togglePauseMonth = (ym: { year: number; month: number }) => {
    const key = `${ym.year}-${ym.month}`;
    setSelectedPauseMonths((prev) => {
      const exists = prev.some((item) => `${item.year}-${item.month}` === key);
      if (exists) {
        return prev.filter((item) => `${item.year}-${item.month}` !== key);
      }
      return [...prev, ym];
    });
  };

  const handleManagePauseMonths = async (mode: "pause" | "remove") => {
    if (!member || selectedPauseMonths.length === 0) {
      return;
    }

    setPauseActionLoading(true);
    setPauseError(null);
    try {
      const response = await fetch(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manage_pause_months",
          mode,
          reason: pauseReason.trim() || null,
          months: selectedPauseMonths.map((item) => toISOMonth(item)),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          typeof err?.error === "string" && err.error.trim()
            ? err.error
            : "Неуспешна промяна на пауза.",
        );
      }

      const refreshed = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
      if (refreshed.ok) {
        setMember((await refreshed.json()) as MemberProfile);
      }

      setSelectedPauseMonths([]);
      setPauseReason("");
      setPauseModalOpen(false);
    } catch (error) {
      setPauseError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setPauseActionLoading(false);
    }
  };

  const handleSavePublicEdit = async () => {
    if (!member || editSaving) return;

    const fullName = editForm.fullName.trim();
    if (!fullName) {
      setEditError("Името е задължително.");
      return;
    }

    const teamGroup =
      editForm.teamGroup.trim() === ""
        ? null
        : Number.parseInt(editForm.teamGroup.trim(), 10);
    if (teamGroup !== null && Number.isNaN(teamGroup)) {
      setEditError("Наборът трябва да е число.");
      return;
    }

    const parentPhone = editForm.parentPhone.trim() || null;
    const playerPhone = editForm.playerPhone.trim() || null;

    setEditSaving(true);
    setEditError("");
    try {
      let uploadedImagePath: string | null = null;
      if (editImageFile) {
        const uploaded = await uploadImage(
          editImageFile,
          "player",
          fullName || editImageFile.name,
        );
        uploadedImagePath = extractUploadPathFromCloudinaryUrl(uploaded.secure_url);
      }

      const response = await fetch(`/api/members/${normalizedCardCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          birthDate: editForm.birthDate.trim() || null,
          teamGroup,
          jerseyNumber: editForm.jerseyNumber.trim() || null,
          parentPhone,
          playerPhone,
          ...(uploadedImagePath ? { imageUrl: uploadedImagePath } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEditError(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Възникна грешка при редактиране.",
        );
        return;
      }

      const refreshed = await fetch(`/api/members/${normalizedCardCode}`, { cache: "no-store" });
      if (refreshed.ok) {
        setMember((await refreshed.json()) as MemberProfile);
      }
      setEditImageFile(null);
      setEditImagePreviewUrl("");
      setEditModalOpen(false);
    } catch (e) {
      console.error("Public member edit error:", e);
      setEditError("Възникна грешка при редактиране.");
    } finally {
      setEditSaving(false);
    }
  };

  const formatPaymentPeriod = (value: string) => {
    const start = new Date(value);
    if (isTrainingCreditsPayment) {
      return Number.isNaN(start.getTime()) ? value : `Плащане на ${start.toLocaleDateString("bg-BG")}`;
    }
    if (isTrainingCreditsThirtyDayPayment) {
      if (Number.isNaN(start.getTime())) return value;
      const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
      return `Тренировки: ${start.toLocaleDateString("bg-BG")} - ${end.toLocaleDateString("bg-BG")}`;
    }
    if (!isRollingThirtyDayPayment) return formatMonthYearInBgUtc(value);

    if (Number.isNaN(start.getTime())) return value;
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    return `${start.toLocaleDateString("bg-BG")} - ${end.toLocaleDateString("bg-BG")}`;
  };

  const formatReceiptPeriod = (value: string) => formatPaymentPeriod(value);

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const handlePrintReceipt = () => {
    if (!selectedReceipt || !member || typeof window === "undefined" || typeof document === "undefined") return;

    const period = formatReceiptPeriod(selectedReceipt.paidFor);
    const paidAt = new Date(selectedReceipt.paidAt).toLocaleDateString("bg-BG");
    const clubName = member.clubName?.trim() || "Клуб";
    const safeMemberName = escapeHtml(member.name);
    const safeClubName = escapeHtml(clubName);
    const safePeriod = escapeHtml(period);
    const safePaidAt = escapeHtml(paidAt);

    const receiptHtml = `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Разписка - ${safePeriod}</title>
  <style>
    body { margin: 0; background: #fff; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .pt { display: flex; gap: 8px; margin: 16px 20px; }
    .pt button { padding: 8px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; }
    .pt-p { background: #111827; color: #fff; border: none; }
    .pt-c { background: #f3f4f6; border: 1px solid #d1d5db; }
    .wrap { max-width: 420px; margin: 0 auto; padding: 20px; }
    .card { border-radius: 12px; border: 1px solid #e5e7eb; padding: 20px; }
    .head { text-align: center; margin-bottom: 10px; }
    .title { margin: 0; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; }
    .sub { margin: 4px 0 0; font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: .14em; }
    .sep { border: 0; border-top: 1px solid #e5e7eb; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; gap: 12px; margin: 10px 0; font-size: 14px; }
    .lbl { color: #6b7280; }
    .val { font-weight: 700; color: #111827; text-align: right; }
    .stamp-wrap { display: flex; justify-content: center; margin: 20px 0 8px; }
    .stamp { width: 96px; height: 96px; border-radius: 999px; border: 3px dashed rgba(50,205,50,.6); color: #26a826; font-size: 13px; font-weight: 900; letter-spacing: .05em; display: flex; align-items: center; justify-content: center; transform: rotate(-12deg); }
    @media print { .pt { display: none; } }
    @page { margin: 12mm; }
  </style>
</head>
<body>
  <div class="pt">
    <button class="pt-c" onclick="window.close()">✕ Затвори</button>
    <button class="pt-p" onclick="window.print()">🖨 Принтирай</button>
  </div>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <h1 class="title">${safeClubName}</h1>
        <p class="sub">Разписка за членски внос</p>
      </div>
      <hr class="sep" />
      <div class="row"><span class="lbl">Състезател:</span><span class="val">${safeMemberName}</span></div>
      <div class="row"><span class="lbl">Период:</span><span class="val">${safePeriod}</span></div>
      <div class="row"><span class="lbl">Дата на плащане:</span><span class="val">${safePaidAt}</span></div>
      <hr class="sep" />
      <div class="stamp-wrap"><div class="stamp">ПЛАТЕНО</div></div>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([receiptHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) { URL.revokeObjectURL(url); return; }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const rawStatusKey = member?.status ?? "paid";
  const statusKey = rawStatusKey === "paused" ? "warning" : rawStatusKey;
  const status = STATUS_MAP[statusKey];
  const lastPaymentText = member?.last_payment_date
    ? new Date(member.last_payment_date).toLocaleDateString("bg-BG")
    : "Няма плащане";
  const rollingRemainingText = rollingPaymentWindow && rollingPaymentWindow.remainingDays > 0
    ? `${rollingPaymentWindow.remainingDays} ${rollingPaymentWindow.remainingDays === 1 ? "ден" : "дни"}`
    : "Няма активни дни";
  const birthDateText = member?.birthDate
    ? new Date(member.birthDate).toLocaleDateString("bg-BG").replace(/\s*г\.\s*$/, "")
    : "-";
  const canManagePayments = isAdmin || isCoach;
  const canPublicEdit = !isAdmin && !isCoach;
  const canUseNotifications = !isAdmin && !isCoach;
  const isOptOutReasonReady =
    trainingConfirmAction !== "optOut"
      ? true
      : trainingOptOutReasonCode !== "" &&
      (trainingOptOutReasonCode !== "other" || trainingOptOutReasonText.trim().length > 0);

  const handleAdminLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setIsAdmin(false);
      setIsCoach(false);
      router.refresh();
      setIsLoggingOut(false);
    }
  };

  const handleTrainingAttendanceConfirm = async (
    action: "attend" | "optOut",
    item: TrainingDayStatus,
    reason?: {
      reasonCode: TrainingOptOutReasonCode;
      reasonText: string | null;
    },
  ) => {
    if (trainingSavingDate) {
      return;
    }
    setTrainingSavingDate(item.date);
    setTrainingError(null);
    try {
      const requestBody =
        action === "optOut"
          ? {
            trainingDate: item.date,
            reasonCode: reason?.reasonCode ?? "",
            reasonText: reason?.reasonText ?? "",
          }
          : { trainingDate: item.date };
      const response = await fetch(`/api/members/${normalizedCardCode}/training`, {
        method: action === "optOut" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (typeof payload?.error === "string" && payload.error.trim().length > 0) {
          throw new Error(payload.error.trim());
        }
        throw new Error(
          action === "optOut" ? "Неуспешно отказване на присъствие." : "Неуспешно потвърждаване на присъствие.",
        );
      }

      setTrainingDays((prev) =>
        prev.map((entry) =>
          entry.date === item.date
            ? {
              ...entry,
              optedOut: action === "optOut",
              optOutReasonCode: action === "optOut" ? reason?.reasonCode ?? null : null,
              optOutReasonText: action === "optOut" ? reason?.reasonText ?? null : null,
            }
            : entry,
        ),
      );
    } catch (error) {
      console.error("Failed to update training attendance:", error);
      setTrainingError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingSavingDate(null);
    }
  };

  if (loading) {
    return (
      <main className="page-bg">
        <div className="page-inner">
          <div className="card-shell">
            <div className="card-body">
              <p style={{ color: "rgba(255,255,255,0.7)", textAlign: "center" }}>Зареждане...</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error || !member) {
    return (
      <main className="page-bg">
        <div className="page-inner">
          <div className="card-shell">
            <div className="card-body" style={{ gap: "12px" }}>
              <p style={{ color: "#e03535", textAlign: "center", margin: 0 }}>{error ?? "Профилът не е намерен."}</p>
              <button className="add-btn" onClick={() => router.push(searchParams.get("coachGroupId") ? `/admin/members?coachGroupId=${encodeURIComponent(searchParams.get("coachGroupId")!)}` : "/admin/members")}>Назад</button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-bg">
      <div className="page-inner">
        {/* Top bar with back button and notification bell */}
        <div style={{
          display: "flex",
          justifyContent: isAdmin || isCoach ? "space-between" : "flex-end",
          alignItems: "center",
          marginBottom: "12px",
          gap: "12px"
        }}>
          {(isAdmin || isCoach) && (
            <button
              className="amp-back-btn"
              onClick={() => {
                const backCoachGroupId = searchParams.get("coachGroupId");
                const base = member.clubId
                  ? `/admin/members?clubId=${encodeURIComponent(member.clubId)}`
                  : "/admin/members";
                router.push(
                  backCoachGroupId
                    ? `${base}&coachGroupId=${encodeURIComponent(backCoachGroupId)}`
                    : base,
                );
              }}
            >
              <ArrowLeftIcon />
              Назад към състезатели
            </button>
          )}

          {(isAdmin || isCoach) && (
            <button
              type="button"
              className="member-logout-btn"
              onClick={() => void handleAdminLogout()}
              disabled={isLoggingOut}
              aria-label="Изход"
            >
              <LogoutIcon />
              {isLoggingOut ? "Излизане..." : "Изход"}
            </button>
          )}

          {/* Notification bell icon */}
          {canUseNotifications && <button
            onClick={handleNotificationsPanelOpen}
            style={{
              position: "relative",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "50%",
              width: "44px",
              height: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s ease",
              color: "#fff",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.15)";
              e.currentTarget.style.borderColor = "rgba(50,205,50,0.5)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
            }}
            aria-label="Известия"
          >
            <BellIcon size={20} />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute",
                top: "-4px",
                right: "-4px",
                background: "#ff3b3b",
                color: "#fff",
                borderRadius: "999px",
                padding: "2px 6px",
                fontSize: "10px",
                fontWeight: "700",
                minWidth: "18px",
                textAlign: "center",
                boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
              }}>
                {unreadCount}
              </span>
            )}
          </button>}
        </div>

        {/* Member card */}
        <div className="card-shell">
          <div className="speed-lines-layer" aria-hidden="true">
            {SPEED_LINES.map((left, i) => (
              <div key={i} className="speed-line" style={{
                left: `${left}%`,
                width: i % 3 === 0 ? "3px" : "2px",
                opacity: 0.06 + (i % 3) * 0.03,
                filter: `blur(${i % 2 === 0 ? 1 : 3}px)`,
              }} />
            ))}
            <div className="speed-line speed-line--wide" style={{ left: "18%" }} />
            <div className="speed-line speed-line--wide2" style={{ left: "70%" }} />
          </div>
          <div className="vignette" aria-hidden="true" />
          <div className="card-body">
            <div className="header">
              <div className="header-logo">
                {member.clubLogoUrl ? (
                  <img src={member.clubLogoUrl} alt={member.clubName ?? "Club logo"} className="header-logo-img" />
                ) : (
                  <span className="header-logo-fallback">🏆</span>
                )}
              </div>
              <div className="header-center">
                <h1 className="card-title">КЛУБНА КАРТА <span>2026</span></h1>
                <p className="card-subtitle">{member.clubName || "Клуб"}</p>
              </div>
              <div className="shield" style={!(member.jerseyNumber && Number.isFinite(Number(member.jerseyNumber))) ? { visibility: "hidden" } : undefined}>
                <svg viewBox="0 0 50 56" fill="none" className="shield-bg">
                  <path d="M25 2 L47 12 L47 35 Q47 50 25 54 Q3 50 3 35 L3 12 Z" fill="rgba(50,205,50,0.1)" stroke="#32cd32" strokeWidth="2.5" />
                </svg>
                <span className="shield-num">№{member.jerseyNumber}</span>
              </div>
            </div>
            <div className="divider" />

            <div className="central">
              <div className="photo-wrap">
                <div className="photo-inner">
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt={member.name}
                      className="photo-img"
                    />
                  ) : (
                    <span className="photo-letter">
                      {(member.name?.trim()?.charAt(0) || "?").toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <div className="divider divider--short" />
              <div className="info-rows">
                <div className="info-row">
                  <span className="info-lbl">Име:</span>
                  <span className="info-val">{member.name}</span>
                </div>
                <div className="info-row">
                  <span className="info-lbl">Роден:</span>
                  <span className="info-val">{birthDateText}</span>
                </div>
                <div className="info-row">
                  <span className="info-lbl">Спорт:</span>
                  <span className="info-val">{member.clubSports?.trim() || "-"}</span>
                </div>
                <div className="info-row">
                  <span className="info-lbl">Статус:</span>
                  <span className={`info-val ${status.cls}`}>
                    {rawStatusKey === "paused" ? "ПАУЗА" : status.label}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-lbl">Последно плащане:</span>
                  <span className="info-val">{lastPaymentText}</span>
                </div>
                {isRollingThirtyDayPayment && (
                  <div className="info-row">
                    <span className="info-lbl">Оставащи дни:</span>
                    <span className={`info-val ${hasActiveRollingPayment ? "green glow" : "red glow-red"}`}>
                      {rollingRemainingText}
                    </span>
                  </div>
                )}
                {isTrainingCreditBasedPayment && (
                  <div className="info-row">
                    <span className="info-lbl">Оставащи тренировки:</span>
                    <span className={`info-val ${remainingTrainingCredits > 0 ? "green glow" : "red glow-red"}`}>
                      {remainingTrainingCredits}
                    </span>
                  </div>
                )}
                {isTrainingCreditsThirtyDayPayment && (
                  <div className="info-row">
                    <span className="info-lbl">Оставащи дни:</span>
                    <span className={`info-val ${hasActiveTrainingCreditWindow ? "green glow" : "red glow-red"}`}>
                      {rollingRemainingText}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="divider divider--mt" />

            {/* ── Partner discount buttons ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
              {member.discounts && member.discounts.length > 0 && (
                  <div
                    className="sd-discount-btn"
                    onClick={() => { setActiveDiscount(member.discounts![0]); trackDiscount(member.discounts![0].name, "view"); }}
                    role="button"
                    tabIndex={0}
                    style={{ 
                      marginTop: 0,
                      "--theme-color-main": (member.discounts[0].themeColor || "#ff4d4d").startsWith("#") ? (member.discounts[0].themeColor || "#ff4d4d") : `#${member.discounts[0].themeColor || "ff4d4d"}`,
                      "--theme-color-shadow": `${(member.discounts[0].themeColor || "#ff4d4d").startsWith("#") ? (member.discounts[0].themeColor || "#ff4d4d") : `#${member.discounts[0].themeColor || "ff4d4d"}`}99`,
                      "--theme-color-border": `${(member.discounts[0].themeColor || "#ff4d4d").startsWith("#") ? (member.discounts[0].themeColor || "#ff4d4d") : `#${member.discounts[0].themeColor || "ff4d4d"}`}cc`
                    } as CSSProperties & Record<"--theme-color-main" | "--theme-color-shadow" | "--theme-color-border", string>}
                  >
                    <div className="sd-discount-logo-wrap">
                      <img src={member.discounts[0].logoUrl || "/placeholder.webp"} alt={member.discounts[0].name} className="sd-discount-logo" />
                    </div>
                    <span className="sd-discount-label">{member.discounts[0].name}</span>
                    {member.discounts[0].badgeText && (
                      <span
                        className="sd-discount-badge"
                        style={{
                          background: (member.discounts[0].themeColor || "#ff4d4d").startsWith("#") ? (member.discounts[0].themeColor || "#ff4d4d") : `#${member.discounts[0].themeColor || "ff4d4d"}`
                        }}
                      >
                        {/^-\d+%$/.test(member.discounts[0].badgeText) ? member.discounts[0].badgeText : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="16" x2="12" y2="12"/>
                            <line x1="12" y1="8" x2="12.01" y2="8"/>
                          </svg>
                        )}
                      </span>
                    )}
                  </div>
              )}

              {member.discounts && member.discounts.length > 1 && (
                <button
                  onClick={() => setAllDiscountsModalOpen(true)}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.8)",
                    padding: "12px",
                    borderRadius: "10px",
                    marginTop: "2px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                    e.currentTarget.style.transform = "scale(1.01)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                  type="button"
                >
                  Виж всички оферти ({member.discounts.length})
                </button>
              )}
            </div>
          </div>
        </div>

        {false && <div className="training-section">
          <div className="training-head">
            <h3 className="training-title">Легенда: Зелените дати са планирани тренировки, а червените са отбелязани отсъствия.</h3>
          </div>
          {canPublicEdit && (trainingLoading ? (
            <p className="training-empty">Зареждане...</p>
          ) : trainingDays.length === 0 && memberMatches.length === 0 ? (
            <p className="training-empty">Няма настроени тренировъчни дни.</p>
          ) : (
            <div className="training-calendar">
              {trainingMonths.map((month) => (
                <section key={month.key} className="training-calendar-month">
                  <h4 className="training-calendar-month-title">{month.label}</h4>
                  <div className="training-calendar-weekdays">
                    {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                      <span key={`${month.key}-${weekday}`} className="training-calendar-weekday">
                        {weekday}
                      </span>
                    ))}
                  </div>
                  <div className="training-calendar-grid">
                    {month.cells.map((cellDate, index) => {
                      if (!cellDate) {
                        return <span key={`${month.key}-empty-${index}`} className="training-calendar-cell training-calendar-cell--empty" aria-hidden="true" />;
                      }

                      const trainingItem = trainingByDate.get(cellDate);
                      const dayNumber = cellDate.slice(8, 10);
                      const isToday = cellDate === todayDateKey;
                      if (!trainingItem) {
                        return (
                          <span
                            key={cellDate}
                            className={`training-calendar-cell training-calendar-cell--off${isToday ? " training-calendar-cell--today" : ""}`}
                          >
                            <span className="training-calendar-day-number">{dayNumber}</span>
                          </span>
                        );
                      }

                      const isSaving = trainingSavingDate === trainingItem.date;
                      const trainingTimeLabel = trainingItem.trainingTime?.trim() ?? "";
                      const dateLabel = new Date(`${trainingItem.date}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                        day: "2-digit",
                        month: "2-digit",
                      });
                      return (
                        <button
                          key={cellDate}
                          className={`training-calendar-cell training-calendar-cell--training${trainingItem.optedOut ? " training-calendar-cell--opted-out" : ""}${isToday ? " training-calendar-cell--today" : ""}`}
                          onClick={() => {
                            setTrainingDetailsDate(trainingItem.date);
                            setTrainingDayPopupTab("training");
                            setTrainingAttendancePopupOpen(true);
                          }}
                          disabled={Boolean(trainingSavingDate)}
                          type="button"
                          aria-label={`${TRAINING_WEEKDAY_LABELS_BG[trainingItem.weekday] ?? "-"} ${dateLabel}${trainingTimeLabel ? ` ${trainingTimeLabel}` : ""}`}
                          aria-pressed={!trainingItem.optedOut}
                        >
                          <span className="training-calendar-day-number">{dayNumber}</span>
                          {trainingTimeLabel && (
                            <span className="training-calendar-time">{trainingTimeLabel}</span>
                          )}
                          {trainingItem.limitedEvent && !isSaving && (
                            <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, color: trainingItem.limitedEvent.isRegistered ? (trainingItem.limitedEvent.isConfirmed ? "#32cd32" : "#f0a030") : trainingItem.limitedEvent.spotsRemaining === 0 ? "#ff6b6b" : "#f0a030" }}>
                              {trainingItem.limitedEvent.isRegistered
                                ? trainingItem.limitedEvent.isConfirmed ? "✓" : `#${trainingItem.limitedEvent.waitlistPosition}`
                                : trainingItem.limitedEvent.spotsRemaining === 0 ? "Ч" : `${trainingItem.limitedEvent.spotsRemaining}м`}
                            </span>
                          )}
                          {!trainingItem.limitedEvent && (
                            <span className="training-calendar-mark">{isSaving ? "..." : trainingItem.optedOut ? "x" : "✓"}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ))}
          {trainingError && <p className="training-error">{trainingError}</p>}
        </div>}

        {/* Below card buttons */}
        <div className="below-card">
          {canManagePayments && (<>
            <>
              <button
                className="pay-btn"
                onClick={openPaymentModal}
                title={hasActiveRollingPayment ? `Остават ${rollingRemainingText}` : undefined}
              >
                Плати
              </button>
              {isTrainingCreditBasedPayment && (
                <button
                  className="add-btn member-action-btn training-credit-btn"
                  onClick={handleTrainingCreditCheckIn}
                  disabled={
                    trainingCreditLoading ||
                    remainingTrainingCredits <= 0 ||
                    (isTrainingCreditsThirtyDayPayment && !hasActiveTrainingCreditWindow)
                  }
                  title={
                    remainingTrainingCredits <= 0
                      ? "Няма оставащи тренировки"
                      : isTrainingCreditsThirtyDayPayment && !hasActiveTrainingCreditWindow
                        ? "30-дневният срок е изтекъл"
                        : undefined
                  }
                >
                  {trainingCreditLoading ? "Чекиране..." : "Чекирай тренировка"}
                </button>
              )}
              {!isRollingThirtyDayPayment && !isTrainingCreditBasedPayment && (
                <button
                  className="add-btn member-action-btn payment-delete-btn"
                  onClick={openPaymentDeleteModal}
                  disabled={(member.paymentLogs?.length ?? 0) === 0}
                >
                  Изтрий плащане
                </button>
              )}
            </>
            {!isRollingThirtyDayPayment && !isTrainingCreditBasedPayment && (
              <button
                className="add-btn member-action-btn pause-btn"
                onClick={() => {
                  setPauseError(null);
                  setSelectedPauseMonths([]);
                  setPauseReason("");
                  setCalendarYear(new Date().getFullYear());
                  setPauseModalOpen(true);
                }}
              >
                Архивирай
              </button>
            )}
            {trainingCreditError && (
              <p className="training-credit-error">{trainingCreditError}</p>
            )}
            {trainingCreditSuccess && (
              <p className="training-credit-success">{trainingCreditSuccess}</p>
            )}
          </>)}

          {member.onlinePaymentEnabled && (
            <button
              className="pay-btn"
              onClick={openPaymentModal}
              title={
                hasActiveRollingPayment
                  ? `Остават ${rollingRemainingText}`
                  : hasActiveTrainingCreditsThirtyDayPayment
                    ? `Остават ${remainingTrainingCredits} тренировки и ${rollingRemainingText}`
                    : undefined
              }
            >
              Плати онлайн
            </button>
          )}

          <button className="add-btn member-action-btn training-schedule-btn" onClick={() => void openTrainingModal()}>
            График
          </button>

          {(member.clubRulesDocuments?.length ?? 0) > 0 && (
            <button
              className="add-btn member-action-btn rules-btn"
              onClick={() => setRulesOpen(true)}
              type="button"
            >
              Правилници
            </button>
          )}

          {canPublicEdit && (trainingLoading ? (
            <p className="training-next-hint">Зареждане на следваща тренировка...</p>
          ) : nextScheduleEvent && nextScheduleCountdown ? (
            <div className={`training-next-card${nextScheduleEvent.type === "match" ? " training-next-card--match" : ""}`}>
              <p className="training-next-title">
                {nextScheduleEvent.type === "match" ? "Следващ мач" : "Следваща тренировка"}: {formatIsoDateForBgDisplay(nextScheduleEvent.date)}
                {nextScheduleEvent.time ? ` ${nextScheduleEvent.time}` : ""}
                {nextScheduleEvent.type === "match" && nextScheduleEvent.opponent ? ` срещу ${nextScheduleEvent.opponent}` : ""}
              </p>
              <p className={`training-next-countdown${nextScheduleEvent.type === "match" ? " training-next-countdown--match" : ""}`}>
                {`${String(nextScheduleCountdown.days).padStart(2, "0")}:${String(nextScheduleCountdown.hours).padStart(2, "0")}:${String(nextScheduleCountdown.minutes).padStart(2, "0")}:${String(nextScheduleCountdown.seconds).padStart(2, "0")}`}
              </p>
            </div>
          ) : (
            <p className="training-next-hint">Няма предстояща тренировка.</p>
          ))}

          {canPublicEdit && (
            <button
              className="add-btn member-edit-btn"
              onClick={() => {
                setEditError("");
                setEditImageFile(null);
                setEditModalOpen(true);
              }}
            >
              Редактирай профил
            </button>
          )}

          {canUseNotifications && isPushEnabled && (
            <div className="push-enabled-banner">
              <span className="push-enabled-check" aria-hidden="true">✓</span>
              <span className="push-enabled-text">Известията са активирани</span>
            </div>
          )}

          {canUseNotifications && (!isIPhoneDevice || isStandaloneMode) && (
            isPushEnabled ? (
              <button className="bell-btn bell-btn--disable" onClick={handleDisablePushNotifications} disabled={isEnablingPush}>
                {isEnablingPush ? <SpinnerIcon size={16} /> : <BellOffIcon size={16} />}
                {isEnablingPush ? "Изключване..." : "Изключване на известия"}
              </button>
            ) : (
              <button className="bell-btn" onClick={handleEnablePushNotifications} disabled={isEnablingPush}>
                {isEnablingPush ? <SpinnerIcon size={16} /> : <BellIcon size={16} />}
                {isEnablingPush ? "Активиране..." : "Активиране на известия"}
              </button>
            )
          )}

          {canUseNotifications && isIPhoneDevice && !isStandaloneMode && (
            <>
              <button className="add-btn add-btn--white-text" onClick={() => setInstructionsOpen((v) => !v)}>
                <ShareIcon size={16} />
                Добавете към начален екран
              </button>

              <p className="hint-text">
                За да активирате известията на iPhone, натиснете бутона Share и изберете &ldquo;Добавяне към начален екран&rdquo;.
              </p>

              {instructionsOpen && (
                <div className="instr-box">
                  <button className="instr-close" onClick={() => setInstructionsOpen(false)} aria-label="Затвори">
                    <XIcon />
                  </button>
                  <p className="instr-heading">Как да активирате известия на iPhone:</p>
                  <ol className="instr-list">
                    <li>
                      <span className="step-badge">1</span>
                      <span>Натиснете бутона <ShareIcon size={14} /> <strong>Share</strong> в долната лента на Safari</span>
                    </li>
                    <li>
                      <span className="step-badge">2</span>
                      <span>Превъртете надолу и изберете <PlusIcon /> <strong>&ldquo;Добавяне към начален екран&rdquo;</strong></span>
                    </li>
                    <li>
                      <span className="step-badge">3</span>
                      <span>Отворете приложението от началния екран и натиснете <strong>&ldquo;Активиране на известия&rdquo;</strong></span>
                    </li>
                  </ol>
                </div>
              )}
            </>
          )}
        </div>

        {canUseNotifications && !isPushEnabled && (
          <p className="push-hint">Получавайте push известия дори когато браузърът е затворен.</p>
        )}

        {canUseNotifications && pushStatusMessage && (
          <p className="push-hint" style={{ color: pushStatusTone === "danger" ? "#ff8f8f" : "#32cd32", marginTop: "6px" }}>
            {pushStatusMessage}
          </p>
        )}
        {canUseNotifications && pushErrorMessage && (
          <p className="push-hint" style={{ color: "#ff6b6b", marginTop: "6px" }}>
            {pushErrorMessage}
          </p>
        )}

        {/* Payment history accordion */}
        <div className="accordion" style={{ marginTop: "14px" }}>
          <button className="accordion-btn" onClick={() => setAccordionOpen((v) => !v)}>
            <span>История на плащания<span className="acc-count"> ({member.paymentLogs?.length ?? 0})</span></span>
            <svg className={`chevron${accordionOpen ? " open" : ""}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div className={`acc-body${accordionOpen ? " acc-body--open" : ""}`}>
            <div className="acc-inner">
              <div className="acc-scroll">
                <div className="payment-list">
                  {member.paymentLogs && member.paymentLogs.length > 0 ? (
                    member.paymentLogs.map((item) => (
                      <div className="payment-row" key={item.id}>
                        <div className="payment-info">
                          <p className="p-month">
                            {formatPaymentPeriod(item.paidFor)}
                          </p>
                          <p className="p-date">{new Date(item.paidAt).toLocaleDateString("bg-BG")}</p>
                        </div>
                        <button className="receipt-btn" onClick={() => setSelectedReceipt(item)}>
                          <FileTextIcon size={12} />
                          Разписка
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="payment-row">
                      <div className="payment-info">
                        <p className="p-month">Няма налична история.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Dynamic discount modal ── */}
        {activeDiscount && (
          <div className="pm-overlay sd-overlay" onClick={() => setActiveDiscount(null)}>
            <div
              className="sd-modal"
              onClick={(e) => e.stopPropagation()}
              style={{
                boxShadow: `0 20px 60px rgba(0, 0, 0, 0.8), 0 0 40px ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}26`,
                border: `1px solid ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}33`
              }}
            >
              <button className="pm-close sd-modal-close" onClick={() => setActiveDiscount(null)} aria-label="Затвори">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>

              {/* Header */}
              <div className="sd-modal-header">
                {activeDiscount.logoUrl && <img src={activeDiscount.logoUrl} alt={activeDiscount.name} className="sd-modal-logo" />}
                <div className="sd-modal-title-wrap">
                  <p className="sd-modal-eyebrow" style={{ color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}` }}>Партньорска програма</p>
                  <h2 className="sd-modal-title">{activeDiscount.name}</h2>
                  {activeDiscount.validUntil && (
                    <p style={{
                      fontSize: "12px",
                      color: "rgba(255,255,255,0.5)",
                      marginTop: "4px",
                      fontWeight: 500
                    }}>
                      Важи до: {new Date(activeDiscount.validUntil).toLocaleDateString("bg-BG")}
                    </p>
                  )}
                </div>
              </div>

              <div className="sd-modal-divider" />

              {/* Discount highlights */}
              {activeDiscount.badgeText && (
                <div className="sd-highlights">
                  <div className="sd-highlight" style={{
                    background: `${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}1a`,
                    border: `1px solid ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}33`
                  }}>
                    <span className="sd-highlight-value" style={{ color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}` }}>{activeDiscount.badgeText}</span>
                    {/^-\d+%$/.test(activeDiscount.badgeText ?? "") && (
                      <span className="sd-highlight-label" style={{ color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}` }}>отстъпка</span>
                    )}
                  </div>
                </div>
              )}

              {/* Code + validity — tap to copy */}
              {activeDiscount.code && (
                <button
                  className={`sd-code-row${activeDiscountCodeCopied ? " sd-code-row--copied" : ""}`}
                  type="button"
                  style={activeDiscountCodeCopied ? {
                    background: `${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}26`,
                    borderColor: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`,
                    color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`
                  } : {}}
                  onClick={() => {
                    void navigator.clipboard.writeText(activeDiscount.code!).then(() => {
                      setActiveDiscountCodeCopied(true);
                      trackDiscount(activeDiscount.name, "copy");
                      setTimeout(() => setActiveDiscountCodeCopied(false), 2000);
                    });
                  }}
                  aria-label={`Копирай код ${activeDiscount.code}`}
                >
                  <span className="sd-code-lbl" style={activeDiscountCodeCopied ? { color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}` } : {}}>{activeDiscountCodeCopied ? "Копирано!" : "Код:"}</span>
                  <span className="sd-code" style={{ color: activeDiscountCodeCopied ? ((activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`) : (activeDiscount.themeColor === "#ffffff" ? "#fff" : ((activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`)) }}>{activeDiscountCodeCopied ? "✓" : activeDiscount.code}</span>
                  {!activeDiscountCodeCopied && (
                    <svg className="sd-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}` }}>
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              )}

              {activeDiscount.storeUrl && (
                <div style={{ marginTop: "16px" }}>
                  <a
                    href={activeDiscount.storeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sd-store-link-btn"
                    onClick={() => trackDiscount(activeDiscount.name, "link_click")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      background: `linear-gradient(135deg, ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}33 0%, ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}1a 100%)`,
                      border: `1px solid ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}4d`,
                      color: (activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`,
                      padding: "14px",
                      borderRadius: "12px",
                      textDecoration: "none",
                      fontSize: "15px",
                      fontWeight: 700,
                      transition: "all 0.2s ease",
                      width: "100%",
                      boxSizing: "border-box",
                      boxShadow: "0 4px 15px rgba(0,0,0,0.1)"
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = `linear-gradient(135deg, ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}4d 0%, ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}33 100%)`;
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = `0 6px 20px ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}26`;
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = `linear-gradient(135deg, ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}33 0%, ${(activeDiscount.themeColor || "#ff4d4d").startsWith("#") ? (activeDiscount.themeColor || "#ff4d4d") : `#${activeDiscount.themeColor || "ff4d4d"}`}1a 100%)`;
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "0 4px 15px rgba(0,0,0,0.1)";
                    }}
                  >
                    Пазарувай онлайн
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              )}

              {activeDiscount.terms && activeDiscount.terms.length > 0 && (
                <>
                  <div className="sd-modal-divider" />
                  <div className="sd-terms">
                    <p className="sd-terms-title">Условия</p>
                    <ul className="sd-terms-list">
                      {activeDiscount.terms.map((term, i) => (
                        <li key={i}>{term}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Rules modal ── */}
        {rulesOpen && (
          <div className="pm-overlay" onClick={() => setRulesOpen(false)}>
            <div className="pm-modal rules-modal" onClick={(e) => e.stopPropagation()}>
              <button className="pm-close" onClick={() => setRulesOpen(false)} aria-label="Затвори">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
              <h2 className="rules-modal-title">Правилници</h2>
              <div className="rules-modal-list">
                {member.clubRulesDocuments!.map((doc) => (
                  <a
                    key={doc.id}
                    href={`/api/members/${normalizedCardCode}/rules/${doc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rules-modal-item"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>{doc.name}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── All Discounts modal ── */}
        {allDiscountsModalOpen && (
          <div className="pm-overlay sd-overlay" onClick={() => setAllDiscountsModalOpen(false)}>
            <div className="sd-modal" onClick={(e) => e.stopPropagation()} style={{ padding: "24px 20px" }}>
              <button className="pm-close sd-modal-close" onClick={() => setAllDiscountsModalOpen(false)} aria-label="Затвори">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>

              <div className="sd-modal-header" style={{ marginBottom: "16px" }}>
                <div className="sd-modal-title-wrap">
                  <p className="sd-modal-eyebrow" style={{ color: "rgb(201, 168, 76)" }}>Партньорска програма</p>
                  <h2 className="sd-modal-title">Всички оферти</h2>
                </div>
              </div>

              <div className="sd-modal-divider" style={{ background: "linear-gradient(to right, transparent, rgba(201, 168, 76, 0.5), transparent)" }} />

              <div style={{ display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto", maxHeight: "60vh", padding: "20px 30px 30px" }}>
                {member.discounts && member.discounts.map((discount, idx) => {
                  const fallbackColors = ["#ff4d4d", "#c9a84c", "#3498db", "#2ecc71", "#9b59b6", "#e67e22"];
                  const themeColor = (discount.themeColor || fallbackColors[idx % fallbackColors.length]).startsWith("#")
                    ? (discount.themeColor || fallbackColors[idx % fallbackColors.length])
                    : `#${discount.themeColor || fallbackColors[idx % fallbackColors.length]}`;

                  return (
                    <div
                      key={discount.id}
                      className="sd-discount-btn"
                      onClick={() => { setAllDiscountsModalOpen(false); setActiveDiscount(discount); trackDiscount(discount.name, "view"); }}
                      role="button"
                      tabIndex={0}
                      style={{
                        marginTop: 0,
                        "--theme-color-main": themeColor,
                        "--theme-color-shadow": `${themeColor}99`,
                        "--theme-color-border": `${themeColor}cc`
                      } as CSSProperties & Record<"--theme-color-main" | "--theme-color-shadow" | "--theme-color-border", string>}
                    >
                      <div className="sd-discount-logo-wrap">
                        <img src={discount.logoUrl || "/placeholder.webp"} alt={discount.name} className="sd-discount-logo" />
                      </div>
                      <span className="sd-discount-label">{discount.name}</span>
                      {discount.badgeText && (
                        <span
                          className="sd-discount-badge"
                          style={{
                            background: themeColor
                          }}
                        >
                          {/^-\d+%$/.test(discount.badgeText) ? discount.badgeText : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <line x1="12" y1="16" x2="12" y2="12"/>
                              <line x1="12" y1="8" x2="12.01" y2="8"/>
                            </svg>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {trainingModalOpen && (
          <div className="pm-overlay" onClick={closeTrainingModal}>
            <div className="pm-modal member-training-modal" onClick={(e) => e.stopPropagation()}>
              <div className="member-training-modal-tint" aria-hidden="true" />
              <button className="pm-close" onClick={closeTrainingModal}>
                <XIcon size={16} />
              </button>

              <div className="pm-header">
                <span className="member-training-modal-title-gradient">Тренировки</span>
                <div>
                  <h2 className="pm-title">Текущ график</h2>
                </div>
              </div>

              <div className="pm-divider" />

              <div className="training-section" style={{ margin: 0 }}>
                {trainingLoading ? (
                  <p className="training-empty">Зареждане...</p>
                ) : trainingDays.length === 0 && memberMatches.length === 0 ? (
                  <p className="training-empty">Няма настроени тренировъчни дни.</p>
                ) : (
                  <>
                    <div className="training-layout">
                      <div className="training-calendar">
                        <div className="training-calendar-month-nav">
                          <button
                            type="button"
                            className="training-calendar-month-nav-btn"
                            onClick={() => setTrainingCalendarMonth((current) => addMonths(current, -1))}
                            aria-label="Предишен месец"
                          >
                            ‹
                          </button>
                          <span className="training-calendar-month-nav-title">
                            {trainingMonths[0]?.label ?? ""}
                          </span>
                          <button
                            type="button"
                            className="training-calendar-month-nav-btn"
                            onClick={() => setTrainingCalendarMonth((current) => addMonths(current, 1))}
                            aria-label="Следващ месец"
                          >
                            ›
                          </button>
                        </div>
                        {trainingMonths.map((month) => (
                          <section key={month.key} className="training-calendar-month">
                            <h4 className="training-calendar-month-title">{month.label}</h4>
                            <div className="training-calendar-weekdays">
                              {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                                <span key={`${month.key}-${weekday}`} className="training-calendar-weekday">
                                  {weekday}
                                </span>
                              ))}
                            </div>
                            <div className="training-calendar-grid">
                              {month.cells.map((cellDate, index) => {
                                if (!cellDate) {
                                  return <span key={`${month.key}-empty-${index}`} className="training-calendar-cell training-calendar-cell--empty" aria-hidden="true" />;
                                }

                                const trainingItem = trainingByDate.get(cellDate);
                                const dayMatches = matchesByDate.get(cellDate) ?? [];
                                const hasMatch = dayMatches.length > 0;
                                const dayNumber = cellDate.slice(8, 10);
                                const isToday = cellDate === todayDateKey;
                                if (!trainingItem && !hasMatch) {
                                  return (
                                    <span
                                      key={cellDate}
                                      className={`training-calendar-cell training-calendar-cell--off${isToday ? " training-calendar-cell--today" : ""}`}
                                    >
                                      <span className="training-calendar-day-number">{dayNumber}</span>
                                    </span>
                                  );
                                }
                                if (!trainingItem && hasMatch) {
                                  return (
                                    <button
                                      key={cellDate}
                                      type="button"
                                      className={`training-calendar-cell training-calendar-cell--match${isToday ? " training-calendar-cell--today" : ""}`}
                                      onClick={() => {
                                        setMatchDetailsMatch(dayMatches[0]!);
                                        setMatchDetailsPopupOpen(true);
                                      }}
                                      aria-label={`Мач: ${dayMatches[0]!.opponent}, ${new Date(`${cellDate}T12:00:00.000Z`).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit" })}`}
                                    >
                                      <span className="training-calendar-day-number">{dayNumber}</span>
                                      <span className="training-calendar-time">{dayMatches[0]!.matchTime}</span>
                                    </button>
                                  );
                                }

                                const isOptedOut = trainingItem!.optedOut;
                                const trainingTimeLabel = trainingItem!.trainingTime?.trim() ?? "";
                                const multiSession = (trainingItem!.sessions?.length ?? 1) > 1;
                                const dateLabel = new Date(`${trainingItem!.date}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                                  day: "2-digit",
                                  month: "2-digit",
                                });
                                // Priority limited event for badge: confirmed > waitlisted > available > full
                                const allLimitedSessions = trainingItem!.sessions?.filter((s) => s.limitedEvent) ?? [];
                                const displayLimitedEvent =
                                  allLimitedSessions.find((s) => s.limitedEvent?.isConfirmed)?.limitedEvent ??
                                  allLimitedSessions.find((s) => s.limitedEvent?.isRegistered)?.limitedEvent ??
                                  allLimitedSessions.find((s) => (s.limitedEvent?.spotsRemaining ?? 0) > 0)?.limitedEvent ??
                                  allLimitedSessions[0]?.limitedEvent ??
                                  trainingItem!.limitedEvent ??
                                  null;
                                const isSaving = trainingSavingDate === trainingItem!.date;
                                return (
                                  <button
                                    key={cellDate}
                                    className={`training-calendar-cell training-calendar-cell--training${isOptedOut ? " training-calendar-cell--opted-out" : ""}${isToday ? " training-calendar-cell--today" : ""}${hasMatch ? " training-calendar-cell--has-match" : ""}`}
                                    onClick={() => {
                                      setTrainingDetailsDate(trainingItem!.date);
                                      setTrainingDayPopupTab("training");
                                      setTrainingAttendancePopupOpen(true);
                                    }}
                                    disabled={Boolean(trainingSavingDate)}
                                    type="button"
                                    aria-label={`${TRAINING_WEEKDAY_LABELS_BG[trainingItem!.weekday] ?? "-"} ${dateLabel}${trainingTimeLabel ? ` ${trainingTimeLabel}` : ""}${multiSession ? " (няколко тренировки)" : ""}`}
                                    aria-pressed={!isOptedOut}
                                  >
                                    <span className="training-calendar-day-number">{dayNumber}</span>
                                    {trainingTimeLabel && (
                                      <span className="training-calendar-time">{trainingTimeLabel}{multiSession ? "+" : ""}</span>
                                    )}
                                    {displayLimitedEvent && !isSaving ? (
                                      <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, color: displayLimitedEvent.isRegistered ? (displayLimitedEvent.isConfirmed ? "#32cd32" : "#f0a030") : displayLimitedEvent.spotsRemaining === 0 ? "#ff6b6b" : "#f0a030" }}>
                                        {displayLimitedEvent.isRegistered
                                          ? displayLimitedEvent.isConfirmed ? "✓" : `#${displayLimitedEvent.waitlistPosition}`
                                          : displayLimitedEvent.spotsRemaining === 0 ? "Ч" : `${displayLimitedEvent.spotsRemaining}м`}
                                      </span>
                                    ) : (
                                      <span className="training-calendar-mark">{isSaving ? "..." : isOptedOut ? "x" : "✓"}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {trainingError && <p className="training-error">{trainingError}</p>}
                {trainingAttendancePopupOpen && trainingDetailsItem && (
                  <div
                    className="pm-overlay"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTrainingAttendancePopupOpen(false);
                    }}
                  >
                    <div className="pm-modal member-training-attendance-popup" onClick={(e) => e.stopPropagation()}>
                      <button className="pm-close" onClick={() => setTrainingAttendancePopupOpen(false)}>
                        <XIcon size={16} />
                      </button>
                      <div className="pm-header">
                        <h2 className="pm-title">{trainingDetailsMatches.length > 0 ? "Детайли за деня" : "Присъствие"}</h2>
                      </div>
                      <div className="pm-divider" />
                      {trainingDetailsMatches.length > 0 && (
                        <div className="member-day-tabs" aria-label="Детайли за деня">
                          <button
                            type="button"
                            className={`member-day-tab${trainingDayPopupTab === "training" ? " member-day-tab--active" : ""}`}
                            onClick={() => setTrainingDayPopupTab("training")}
                          >
                            Тренировка
                          </button>
                          <button
                            type="button"
                            className={`member-day-tab member-day-tab--match${trainingDayPopupTab === "match" ? " member-day-tab--active" : ""}`}
                            onClick={() => setTrainingDayPopupTab("match")}
                          >
                            Мач
                          </button>
                        </div>
                      )}
                      {trainingDayPopupTab === "training" ? (
                        trainingDetailsItem.sessions.some((s) => s.id) ? (
                          <MemberTrainingSessions key={trainingDetailsItem.date} date={trainingDetailsItem.date} sessions={trainingDetailsItem.sessions} cardCode={normalizedCardCode} onUpdated={fetchTrainingDays} />
                        ) : (
                        <>
                          <div className="training-attendance-info-card">
                            <div className="training-attendance-info-row">
                              <span className="training-attendance-info-label">Дата</span>
                              <span className="training-attendance-info-value">
                                {new Date(`${trainingDetailsItem.date}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                                  weekday: "long",
                                  day: "2-digit",
                                  month: "long",
                                })}
                              </span>
                            </div>
                            {trainingDetailsItem.sessions.length === 1 && (
                              <>
                                {trainingDetailsItem.trainingTime?.trim() && (
                                  <div className="training-attendance-info-row">
                                    <span className="training-attendance-info-label">Час</span>
                                    <span className="training-attendance-info-value">{trainingDetailsItem.trainingTime}</span>
                                  </div>
                                )}
                                {formatTrainingDuration(trainingDetailsItem.trainingDurationMinutes) && (
                                  <div className="training-attendance-info-row">
                                    <span className="training-attendance-info-label">Продължителност</span>
                                    <span className="training-attendance-info-value">{formatTrainingDuration(trainingDetailsItem.trainingDurationMinutes)}</span>
                                  </div>
                                )}
                                {trainingDetailsItem.trainingFieldName && (() => {
                                  const pieces = trainingDetailsItem.trainingFieldPieces?.length
                                    ? trainingDetailsItem.trainingFieldPieces
                                    : trainingDetailsItem.trainingFieldPieceNames?.length
                                      ? trainingDetailsItem.trainingFieldPieceNames
                                      : ["Цял терен"];
                                  const selectedPieces = trainingDetailsItem.trainingFieldPieceNames ?? [];
                                  const isWholeFieldSelected = selectedPieces.length === 0;
                                  const fieldType = normalizeTrainingFieldType(trainingDetailsItem.trainingFieldType, member?.clubSports);
                                  return (
                                    <div className="member-training-field-visual">
                                      <div className={`member-training-field-name${isWholeFieldSelected ? " member-training-field-name--selected" : ""}`}>
                                        {trainingDetailsItem.trainingFieldName}
                                      </div>
                                      <div
                                        className={`member-training-field-pitch member-training-field-pitch--${fieldType}`}
                                        style={{ gridTemplateColumns: `repeat(${pieces.length}, minmax(0, 1fr))` }}
                                        aria-label={`Терен ${trainingDetailsItem.trainingFieldName}`}
                                      >
                                        {pieces.map((piece, index) => {
                                          const isSelected = isWholeFieldSelected || selectedPieces.includes(piece);
                                          return (
                                            <div key={`${piece}-${index}`} className={`member-training-field-piece${isSelected ? " member-training-field-piece--selected" : ""}`}>
                                              {piece}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </>
                            )}
                          </div>
                          {trainingDetailsItem.sessions.length > 1 && trainingDetailsItem.sessions.map((session, sessionIndex) => (
                            <div key={session.scopeKey || sessionIndex} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.75)", marginBottom: session.trainingTime || session.trainingDurationMinutes || session.trainingFieldName ? 8 : 0 }}>
                                Тренировка {sessionIndex + 1}{session.trainingTime ? ` — ${session.trainingTime}` : ""}
                              </div>
                              {formatTrainingDuration(session.trainingDurationMinutes) && (
                                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                                  {formatTrainingDuration(session.trainingDurationMinutes)}
                                </div>
                              )}
                              {session.trainingFieldName && (() => {
                                const pieces = session.trainingFieldPieces?.length
                                  ? session.trainingFieldPieces
                                  : session.trainingFieldPieceNames?.length
                                    ? session.trainingFieldPieceNames
                                    : ["Цял терен"];
                                const selectedPieces = session.trainingFieldPieceNames ?? [];
                                const isWholeFieldSelected = selectedPieces.length === 0;
                                const fieldType = normalizeTrainingFieldType(session.trainingFieldType, member?.clubSports);
                                return (
                                  <div className="member-training-field-visual" style={{ marginBottom: 8 }}>
                                    <div className={`member-training-field-name${isWholeFieldSelected ? " member-training-field-name--selected" : ""}`}>
                                      {session.trainingFieldName}
                                    </div>
                                    <div
                                      className={`member-training-field-pitch member-training-field-pitch--${fieldType}`}
                                      style={{ gridTemplateColumns: `repeat(${pieces.length}, minmax(0, 1fr))` }}
                                    >
                                      {pieces.map((piece, pieceIndex) => {
                                        const isSelected = isWholeFieldSelected || selectedPieces.includes(piece);
                                        return (
                                          <div key={`${piece}-${pieceIndex}`} className={`member-training-field-piece${isSelected ? " member-training-field-piece--selected" : ""}`}>
                                            {piece}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                              {session.limitedEvent ? (() => {
                                const le = session.limitedEvent!;
                                return (
                                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                                    {registerError && registerSavingEventId === le.id && (
                                      <p style={{ fontSize: 12, color: "#ff6b6b", margin: 0 }}>{registerError}</p>
                                    )}
                                    {le.isRegistered ? (
                                      <>
                                        {le.isConfirmed ? (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#32cd32" }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                              <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                            Записан
                                          </div>
                                        ) : (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#f0a030" }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                                            </svg>
                                            В чакалня ({le.waitlistPosition === 1 ? "следващ" : `#${le.waitlistPosition}`})
                                          </div>
                                        )}
                                        <button
                                          className="pm-btn training-optout-btn"
                                          type="button"
                                          disabled={registerSavingEventId !== null}
                                          onClick={async () => {
                                            setRegisterSavingEventId(le.id);
                                            setRegisterError(null);
                                            try {
                                              const res = await fetch(`/api/members/${normalizedCardCode}/training/register`, {
                                                method: "DELETE",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ trainingDate: trainingDetailsItem.date, limitedEventId: le.id }),
                                              });
                                              if (!res.ok) {
                                                const d = await res.json().catch(() => ({})) as { error?: string };
                                                setRegisterError(typeof d.error === "string" ? d.error : "Грешка при отказване.");
                                                return;
                                              }
                                              await fetchTrainingDays();
                                            } catch {
                                              setRegisterError("Грешка при отказване.");
                                            } finally {
                                              setRegisterSavingEventId(null);
                                            }
                                          }}
                                        >
                                          {registerSavingEventId === le.id ? "Запазване..." : le.isConfirmed ? "Откажи записването" : "Откажи чакалнята"}
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        className="pm-btn training-attend-btn"
                                        type="button"
                                        disabled={registerSavingEventId !== null}
                                        onClick={async () => {
                                          setRegisterSavingEventId(le.id);
                                          setRegisterError(null);
                                          try {
                                            const res = await fetch(`/api/members/${normalizedCardCode}/training/register`, {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ trainingDate: trainingDetailsItem.date, limitedEventId: le.id }),
                                            });
                                            if (!res.ok) {
                                              const d = await res.json().catch(() => ({})) as { error?: string };
                                              setRegisterError(typeof d.error === "string" ? d.error : "Грешка при записване.");
                                              return;
                                            }
                                            await fetchTrainingDays();
                                          } catch {
                                            setRegisterError("Грешка при записване.");
                                          } finally {
                                            setRegisterSavingEventId(null);
                                          }
                                        }}
                                      >
                                        {registerSavingEventId === le.id ? "Запазване..." : le.spotsRemaining > 0 ? `Запиши се (${le.spotsRemaining} ${le.spotsRemaining === 1 ? "място" : "места"})` : "Запиши се в чакалнята"}
                                      </button>
                                    )}
                                  </div>
                                );
                              })() : (
                                <div className="training-attendance-buttons" style={{ marginTop: 8 }}>
                                  <button
                                    className={`pm-btn training-attend-btn${!trainingDetailsItem.optedOut ? " training-btn-selected" : ""}`}
                                    type="button"
                                    onClick={() => {
                                      if (!trainingDetailsItem.optedOut) return;
                                      setTrainingOptOutReasonCode("");
                                      setTrainingOptOutReasonText("");
                                      setTrainingConfirmAction("attend");
                                      setTrainingConfirmModalOpen(true);
                                    }}
                                    disabled={!trainingDetailsItem.optedOut || trainingSavingDate === trainingDetailsItem.date}
                                  >
                                    {!trainingDetailsItem.optedOut && trainingSavingDate !== trainingDetailsItem.date && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                    {trainingSavingDate === trainingDetailsItem.date ? "Запазване..." : "Присъствам"}
                                  </button>
                                  <button
                                    className={`pm-btn training-optout-btn${trainingDetailsItem.optedOut ? " training-btn-selected" : ""}`}
                                    type="button"
                                    onClick={() => {
                                      if (trainingDetailsItem.optedOut) return;
                                      setTrainingOptOutReasonCode("");
                                      setTrainingOptOutReasonText("");
                                      setTrainingConfirmAction("optOut");
                                      setTrainingConfirmModalOpen(true);
                                    }}
                                    disabled={trainingDetailsItem.optedOut || trainingSavingDate === trainingDetailsItem.date}
                                  >
                                    {trainingDetailsItem.optedOut && trainingSavingDate !== trainingDetailsItem.date && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                    {trainingSavingDate === trainingDetailsItem.date ? "Запазване..." : "Отсъствам"}
                                  </button>
                                </div>
                              )}
                              {session.note?.trim() && (
                                <div className="training-attendance-note-card" style={{ marginTop: 8 }}>
                                  <p className="training-attendance-note-label">Описание</p>
                                  <p className="training-attendance-note-text">{session.note}</p>
                                </div>
                              )}
                            </div>
                          ))}
                          {trainingDetailsItem.sessions.length === 1 && trainingDetailsItem.note?.trim() && (
                            <div className="training-attendance-note-card">
                              <p className="training-attendance-note-label">Описание</p>
                              <p className="training-attendance-note-text">{trainingDetailsItem.note}</p>
                            </div>
                          )}
                          {trainingDetailsItem.sessions.length === 1 ? (
                            <>
                              <p className="training-attendance-choice-label">Заявка</p>
                              {trainingDetailsItem.limitedEvent ? (
                                <div className="training-attendance-buttons" style={{ flexDirection: "column", gap: 10 }}>
                                  {registerError && registerSavingEventId === trainingDetailsItem.limitedEvent.id && (
                                    <p style={{ fontSize: 13, color: "#ff6b6b", margin: 0 }}>{registerError}</p>
                                  )}
                                  {trainingDetailsItem.limitedEvent.isRegistered ? (
                                    <>
                                      {trainingDetailsItem.limitedEvent.isConfirmed ? (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: "#32cd32" }}>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                          </svg>
                                          Записан
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: "#f0a030" }}>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                                          </svg>
                                          В чакалня ({trainingDetailsItem.limitedEvent.waitlistPosition === 1 ? "следващ" : `#${trainingDetailsItem.limitedEvent.waitlistPosition}`})
                                        </div>
                                      )}
                                      <button
                                        className="pm-btn training-optout-btn"
                                        type="button"
                                        disabled={registerSavingEventId !== null}
                                        onClick={async () => {
                                          const le = trainingDetailsItem.limitedEvent;
                                          if (!le) return;
                                          setRegisterSavingEventId(le.id);
                                          setRegisterError(null);
                                          try {
                                            const res = await fetch(`/api/members/${normalizedCardCode}/training/register`, {
                                              method: "DELETE",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ trainingDate: trainingDetailsItem.date, limitedEventId: le.id }),
                                            });
                                            if (!res.ok) {
                                              const d = await res.json().catch(() => ({})) as { error?: string };
                                              setRegisterError(typeof d.error === "string" ? d.error : "Грешка при отказване.");
                                              return;
                                            }
                                            await fetchTrainingDays();
                                          } catch {
                                            setRegisterError("Грешка при отказване.");
                                          } finally {
                                            setRegisterSavingEventId(null);
                                          }
                                        }}
                                      >
                                        {registerSavingEventId === trainingDetailsItem.limitedEvent.id ? "Запазване..." : trainingDetailsItem.limitedEvent.isConfirmed ? "Откажи записването" : "Откажи чакалнята"}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="pm-btn training-attend-btn"
                                      type="button"
                                      disabled={registerSavingEventId !== null}
                                      onClick={async () => {
                                        const le = trainingDetailsItem.limitedEvent;
                                        if (!le) return;
                                        setRegisterSavingEventId(le.id);
                                        setRegisterError(null);
                                        try {
                                          const res = await fetch(`/api/members/${normalizedCardCode}/training/register`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ trainingDate: trainingDetailsItem.date, limitedEventId: le.id }),
                                          });
                                          if (!res.ok) {
                                            const d = await res.json().catch(() => ({})) as { error?: string };
                                            setRegisterError(typeof d.error === "string" ? d.error : "Грешка при записване.");
                                            return;
                                          }
                                          await fetchTrainingDays();
                                        } catch {
                                          setRegisterError("Грешка при записване.");
                                        } finally {
                                          setRegisterSavingEventId(null);
                                        }
                                      }}
                                    >
                                      {registerSavingEventId === trainingDetailsItem.limitedEvent.id
                                        ? "Запазване..."
                                        : trainingDetailsItem.limitedEvent.spotsRemaining > 0
                                          ? `Запиши се (${trainingDetailsItem.limitedEvent.spotsRemaining} ${trainingDetailsItem.limitedEvent.spotsRemaining === 1 ? "място" : "места"})`
                                          : "Запиши се в чакалнята"}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="training-attendance-buttons">
                                  <button
                                    className={`pm-btn training-attend-btn${!trainingDetailsItem.optedOut ? " training-btn-selected" : ""}`}
                                    type="button"
                                    onClick={() => {
                                      if (!trainingDetailsItem.optedOut) return;
                                      setTrainingOptOutReasonCode("");
                                      setTrainingOptOutReasonText("");
                                      setTrainingConfirmAction("attend");
                                      setTrainingConfirmModalOpen(true);
                                    }}
                                    disabled={!trainingDetailsItem.optedOut || trainingSavingDate === trainingDetailsItem.date}
                                  >
                                    {!trainingDetailsItem.optedOut && trainingSavingDate !== trainingDetailsItem.date && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                    {trainingSavingDate === trainingDetailsItem.date ? "Запазване..." : "Присъствам"}
                                  </button>
                                  <button
                                    className={`pm-btn training-optout-btn${trainingDetailsItem.optedOut ? " training-btn-selected" : ""}`}
                                    type="button"
                                    onClick={() => {
                                      if (trainingDetailsItem.optedOut) return;
                                      setTrainingOptOutReasonCode("");
                                      setTrainingOptOutReasonText("");
                                      setTrainingConfirmAction("optOut");
                                      setTrainingConfirmModalOpen(true);
                                    }}
                                    disabled={trainingDetailsItem.optedOut || trainingSavingDate === trainingDetailsItem.date}
                                  >
                                    {trainingDetailsItem.optedOut && trainingSavingDate !== trainingDetailsItem.date && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                    {trainingSavingDate === trainingDetailsItem.date ? "Запазване..." : "Отсъствам"}
                                  </button>
                                </div>
                              )}
                            </>
                          ) : null}
                        </>
                        )
                      ) : (
                        <div className="member-day-match-panel">
                          {trainingDetailsMatches.map((match) => (
                            <div key={match.id} className="member-day-match-card">
                              <div className="member-day-match-card-header">
                                <span className="member-day-match-opponent">{match.opponent}</span>
                                <span className={`match-details-badge${match.isHome ? " match-details-badge--home" : " match-details-badge--away"}`}>
                                  {match.isHome ? "Домакин" : "Гост"}
                                </span>
                              </div>
                              <div className="match-details-body">
                                <div className="match-details-row">
                                  <span className="match-details-label">Дата</span>
                                  <span className="match-details-value">
                                    {new Date(`${match.matchDate}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                                      weekday: "long",
                                      day: "2-digit",
                                      month: "long",
                                    })}
                                  </span>
                                </div>
                                <div className="match-details-row">
                                  <span className="match-details-label">Час</span>
                                  <span className="match-details-value">{match.matchTime}</span>
                                </div>
                                <div className="match-details-row">
                                  <span className="match-details-label">Място</span>
                                  <span className="match-details-value">{match.location}</span>
                                </div>
                                {match.durationMinutes && (
                                  <div className="match-details-row">
                                    <span className="match-details-label">Продължителност</span>
                                    <span className="match-details-value">{match.durationMinutes} мин</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {false && (
                  <div className="training-notes">
                    <p className="training-notes-title">Описание</p>
                    <div className="training-notes-list">
                      {trainingDaysWithNotes.map((item) => (
                        <div key={`note-${item.date}`} className="training-note-row">
                          <span className="training-note-date">
                            {new Date(`${item.date}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                          <span className="training-note-text">{item.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {matchDetailsPopupOpen && matchDetailsMatch && (
          <div
            className="pm-overlay"
            onClick={() => setMatchDetailsPopupOpen(false)}
          >
            <div className="pm-modal member-match-details-popup" onClick={(e) => e.stopPropagation()}>
              <button className="pm-close" onClick={() => setMatchDetailsPopupOpen(false)}>
                <XIcon size={16} />
              </button>
              <div className="pm-header">
                <h2 className="pm-title">Мач</h2>
              </div>
              <p className="match-details-date">
                {new Date(`${matchDetailsMatch.matchDate}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <div className="match-details-body">
                <div className="match-details-row">
                  <span className="match-details-label">Противник</span>
                  <span className="match-details-value">{matchDetailsMatch.opponent}</span>
                </div>
                <div className="match-details-row">
                  <span className="match-details-label">Час</span>
                  <span className="match-details-value">{matchDetailsMatch.matchTime}</span>
                </div>
                <div className="match-details-row">
                  <span className="match-details-label">Място</span>
                  <span className="match-details-value">{matchDetailsMatch.location}</span>
                </div>
                <div className="match-details-row">
                  <span className="match-details-label">Домакин/Гост</span>
                  <span className={`match-details-badge${matchDetailsMatch.isHome ? " match-details-badge--home" : " match-details-badge--away"}`}>
                    {matchDetailsMatch.isHome ? "Домакин" : "Гост"}
                  </span>
                </div>
                {matchDetailsMatch.durationMinutes && (
                  <div className="match-details-row">
                    <span className="match-details-label">Продължителност</span>
                    <span className="match-details-value">{matchDetailsMatch.durationMinutes} мин</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {trainingConfirmModalOpen && trainingConfirmAction && trainingDetailsItem && (
          <div
            className="pm-overlay"
            onClick={(e) => {
              e.stopPropagation();
              setTrainingConfirmModalOpen(false);
              setTrainingConfirmAction(null);
              setTrainingOptOutReasonCode("");
              setTrainingOptOutReasonText("");
            }}
          >
            <div className="pm-modal member-training-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <div className="pm-header">
                <h2 className="pm-title">Потвърждение</h2>
              </div>
              <div className="pm-divider" />
              <p className="training-confirm-text">
                {trainingConfirmAction === "attend"
                  ? `Сигурни ли сте, че искате да потвърдите присъствие за ${new Date(`${trainingDetailsItem.date}T12:00:00.000Z`).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })}?`
                  : `Сигурни ли сте, че искате да откажете присъствие за ${new Date(`${trainingDetailsItem.date}T12:00:00.000Z`).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })}?`}
              </p>
              {trainingConfirmAction === "optOut" && (
                <div className="training-confirm-reason-fields">
                  <label className="training-confirm-reason-label">
                    <span className="pm-info-lbl">Причина (задължително)</span>
                    <select
                      className="training-confirm-reason-control"
                      value={trainingOptOutReasonCode}
                      onChange={(event) => {
                        const nextReason = event.target.value as TrainingOptOutReasonCode | "";
                        setTrainingOptOutReasonCode(nextReason);
                        if (nextReason !== "other") {
                          setTrainingOptOutReasonText("");
                        }
                      }}
                    >
                      <option value="">Избери причина</option>
                      <option value="injury">Контузия</option>
                      <option value="sick">Болен</option>
                      <option value="other">Друго</option>
                    </select>
                  </label>
                  {trainingOptOutReasonCode === "other" && (
                    <label className="training-confirm-reason-label">
                      <span className="pm-info-lbl">Опиши причината (задължително)</span>
                      <textarea
                        className="training-confirm-reason-control training-confirm-reason-textarea"
                        value={trainingOptOutReasonText}
                        onChange={(event) => setTrainingOptOutReasonText(event.target.value)}
                        maxLength={200}
                        rows={3}
                        placeholder="Въведи причина..."
                      />
                    </label>
                  )}
                </div>
              )}
              <div className="pm-actions training-confirm-actions">
                <button
                  className="pm-btn pm-btn--cancel"
                  type="button"
                  onClick={() => {
                    setTrainingConfirmModalOpen(false);
                    setTrainingConfirmAction(null);
                    setTrainingOptOutReasonCode("");
                    setTrainingOptOutReasonText("");
                  }}
                  disabled={trainingSavingDate === trainingDetailsItem.date}
                >
                  Отказ
                </button>
                <button
                  className="pm-btn pm-btn--submit"
                  type="button"
                  onClick={async () => {
                    if (!trainingConfirmAction || !trainingDetailsItem) return;
                    if (trainingConfirmAction === "optOut") {
                      if (!trainingOptOutReasonCode) {
                        setTrainingError("Избери причина за отсъствие.");
                        return;
                      }
                      if (trainingOptOutReasonCode === "other" && trainingOptOutReasonText.trim().length === 0) {
                        setTrainingError("Въведи причина в полето Друго.");
                        return;
                      }
                    }
                    setTrainingConfirmModalOpen(false);
                    await handleTrainingAttendanceConfirm(
                      trainingConfirmAction,
                      trainingDetailsItem,
                      trainingConfirmAction === "optOut" && trainingOptOutReasonCode
                        ? {
                          reasonCode: trainingOptOutReasonCode,
                          reasonText:
                            trainingOptOutReasonCode === "other"
                              ? trainingOptOutReasonText.trim()
                              : null,
                        }
                        : undefined,
                    );
                    setTrainingConfirmAction(null);
                    setTrainingOptOutReasonCode("");
                    setTrainingOptOutReasonText("");
                  }}
                  disabled={trainingSavingDate === trainingDetailsItem.date || !isOptOutReasonReady}
                >
                  {trainingSavingDate === trainingDetailsItem.date ? "Запазване..." : "Потвърди"}
                </button>
              </div>
            </div>
          </div>
        )}

        {editModalOpen && (
          <div className="pm-overlay" onClick={() => !editSaving && setEditModalOpen(false)}>
            <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
              <button className="pm-close" onClick={() => !editSaving && setEditModalOpen(false)}>
                <XIcon size={16} />
              </button>

              <div className="pm-header">
                <div className="pm-title-icon">✎</div>
                <div>
                  <h2 className="pm-title">Редактиране на профил</h2>
                </div>
              </div>

              <div className="pm-divider" />

              <div style={{ display: "grid", gap: "10px" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Име и фамилия</span>
                  <input
                    value={editForm.fullName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fullName: e.target.value }))}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Дата на раждане</span>
                  <input
                    type="date"
                    value={editForm.birthDate}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, birthDate: e.target.value }))}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Набор</span>
                  <input
                    inputMode="numeric"
                    value={editForm.teamGroup}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, teamGroup: e.target.value.replace(/\D/g, "") }))
                    }
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Номер в отбора</span>
                  <input
                    value={editForm.jerseyNumber}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, jerseyNumber: e.target.value }))}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Телефон на родител</span>
                  <input
                    type="tel"
                    value={editForm.parentPhone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, parentPhone: e.target.value }))}
                    placeholder="+359..."
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Телефон на състезател</span>
                  <input
                    type="tel"
                    value={editForm.playerPhone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, playerPhone: e.target.value }))}
                    placeholder="+359..."
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span className="pm-info-lbl">Нова снимка</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setEditImageFile(e.target.files?.[0] ?? null)}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "#fff",
                    }}
                  />
                </label>
              </div>

              {editImagePreviewUrl && (
                <img
                  src={editImagePreviewUrl}
                  alt="Image preview"
                  style={{
                    width: "min(160px, 100%)",
                    aspectRatio: "4 / 5",
                    objectFit: "cover",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.22)",
                    marginTop: "6px",
                    marginInline: "auto",
                  }}
                />
              )}

              {editError && (
                <div className="pm-error" style={{ marginTop: "10px" }}>{editError}</div>
              )}

              <div className="pm-divider" />

              <div className="pm-actions">
                <button
                  className="pm-btn pm-btn--cancel"
                  onClick={() => setEditModalOpen(false)}
                  disabled={editSaving}
                >
                  Отказ
                </button>
                <button
                  className="pm-btn pm-btn--submit"
                  onClick={handleSavePublicEdit}
                  disabled={editSaving}
                >
                  {editSaving ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ PAYMENT MODAL ══ */}
        {paymentModalOpen && (
          <div className="pm-overlay" onClick={() => setPaymentModalOpen(false)}>
            <div className="pm-modal" onClick={(e) => e.stopPropagation()}>

              <button className="pm-close" onClick={() => setPaymentModalOpen(false)}>
                <XIcon size={16} />
              </button>

              <div className="pm-header">
                <div className="pm-title-icon">⚽</div>
                <div>
                  <h2 className="pm-title">
                    {paymentModalMode === "delete" ? "Изтриване на плащане" : "Плащане"}
                  </h2>
                  <p className="pm-name">{member.name}</p>
                </div>
              </div>

              <div className="pm-divider" />

              {isTrainingCreditBasedPayment ? (
                <div className="pm-training-credit-panel">
                  <div className={`pm-training-credit-balance${remainingTrainingCredits <= 0 ? " pm-training-credit-balance--empty" : ""}`}>
                    <span className="pm-training-credit-balance-label">Оставащи тренировки</span>
                    <span className="pm-training-credit-balance-value">
                      {remainingTrainingCredits}
                    </span>
                  </div>
                  {isTrainingCreditsThirtyDayPayment && (
                    <div className={`pm-training-credit-balance${!hasActiveTrainingCreditWindow ? " pm-training-credit-balance--empty" : ""}`}>
                      <span className="pm-training-credit-balance-label">Оставащи дни</span>
                      <span className="pm-training-credit-balance-value">
                        {rollingPaymentWindow?.remainingDays ?? 0}
                      </span>
                    </div>
                  )}
                  {canManagePayments && (
                    <>
                      <label className="pm-training-credit-label" htmlFor="paymentTrainingCredits">
                        Нов брой тренировки
                      </label>
                      <input
                        id="paymentTrainingCredits"
                        className="pm-training-credit-input"
                        type="number"
                        min="1"
                        max="999"
                        inputMode="numeric"
                        value={paymentTrainingCredits}
                        onChange={(event) => {
                          setPaymentTrainingCredits(event.target.value);
                          setPaymentError(null);
                        }}
                        placeholder="Напр. 8"
                        disabled={paymentLoading}
                      />
                    </>
                  )}
                  <p className="pm-training-credit-help">
                    {hasActiveTrainingCreditsThirtyDayPayment
                      ? "Новото плащане е достъпно, когато тренировките станат 0 или 30-дневният срок изтече."
                      : !canManagePayments
                        ? `При онлайн плащане ще бъдат добавени ${member.defaultOnlineTrainingCredits ?? 0} тренировки.`
                      : isTrainingCreditsThirtyDayPayment
                      ? "При потвърждение тренировките ще се заменят с този брой и ще важат 30 дни от днес."
                      : "При потвърждение оставащите тренировки ще се заменят с този брой."}
                  </p>
                </div>
              ) : isRollingThirtyDayPayment ? (
                <div className={`pm-info-row pm-info-row--rolling${hasActiveRollingPayment ? " pm-info-row--locked" : ""}`}>
                  <span className="pm-info-lbl">
                    {paymentModalMode === "delete" ? "Плащания по дата" : "30-дневен период"}
                  </span>
                  {paymentModalMode === "delete" ? (
                    <span className="pm-info-val pm-info-val--muted">
                      Изтриването се управлява от платените дати по-долу.
                    </span>
                  ) : hasActiveRollingPayment && rollingPaymentWindow ? (
                    <span className="pm-rolling-status">
                      <strong>{rollingRemainingText} остават</strong>
                      <span>Платено до {rollingPaymentWindow.paidUntil.toLocaleDateString("bg-BG")}</span>
                    </span>
                  ) : (
                    <span className="pm-rolling-status">
                      <strong>Готово за плащане</strong>
                      <span>Новото плащане ще важи 30 дни от днешната дата.</span>
                    </span>
                  )}
                </div>
              ) : (
                <>
              <div className="pm-info-row">
                <span className="pm-info-lbl">
                  {paymentModalMode === "delete" ? "Изберете платени месеци:" : "Следващ дължим месец:"}
                </span>
                <span className="pm-info-val">
                  {paymentModalMode === "delete"
                    ? "Може да изберете един или повече"
                    : `${MONTH_NAMES_BG_FULL[paymentModalYM.month]} ${paymentModalYM.year}`}
                </span>
              </div>

              {/* Year nav */}
              <div className="pm-year-nav">
                <button
                  className="pm-year-btn"
                  onClick={() => setCalendarYear((y) => y - 1)}
                >
                  <ChevronIcon direction="left" />
                </button>
                <span className="pm-year-label">{calendarYear}</span>
                <button
                  className="pm-year-btn"
                  onClick={() => setCalendarYear((y) => y + 1)}
                >
                  <ChevronIcon direction="right" />
                </button>
              </div>

              {/* Month grid */}
              <div className="pm-months-grid">
                {MONTH_NAMES_BG.map((name, i) => {
                  const ym = { year: calendarYear, month: i };
                  const state = getMonthState(ym);
                  const inAdvanceRange =
                    !!selectedYM &&
                    cmpYM(ym, paymentModalYM) >= 0 &&
                    cmpYM(ym, selectedYM) <= 0 &&
                    state !== "paid" &&
                    state !== "waived" &&
                    state !== "deleteSelected" &&
                    state !== "selected";
                  return (
                    <button
                      key={i}
                      className={`pm-month-btn pm-month-btn--${state}${inAdvanceRange ? " pm-month-btn--range" : ""}`}
                      onClick={() => handleMonthClick(ym)}
                      disabled={state === "waived" || state === "disabled" || (paymentModalMode === "create" && state === "paid")}
                      title={
                        state === "disabled"
                          ? "Платете първо предишните месеци"
                          : state === "paid"
                            ? paymentModalMode === "delete"
                              ? "Изберете за изтриване"
                              : "Вече платено"
                            : state === "waived"
                              ? "Освободен месец (пауза)"
                              : undefined
                      }
                    >
                      {name}
                      {(state === "paid" || state === "deleteSelected") && <span className="pm-paid-dot" />}
                      {state === "waived" && <span className="pm-waived-dot" />}
                    </button>
                  );
                })}
              </div>

              {/* Selected summary */}
              {selectedPaymentDeleteMonths.length > 0 ? (
                <div className="pm-selected-summary pm-selected-summary--delete">
                  <span className="pm-selected-lbl">За изтриване:</span>
                  <span className="pm-selected-val">
                    {selectedPaymentDeleteMonths
                      .slice()
                      .sort((a, b) => cmpYM(a, b))
                      .map((item) => `${MONTH_NAMES_BG_FULL[item.month]} ${item.year}`)
                      .join(", ")}
                  </span>
                </div>
              ) : selectedYM && (
                <div className="pm-selected-summary">
                  <span className="pm-selected-lbl">Избрано:</span>
                  <span className="pm-selected-val">
                    {cmpYM(selectedYM, paymentModalYM) > 0
                      ? `${MONTH_NAMES_BG_FULL[paymentModalYM.month]} ${paymentModalYM.year} - ${MONTH_NAMES_BG_FULL[selectedYM.month]} ${selectedYM.year}`
                      : `${MONTH_NAMES_BG_FULL[selectedYM.month]} ${selectedYM.year}`}
                  </span>
                </div>
              )}

                </>
              )}

              {irisPayment && (
                <div className="pm-iris-panel">
                  <div className="pm-iris-head">
                    <span className="pm-iris-title">IRISPay</span>
                    <span className={`pm-iris-status pm-iris-status--${irisPayment.status.toLowerCase()}`}>
                      {irisPayment.status === "CONFIRMED"
                        ? "Потвърдено"
                        : irisPayment.status === "FAILED"
                          ? "Неуспешно"
                          : "Очаква плащане"}
                    </span>
                  </div>
                  <div className="pm-iris-amount">
                    {irisPayment.amount} {irisPayment.currency}
                  </div>
                  <img
                    className="pm-iris-qr"
                    src={irisPayment.qrUrl}
                    alt="IRISPay QR код"
                  />
                  <div className="pm-iris-actions">
                    <a
                      className="pm-btn pm-btn--submit pm-iris-link"
                      href={irisPayment.shortPaymentLink || irisPayment.paymentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Отвори плащане
                    </a>
                    <button
                      className="pm-btn pm-btn--cancel"
                      onClick={handleIrisStatusCheck}
                      disabled={irisStatusLoading}
                    >
                      {irisStatusLoading ? "Проверка..." : "Провери статус"}
                    </button>
                  </div>
                </div>
              )}

              {paymentError && (
                <div className="pm-error">{paymentError}</div>
              )}

              <div className="pm-divider" />

              <div className="pm-actions">
                <button className="pm-btn pm-btn--cancel" onClick={() => setPaymentModalOpen(false)}>
                  Отказ
                </button>
                {selectedPaymentDeleteMonths.length > 0 && (
                  <button
                    className="pm-btn pm-btn--danger"
                    onClick={handleDeletePayments}
                    disabled={paymentLoading}
                  >
                    {paymentLoading ? "Изтриване..." : "Изтрий плащания"}
                  </button>
                )}
                {paymentModalMode === "create" && (
                  <>
                    {viewerRoleChecked && member.onlinePaymentEnabled && (
                      <button
                        className="pm-btn pm-btn--submit"
                        onClick={handleIrisPayment}
                        disabled={
                          !selectedYM ||
                          irisPaymentLoading ||
                          paymentLoading ||
                          selectedPaymentDeleteMonths.length > 0 ||
                          hasActiveRollingPayment ||
                          hasActiveTrainingCreditsThirtyDayPayment ||
                          (isTrainingCreditBasedPayment && Number(member.defaultOnlineTrainingCredits ?? 0) <= 0)
                        }
                      >
                        {irisPaymentLoading ? "Създаване..." : "Плати онлайн"}
                      </button>
                    )}
                    {canManagePayments && (
                      <button
                        className="pm-btn pm-btn--submit"
                        onClick={handlePayment}
                        disabled={
                          !selectedYM ||
                          paymentLoading ||
                          selectedPaymentDeleteMonths.length > 0 ||
                          hasActiveRollingPayment ||
                          hasActiveTrainingCreditsThirtyDayPayment ||
                          (isTrainingCreditBasedPayment && (!Number.isInteger(Number(paymentTrainingCredits)) || Number(paymentTrainingCredits) < 1))
                        }
                        title={
                          hasActiveRollingPayment
                            ? `Остават ${rollingRemainingText}`
                            : hasActiveTrainingCreditsThirtyDayPayment
                              ? `Остават ${remainingTrainingCredits} тренировки и ${rollingRemainingText}`
                              : undefined
                        }
                      >
                        {paymentLoading ? "Обработка..." : "Потвърди плащане"}
                      </button>
                    )}
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ══ NOTIFICATIONS PANEL ══ */}
        {pauseModalOpen && (
          <div className="pm-overlay" onClick={() => !pauseActionLoading && setPauseModalOpen(false)}>
            <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
              <button className="pm-close" onClick={() => !pauseActionLoading && setPauseModalOpen(false)}>
                <XIcon size={16} />
              </button>

              <div className="pm-header">
                <div className="pm-title-icon">II</div>
                <div>
                  <h2 className="pm-title">Архивирай</h2>
                  <p className="pm-name">{member.name}</p>
                </div>
              </div>

              <div className="pm-divider" />

              <div className="pm-year-nav">
                <button className="pm-year-btn" onClick={() => setCalendarYear((y) => y - 1)}>
                  <ChevronIcon direction="left" />
                </button>
                <span className="pm-year-label">{calendarYear}</span>
                <button className="pm-year-btn" onClick={() => setCalendarYear((y) => y + 1)}>
                  <ChevronIcon direction="right" />
                </button>
              </div>

              <div className="pm-months-grid">
                {MONTH_NAMES_BG.map((name, i) => {
                  const ym = { year: calendarYear, month: i };
                  const key = `${ym.year}-${ym.month}`;
                  const isPaid = paidSet.has(key);
                  const isWaived = waivedSet.has(key);
                  const isSelected = selectedPauseKeys.has(key);

                  return (
                    <button
                      key={i}
                      className={`pm-month-btn ${isSelected ? "pm-month-btn--selected" : isWaived ? "pm-month-btn--waived" : "pm-month-btn--available"}`}
                      disabled={isPaid}
                      title={isPaid ? "Вече платен месец не може да бъде освободен." : isWaived ? "Месецът е вече в пауза." : undefined}
                      onClick={() => togglePauseMonth(ym)}
                    >
                      {name}
                      {isPaid && <span className="pm-paid-dot" />}
                      {isWaived && <span className="pm-waived-dot" />}
                    </button>
                  );
                })}
              </div>

              <label style={{ display: "grid", gap: 6, marginTop: 8 }}>
                <span className="pm-info-lbl">Причина (по избор)</span>
                <input
                  value={pauseReason}
                  onChange={(event) => setPauseReason(event.target.value)}
                  placeholder="напр. контузия, пътуване, изпити"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.22)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    color: "#fff",
                  }}
                />
              </label>

              {pauseError && <div className="pm-error">{pauseError}</div>}

              <div className="pm-divider" />

              <div className="pm-actions">
                <button
                  className="pm-btn pm-btn--cancel"
                  onClick={() => setPauseModalOpen(false)}
                  disabled={pauseActionLoading}
                >
                  Отказ
                </button>
                <button
                  className="pm-btn pm-btn--ghost"
                  onClick={() => void handleManagePauseMonths("remove")}
                  disabled={pauseActionLoading || !canRemovePause}
                >
                  {pauseActionLoading ? "Запазване..." : "Премахни пауза"}
                </button>
                <button
                  className="pm-btn pm-btn--submit"
                  onClick={() => void handleManagePauseMonths("pause")}
                  disabled={pauseActionLoading || !canApplyPause}
                >
                  {pauseActionLoading ? "Запазване..." : "Приложи пауза"}
                </button>
              </div>
            </div>
          </div>
        )}

        {canUseNotifications && notificationsPanelOpen && (
          <div className="pm-overlay" onClick={() => setNotificationsPanelOpen(false)}>
            <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
              <button className="pm-close" onClick={() => setNotificationsPanelOpen(false)}>
                <XIcon size={16} />
              </button>

              <div className="pm-header">
                <div className="pm-title-icon">🔔</div>
                <div>
                  <h2 className="pm-title">Известия</h2>
                </div>
              </div>

              <div className="pm-divider" />

              <div className="member-notifications-scroll">
                {loadingNotifications ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.6)" }}>
                    <SpinnerIcon size={24} />
                  </div>
                ) : notifications.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.6)" }}>
                    Няма известия
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={notif.type === "birthday" ? () => { setNotificationsPanelOpen(false); setBirthdayCardOpen(true); } : undefined}
                        style={{
                          background: notif.readAt ? "rgba(255,255,255,0.05)" : "rgba(50,205,50,0.1)",
                          border: notif.readAt ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(50,205,50,0.3)",
                          borderRadius: "8px",
                          padding: "12px",
                          cursor: notif.type === "birthday" ? "pointer" : "default",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "4px" }}>
                          <h3 style={{
                            margin: 0,
                            fontSize: "14px",
                            fontWeight: "700",
                            color: notif.readAt ? "rgba(255,255,255,0.9)" : "#32cd32",
                          }}>
                            {notif.title}
                          </h3>
                          {!notif.readAt && (
                            <span style={{
                              background: "#ff3b3b",
                              borderRadius: "999px",
                              width: "8px",
                              height: "8px",
                              display: "block",
                              flexShrink: 0,
                              marginTop: "4px",
                            }} />
                          )}
                        </div>
                        <p style={{
                          margin: "4px 0 8px",
                          fontSize: "13px",
                          color: "rgba(255,255,255,0.7)",
                          lineHeight: "1.4",
                        }}>
                          <NotificationText text={notif.body} />
                        </p>
                        <p style={{
                          margin: 0,
                          fontSize: "11px",
                          color: "rgba(255,255,255,0.5)",
                        }}>
                          {new Date(notif.sentAt).toLocaleDateString("bg-BG", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {birthdayCardOpen && member && (
          <div className="birthday-card-overlay" onClick={() => setBirthdayCardOpen(false)}>
            <div className="birthday-confetti-container" aria-hidden="true">
              <span className="bcp bcp1" /><span className="bcp bcp2" /><span className="bcp bcp3" />
              <span className="bcp bcp4" /><span className="bcp bcp5" /><span className="bcp bcp6" />
              <span className="bcp bcp7" /><span className="bcp bcp8" /><span className="bcp bcp9" />
              <span className="bcp bcp10" /><span className="bcp bcp11" /><span className="bcp bcp12" />
              <span className="bcp bcp13" /><span className="bcp bcp14" /><span className="bcp bcp15" />
              <span className="bcp bcp16" />
            </div>
            <div className="birthday-fw-container" aria-hidden="true">
              <span className="fw fw1"><span className="fw-t" /><span className="fw-b" /></span>
              <span className="fw fw2"><span className="fw-t" /><span className="fw-b" /></span>
              <span className="fw fw3"><span className="fw-t" /><span className="fw-b" /></span>
              <span className="fw fw4"><span className="fw-t" /><span className="fw-b" /></span>
            </div>
            <div className="birthday-card-modal" onClick={(e) => e.stopPropagation()}>
              <button
                className="birthday-card-close"
                onClick={() => setBirthdayCardOpen(false)}
                aria-label="Затвори"
              >
                ×
              </button>

              <div className="birthday-card-sparkles" aria-hidden="true">
                <span className="birthday-sparkle s1">✦</span>
                <span className="birthday-sparkle s2">✦</span>
                <span className="birthday-sparkle s3">✦</span>
                <span className="birthday-sparkle s4">✦</span>
                <span className="birthday-sparkle s5">✦</span>
                <span className="birthday-sparkle s6">✦</span>
              </div>

              {member.clubLogoUrl && (
                <img
                  src={member.clubLogoUrl}
                  alt={member.clubName ?? "Клуб"}
                  className="birthday-card-club-logo"
                />
              )}

              {member.avatarUrl ? (
                <img
                  src={member.avatarUrl}
                  alt={member.name}
                  className="birthday-card-avatar"
                />
              ) : (
                <div className="birthday-card-avatar birthday-card-avatar-placeholder">
                  {member.name.charAt(0).toUpperCase()}
                </div>
              )}

              <p className="birthday-card-emoji">🎂</p>
              <h2 className="birthday-card-heading">Честит рожден ден!</h2>
              <p className="birthday-card-name">{member.name}</p>

              {member.birthDate && (
                <p className="birthday-card-date">
                  {new Date(member.birthDate).toLocaleDateString("bg-BG", {
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  })}
                </p>
              )}

              <p className="birthday-card-wish">
                Пожелаваме ти здраве, щастие и много победи! 🏆
              </p>
            </div>
          </div>
        )}

        {selectedReceipt && (
          <div className="receipt-overlay" onClick={() => setSelectedReceipt(null)}>
            <div className="receipt-dialog" onClick={(e) => e.stopPropagation()}>
              <button className="receipt-close" onClick={() => setSelectedReceipt(null)} aria-label="Затвори">
                <XIcon size={14} />
              </button>

              <div id="receipt-print-area" className="receipt-card">
                <div className="receipt-head">
                  <h2 className="receipt-title">{member.clubName || "Клуб"}</h2>
                  <p className="receipt-sub">Разписка за членски внос</p>
                </div>

                <hr className="receipt-sep" />

                <div className="receipt-fields">
                  <div className="receipt-row">
                    <span className="receipt-lbl">Състезател:</span>
                    <span className="receipt-val">{member.name}</span>
                  </div>
                  <div className="receipt-row">
                    <span className="receipt-lbl">Период:</span>
                    <span className="receipt-val">{formatReceiptPeriod(selectedReceipt.paidFor)}</span>
                  </div>
                  <div className="receipt-row">
                    <span className="receipt-lbl">Дата на плащане:</span>
                    <span className="receipt-val">{new Date(selectedReceipt.paidAt).toLocaleDateString("bg-BG")}</span>
                  </div>
                </div>

                <hr className="receipt-sep" />

                <div className="receipt-stamp-wrap">
                  <div className="receipt-stamp">ПЛАТЕНО</div>
                </div>

                <div className="receipt-actions">
                  <button className="receipt-action-btn" onClick={handlePrintReceipt}>
                    <PrinterIcon size={14} />
                    Принтирай / Запази
                  </button>
                  <button className="receipt-action-btn" onClick={() => setSelectedReceipt(null)}>
                    <XIcon size={14} />
                    Затвори
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
