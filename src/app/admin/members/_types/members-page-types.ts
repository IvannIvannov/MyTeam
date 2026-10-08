type ReportKind = "monthly" | "yearly";

interface ReportPaymentLog {
  id: string;
  paidFor: string;
  paidAt: string;
}

interface ReportPlayer {
  id: string;
  fullName: string;
  teamGroup: number | null;
  paymentAmount: string | null;
  paymentLogs: ReportPaymentLog[];
  paymentWaivers: Array<{ waivedFor: string }>;
  isActive?: boolean;
}

type PlayerStatus = "paid" | "warning" | "overdue" | "paused";

interface PaymentLog {
  id: string;
  paidFor: string;
  paidAt: string;
}

interface MemberCard {
  cardCode: string;
  isActive: boolean;
}

interface MemberClub {
  id: string;
  name: string;
}

interface ClubOption {
  id: string;
  name: string;
  sports?: string | null;
  emblemUrl?: string | null;
  imageUrl?: string | null;
  imagePublicId?: string | null;
  reminderDay?: number;
  overdueDay?: number;
  reminderHour?: number;
  reminderMinute?: number;
  secondReminderDay?: number | null;
  secondReminderHour?: number | null;
  secondReminderMinute?: number | null;
  thirdReminderDay?: number | null;
  thirdReminderHour?: number | null;
  thirdReminderMinute?: number | null;
  overdueHour?: number;
  overdueMinute?: number;
  trainingDates?: string[];
  trainingTime?: string | null;
  trainingDateTimes?: Record<string, string> | null;
  trainingDurationMinutes?: number;
  trainingWeekdays?: number[];
  trainingWindowDays?: number;
  trainingGroupMode?: "team_group" | "custom_group";
  billingStatus?: string;
  paymentWorkflow?: "calendar_month" | "rolling_30_days" | "training_credits" | "training_credits_30_days";
  defaultPaymentAmount?: string | number | null;
}

interface Member {
  id: string;
  fullName: string;
  nfcTagId: string;
  status: PlayerStatus;
  teamGroup: number | null;
  coachGroupIds: string[];
  /** Palette hex colors for custom training groups this player belongs to */
  customTrainingGroupColors: string[];
  jerseyNumber: string | null;
  parentPhone: string | null;
  playerPhone: string | null;
  avatarUrl: string | null;
  imageUrl: string | null;
  imagePublicId: string | null;
  birthDate: string | null;
  lastPaymentDate: string | null;
  paymentAmount: string | null;
  remainingTrainingCredits?: number;
  club?: MemberClub;
  paymentLogs: PaymentLog[];
  cards: MemberCard[];
  isActive: boolean;
}

interface CoachGroup {
  id: string;
  name: string;
  playerCount: number;
}

interface TrainingAttendancePlayer {
  id: string;
  fullName: string;
  teamGroup: number | null;
  cardCode: string | null;
  optedOut: boolean;
}

interface TrainingUpcomingDateItem {
  date: string;
  weekday: number;
  trainingTime?: string | null;
  stats: {
    total: number;
    attending: number;
    optedOut: number;
  };
}

interface TrainingScheduleGroup {
  id: string;
  name: string;
  teamGroups: number[];
  trainingDates: string[];
  trainingTime?: string | null;
  trainingDateTimes?: Record<string, string> | null;
  trainingDurationMinutes?: number;
  trainingFieldId?: string | null;
  trainingFieldPieceIds?: string[];
  trainingFieldSelections?: Record<string, TrainingFieldSelection> | null;
}

interface CustomTrainingGroup {
  id: string;
  name: string;
  color?: string | null;
  playerIds: string[];
  coachGroupId?: string | null;
  trainingDates: string[];
  trainingTime?: string | null;
  trainingDateTimes?: Record<string, string> | null;
  trainingDurationMinutes?: number;
  trainingFieldId?: string | null;
  trainingFieldPieceIds?: string[];
  trainingFieldSelections?: Record<string, TrainingFieldSelection> | null;
}

interface TrainingFieldSelection {
  trainingFieldId: string | null;
  trainingFieldPieceIds: string[];
}

interface TrainingFieldPiece {
  id: string;
  name: string;
  sortOrder: number;
}

interface TrainingField {
  id: string;
  name: string;
  fieldType: string;
  pieces: TrainingFieldPiece[];
}

type TrainingTimeMode = "all" | "perDay" | "byWeekday";

type TrainingDaysStep = "days" | "time" | "spots" | "field" | "notes";

interface TrainingTodaySessionItem {
  id: string;
  scopeType: "teamGroup" | "trainingGroup";
  label: string;
  teamGroups: number[];
  stats: {
    total: number;
    attending: number;
    optedOut: number;
  };
}

interface TrainingWeekSessionItem {
  id: string;
  date: string;
  trainingTime: string | null;
  scopeType: "teamGroup" | "trainingGroup";
  eventType?: "training" | "match";
  label: string;
  teamGroups: number[];
  /** Custom training group palette hex when `trainingGroupMode` is custom_group */
  color?: string | null;
  location?: string;
  scopeLabel?: string;
  isHome?: boolean;
  durationMinutes?: number;
  customGroupId?: string | null;
  limitedSpots?: { id: string; maxSpots: number; registeredCount: number } | null;
}

interface ClubMatch {
  id: string;
  customGroupId: string | null;
  opponent: string;
  location: string;
  matchDate: string;
  matchTime: string;
  durationMinutes: number;
  isHome: boolean;
  teamGroups: number[];
}

interface MatchFormState {
  opponent: string;
  location: string;
  matchDate: string;
  matchTime: string;
  durationMinutes: number;
  isHome: boolean;
  teamGroups: number[];
}

interface AttendanceReportPlayer {
  id: string;
  fullName: string;
  teamGroup: number | null;
  attendance: Record<string, { present: boolean; reasonCode: string | null }>;
}

interface AttendanceReportData {
  trainingDates: string[];
  players: AttendanceReportPlayer[];
}

interface MemberNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  teamGroup?: number | null;
  trainingGroups?: Array<{
    id: string;
    name: string;
  }>;
}

interface StatusMeta {
  label: string;
  color: string;
  bg: string;
  border: string;
  cls: string;
}

/* ── Import From Sheets Modal ── */

type ImportStep = "browse" | "preview" | "importing" | "results";

type PhotoImportStep = "browse" | "confirm" | "importing" | "results";

type DriveItem = { id: string; name: string; mimeType: string };

type ParsedPlayerRow = {
  rowIndex: number;
  fullName: string;
  birthDateIso: string | null;
  teamGroup: number | null;
  jerseyNumber: string | null;
  warning?: string;
};

type ImportResult = {
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; name: string; reason: string }>;
};

type PhotoImportResult = {
  totalFiles: number;
  totalPlayersScanned: number;
  updated: number;
  unchanged: number;
  skippedExisting: number;
  skippedAmbiguous: number;
  unmatched: number;
  failedUploads: number;
  details: {
    updatedPlayers: Array<{ playerId: string; playerName: string; fileName: string }>;
    unmatchedFiles: string[];
    ambiguousFiles: string[];
    failedFiles: Array<{ fileName: string; reason: string }>;
  };
};

interface LimitedEventRegistration {
  position: number;
  playerId: string;
  fullName: string;
  registeredAt: string;
  isConfirmed: boolean;
}

interface LimitedEventDetail {
  id: string;
  scopeKey: string;
  scopeId: string | null;
  teamGroup: number | null;
  trainingDate: string;
  maxSpots: number;
  registrations: LimitedEventRegistration[];
  spotsRemaining: number;
}

export type {
  ReportKind,
  ReportPaymentLog,
  ReportPlayer,
  PlayerStatus,
  PaymentLog,
  MemberCard,
  MemberClub,
  ClubOption,
  Member,
  CoachGroup,
  TrainingAttendancePlayer,
  TrainingUpcomingDateItem,
  TrainingScheduleGroup,
  CustomTrainingGroup,
  TrainingFieldSelection,
  TrainingFieldPiece,
  TrainingField,
  TrainingTimeMode,
  TrainingDaysStep,
  TrainingTodaySessionItem,
  TrainingWeekSessionItem,
  ClubMatch,
  MatchFormState,
  AttendanceReportPlayer,
  AttendanceReportData,
  MemberNotification,
  StatusMeta,
  ImportStep,
  PhotoImportStep,
  DriveItem,
  ParsedPlayerRow,
  ImportResult,
  PhotoImportResult,
  LimitedEventRegistration,
  LimitedEventDetail,
};
