"use client";

import { Suspense, useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { extractUploadPathFromCloudinaryUrl } from "@/lib/cloudinaryImagePath";
import { uploadImage, validateImageFile } from "@/lib/uploadImage";
import { isValidPhone } from "@/lib/phone";
import { getCompatiblePushSubscription } from "@/lib/push/browser";
import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import CoachMessageModal from "@/components/admin/CoachMessageModal";
import "./page.css";
import {
  CUSTOM_TRAINING_GROUP_COLOR_PALETTE,
  isCustomTrainingGroupPaletteColor,
  customTrainingGroupAccentRgba,
  customTrainingGroupReadableOnAccent,
} from "@/lib/customTrainingGroupColors";

import {
  AttendanceDashboard,
  ReportsDialog,
  MemberDetailModal,
  ConfirmDeleteModal,
  PlayerCard,
  InactivePlayersModal,
  ConfirmPermanentDeleteModal,
  ConfirmDeleteTeamModal,
  ImportFromSheetsModal,
  ImportPhotosFromDriveModal,
  ConfirmDeleteTrainingGroupModal,
  ConfirmNewCardModal,
  ArrowLeftIcon,
  SearchIcon,
  XIcon,
  PlusIcon,
  TrashIcon,
  BellIcon,
  BellOffIcon,
  SpinnerIcon,
  ShareIcon,
  ImportSheetsIcon,
  PhotoImportIcon,
  CalendarIcon,
  ChartColumnIcon,
  PencilIcon,
  ReceiptIcon,
  FileIcon,
  UsersIcon,
  ClipboardListIcon,
  DownloadIcon,
  DEFAULT_TRAINING_DURATION_MINUTES,
  TRAINING_WEEKDAY_SHORT_BG,
  TRAINING_WEEKDAY_LONG_BG,
  TRAINING_TIME_REGEX,
  normalizeMember,
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
  buildCalendarMonths,
} from "./_components/members-page-components";
import type {
  Member,
  ClubOption,
  CoachGroup,
  MemberNotification,
  TrainingAttendancePlayer,
  TrainingUpcomingDateItem,
  TrainingScheduleGroup,
  CustomTrainingGroup,
  TrainingFieldSelection,
  TrainingField,
  TrainingTimeMode,
  TrainingDaysStep,
  TrainingWeekSessionItem,
  ClubMatch,
  LimitedEventDetail,
} from "./_components/members-page-components";

/* ── Weekly schedule (Тази седмица): vertical list by day ── */
function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "bg", { sensitivity: "base", numeric: true }));
}

function sortWeekSessionsForDay(a: TrainingWeekSessionItem, b: TrainingWeekSessionItem): number {
  const minutes = (s: TrainingWeekSessionItem) => {
    const t = s.trainingTime?.trim() ?? "";
    return /^\d{2}:\d{2}$/.test(t) ? parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10) : 99999;
  };
  const d = minutes(a) - minutes(b);
  if (d !== 0) return d;
  return a.label.localeCompare(b.label, "bg");
}

function customTrainingGroupCoachScopeKey(coachGroupIdFromUrl: string): string | null {
  const trimmed = coachGroupIdFromUrl.trim();
  return trimmed || null;
}

function getScopeKeyFromSessionId(sessionId: string): string | null {
  const customMatch = sessionId.match(/^\d{4}-\d{2}-\d{2}-custom-(.+)$/);
  if (customMatch) return `custom_group:${customMatch[1]}`;
  const teamMatch = sessionId.match(/^\d{4}-\d{2}-\d{2}-team-(\d+)$/);
  if (teamMatch) return `team_group:${teamMatch[1]}`;
  return null;
}

function getFieldBackground(fieldType: string): string {
  switch (fieldType) {
    case "basketball":
      return "#c17a32";
    case "tennis":
      return "#2e6b9e";
    case "volleyball":
      return "#e07a50";
    case "boxing":
      return "#1a6b9e";
    case "karate":
      return "#e8919f";
    case "swimming":
      return "linear-gradient(180deg, #0e5fb5 0%, #1878d4 45%, #1060b8 100%)";
    default:
      return "linear-gradient(90deg, rgba(32,142,50,0.82) 0 12.5%, rgba(26,122,43,0.82) 12.5% 25%, rgba(32,142,50,0.82) 25% 37.5%, rgba(26,122,43,0.82) 37.5% 50%, rgba(32,142,50,0.82) 50% 62.5%, rgba(26,122,43,0.82) 62.5% 75%, rgba(32,142,50,0.82) 75% 87.5%, rgba(26,122,43,0.82) 87.5% 100%)";
  }
}

function clubSportToFieldType(sport: string): string {
  const s = sport.toLowerCase();
  if (/basket|баскетбол/.test(s)) return "basketball";
  if (/tenis|тенис/.test(s)) return "tennis";
  if (/voley|волей/.test(s)) return "volleyball";
  if (/box|бокс/.test(s)) return "boxing";
  if (/karat|karate|карате|taekwon|таекуондо|judo|джудо/.test(s)) return "karate";
  if (/swim|плув|басейн/.test(s)) return "swimming";
  return "football";
}

function renderFieldMarkings(fieldType: string) {
  const line = "rgba(255,255,255,0.82)";
  switch (fieldType) {
    case "basketball":
      return (
        <>
          {/* outer border */}
          <div aria-hidden="true" style={{ position: "absolute", inset: "8px", border: `1px solid ${line}`, borderRadius: "2px", pointerEvents: "none" }} />
          {/* center line */}
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", left: "50%", width: "1px", background: line, transform: "translateX(-0.5px)", pointerEvents: "none" }} />
          {/* center circle */}
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "26px", height: "26px", border: `1px solid ${line}`, borderRadius: "999px", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
          {/* center dot */}
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "4px", height: "4px", background: "rgba(255,255,255,0.9)", borderRadius: "999px", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
          {/* left key rectangle */}
          <div aria-hidden="true" style={{ position: "absolute", top: "22%", bottom: "22%", left: "8px", width: "19%", border: `1px solid ${line}`, borderRight: "none", pointerEvents: "none" }} />
          {/* left free-throw semi-circle */}
          <div aria-hidden="true" style={{ position: "absolute", top: "22%", bottom: "22%", left: "calc(8px + 19%)", width: "9%", borderTop: `1px solid ${line}`, borderRight: `1px solid ${line}`, borderBottom: `1px solid ${line}`, borderRadius: "0 999px 999px 0", pointerEvents: "none" }} />
          {/* right key rectangle */}
          <div aria-hidden="true" style={{ position: "absolute", top: "22%", bottom: "22%", right: "8px", width: "19%", border: `1px solid ${line}`, borderLeft: "none", pointerEvents: "none" }} />
          {/* right free-throw semi-circle */}
          <div aria-hidden="true" style={{ position: "absolute", top: "22%", bottom: "22%", right: "calc(8px + 19%)", width: "9%", borderTop: `1px solid ${line}`, borderLeft: `1px solid ${line}`, borderBottom: `1px solid ${line}`, borderRadius: "999px 0 0 999px", pointerEvents: "none" }} />
        </>
      );
    case "tennis":
      return (
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: "8px", border: `1px solid ${line}`, borderRadius: "2px", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", left: "50%", width: "2px", background: "rgba(255,255,255,0.9)", transform: "translateX(-1px)", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", left: "35%", width: "1px", background: line, pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", right: "35%", width: "1px", background: line, pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "50%", left: "35%", width: "15%", height: "1px", background: line, transform: "translateY(-0.5px)", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "50%", right: "35%", width: "15%", height: "1px", background: line, transform: "translateY(-0.5px)", pointerEvents: "none" }} />
        </>
      );
    case "volleyball":
      return (
        <>
          {/* outer border */}
          <div aria-hidden="true" style={{ position: "absolute", inset: "8px", border: `2px solid ${line}`, borderRadius: "2px", pointerEvents: "none" }} />
          {/* net band with mesh */}
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", left: "calc(50% - 5px)", width: "10px", borderLeft: "1px solid rgba(255,255,255,0.95)", borderRight: "1px solid rgba(255,255,255,0.95)", background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 1px, transparent 1px, transparent 4px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 1px, transparent 1px, transparent 4px)", pointerEvents: "none" }} />
          {/* antenna top */}
          <div aria-hidden="true" style={{ position: "absolute", top: "2px", left: "50%", width: "2px", height: "6px", background: "rgba(255,255,255,0.7)", transform: "translateX(-1px)", pointerEvents: "none" }} />
          {/* antenna bottom */}
          <div aria-hidden="true" style={{ position: "absolute", bottom: "2px", left: "50%", width: "2px", height: "6px", background: "rgba(255,255,255,0.7)", transform: "translateX(-1px)", pointerEvents: "none" }} />
          {/* left attack line */}
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", left: "33%", width: "1px", background: line, pointerEvents: "none" }} />
          {/* right attack line */}
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", right: "33%", width: "1px", background: line, pointerEvents: "none" }} />
        </>
      );
    case "boxing":
      return (
        <>
          {/* outer rope */}
          <div aria-hidden="true" style={{ position: "absolute", inset: "5px", border: "2px solid rgba(255,255,255,0.9)", borderRadius: "2px", pointerEvents: "none" }} />
          {/* inner rope (dashed) */}
          <div aria-hidden="true" style={{ position: "absolute", inset: "12px", border: "1px dashed rgba(255,255,255,0.65)", borderRadius: "2px", pointerEvents: "none" }} />
          {/* corner post top-left */}
          <div aria-hidden="true" style={{ position: "absolute", top: "3px", left: "3px", width: "6px", height: "6px", background: "rgba(20,20,20,0.9)", borderRadius: "999px", pointerEvents: "none" }} />
          {/* corner post top-right */}
          <div aria-hidden="true" style={{ position: "absolute", top: "3px", right: "3px", width: "6px", height: "6px", background: "rgba(20,20,20,0.9)", borderRadius: "999px", pointerEvents: "none" }} />
          {/* corner post bottom-left */}
          <div aria-hidden="true" style={{ position: "absolute", bottom: "3px", left: "3px", width: "6px", height: "6px", background: "rgba(20,20,20,0.9)", borderRadius: "999px", pointerEvents: "none" }} />
          {/* corner post bottom-right */}
          <div aria-hidden="true" style={{ position: "absolute", bottom: "3px", right: "3px", width: "6px", height: "6px", background: "rgba(20,20,20,0.9)", borderRadius: "999px", pointerEvents: "none" }} />
        </>
      );
    case "karate":
      return (
        <>
          {/* Blue competition frame with inner pink area */}
          <div aria-hidden="true" style={{ position: "absolute", inset: "15%", background: "#1564bf", pointerEvents: "none" }}>
            <div aria-hidden="true" style={{ position: "absolute", inset: "20%", background: "#e8919f", pointerEvents: "none" }}>
              {/* contestant position marks — horizontal top */}
              <div aria-hidden="true" style={{ position: "absolute", top: "28%", left: "38%", right: "38%", height: "2px", background: "#1564bf", pointerEvents: "none" }} />
              {/* contestant position marks — left vertical */}
              <div aria-hidden="true" style={{ position: "absolute", top: "36%", bottom: "22%", left: "41%", width: "2px", background: "#1564bf", pointerEvents: "none" }} />
              {/* contestant position marks — right vertical */}
              <div aria-hidden="true" style={{ position: "absolute", top: "36%", bottom: "22%", right: "41%", width: "2px", background: "#1564bf", pointerEvents: "none" }} />
            </div>
          </div>
          {/* diagonal dashes in outer pink corners */}
          <div aria-hidden="true" style={{ position: "absolute", top: "8%", left: "2%", width: "11%", height: "0", borderTop: "2px dashed #1564bf", transform: "rotate(-45deg)", transformOrigin: "right center", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "8%", right: "2%", width: "11%", height: "0", borderTop: "2px dashed #1564bf", transform: "rotate(45deg)", transformOrigin: "left center", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", bottom: "8%", left: "2%", width: "11%", height: "0", borderTop: "2px dashed #1564bf", transform: "rotate(45deg)", transformOrigin: "right center", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", bottom: "8%", right: "2%", width: "11%", height: "0", borderTop: "2px dashed #1564bf", transform: "rotate(-45deg)", transformOrigin: "left center", pointerEvents: "none" }} />
        </>
      );
    case "swimming":
      return (
        <>
          {/* pool border */}
          <div aria-hidden="true" style={{ position: "absolute", inset: "4px", border: "2px solid rgba(255,255,255,0.7)", borderRadius: "2px", pointerEvents: "none" }} />
          {/* lane rope between lane 1 and 2 */}
          <div aria-hidden="true" style={{ position: "absolute", top: "calc(33.33% - 3px)", left: "4px", right: "4px", height: "6px", borderRadius: "3px", background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.92) 0px, rgba(255,255,255,0.92) 6px, transparent 6px, transparent 8px, rgba(210,40,40,0.9) 8px, rgba(210,40,40,0.9) 14px, transparent 14px, transparent 16px)", pointerEvents: "none" }} />
          {/* lane rope between lane 2 and 3 */}
          <div aria-hidden="true" style={{ position: "absolute", top: "calc(66.66% - 3px)", left: "4px", right: "4px", height: "6px", borderRadius: "3px", background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.92) 0px, rgba(255,255,255,0.92) 6px, transparent 6px, transparent 8px, rgba(210,40,40,0.9) 8px, rgba(210,40,40,0.9) 14px, transparent 14px, transparent 16px)", pointerEvents: "none" }} />
          {/* turn wall line (left) */}
          <div aria-hidden="true" style={{ position: "absolute", top: "4px", bottom: "4px", left: "10%", width: "1px", background: "rgba(255,255,255,0.45)", pointerEvents: "none" }} />
          {/* turn wall line (right) */}
          <div aria-hidden="true" style={{ position: "absolute", top: "4px", bottom: "4px", right: "10%", width: "1px", background: "rgba(255,255,255,0.45)", pointerEvents: "none" }} />
        </>
      );
    default:
      return (
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: "8px", border: "1px solid rgba(255,255,255,0.72)", borderRadius: "4px", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "8px", bottom: "8px", left: "50%", width: "1px", background: "rgba(255,255,255,0.72)", transform: "translateX(-0.5px)", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "26px", height: "26px", border: "1px solid rgba(255,255,255,0.72)", borderRadius: "999px", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "4px", height: "4px", background: "rgba(255,255,255,0.8)", borderRadius: "999px", transform: "translate(-50%, -50%)", pointerEvents: "none" }} />
        </>
      );
  }
}

function CustomTrainingGroupColorPicker({
  value,
  onChange,
  disabled,
  coachScopeKey,
  groups,
  excludeGroupId,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  coachScopeKey: string | null;
  groups: CustomTrainingGroup[];
  excludeGroupId?: string;
}) {
  const colorTakenByOther = (hex: string): string | null => {
    const match = groups.find(
      (g) =>
        (g.coachGroupId ?? null) === coachScopeKey &&
        isCustomTrainingGroupPaletteColor(g.color) &&
        g.color === hex &&
        (!excludeGroupId || g.id !== excludeGroupId),
    );
    return match ? match.name : null;
  };

  return (
    <div className="amp-edit-field" style={{ marginTop: 10 }}>
      <span className="amp-lbl">Цвят на групата</span>
      <div className="amp-custom-group-color-swatches" role="radiogroup" aria-label="Цвят на групата">
        {CUSTOM_TRAINING_GROUP_COLOR_PALETTE.map((hex) => {
          const takenBy = colorTakenByOther(hex);
          const isSelected = value === hex;
          const isDisabled = Boolean(disabled) || (takenBy !== null && !isSelected);
          const btn = (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={takenBy && !isSelected ? "Зает цвят" : `Цвят ${hex}`}
              disabled={isDisabled}
              className={`amp-custom-group-color-swatch${isSelected ? " is-selected" : ""}${takenBy && !isSelected ? " is-taken" : ""}`}
              style={{ backgroundColor: hex, ...(hex === "#FAFAFA" && !isSelected ? { borderColor: "rgba(0,0,0,0.35)" } : {}) }}
              onClick={() => onChange(hex)}
            />
          );
          return takenBy && !isSelected ? (
            <span key={hex} className="amp-color-swatch-tooltip-wrap" data-tooltip={`Използва се от ${takenBy}`}>
              {btn}
            </span>
          ) : btn;
        })}
      </div>
    </div>
  );
}

function WeeklyGrid({
  dates,
  sessions,
  todayIso,
  onDateClick,
}: {
  dates: string[];
  sessions: TrainingWeekSessionItem[];
  todayIso: string;
  onDateClick?: (date: string, sessionId: string) => void;
}) {
  const sessionsByDate = new Map<string, TrainingWeekSessionItem[]>();
  for (const d of dates) sessionsByDate.set(d, []);
  for (const s of sessions) {
    const row = sessionsByDate.get(s.date);
    if (row) row.push(s);
  }
  for (const d of dates) {
    sessionsByDate.get(d)!.sort(sortWeekSessionsForDay);
  }

  return (
    <div className="amp-training-week-scroll amp-training-week-scroll--list">
      <div className="amp-training-week-list">
        {dates.map((date) => {
          const daySessions = sessionsByDate.get(date) ?? [];
          if (daySessions.length === 0) return null;
          const weekdayLong = TRAINING_WEEKDAY_LONG_BG[getWeekdayMondayFirstIndex(date)] ?? "";
          const dateLine = new Date(`${date}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          return (
            <section
              key={date}
              className={`amp-training-week-day-block${date === todayIso ? " amp-training-week-day-block--today" : ""}`}
            >
              <header className="amp-training-week-day-strip">
                <span className="amp-training-week-day-strip-weekday">{weekdayLong}</span>
                <span className="amp-training-week-day-strip-date">{dateLine}</span>
              </header>
              <ul className="amp-training-week-session-rows" aria-label={`График за ${weekdayLong}`}>
                {daySessions.map((session) => {
                  const accent =
                    session.color &&
                    isCustomTrainingGroupPaletteColor(session.color)
                      ? session.color
                      : null;
                  const rowStyle: CSSProperties | undefined = accent
                    ? {
                        background: customTrainingGroupAccentRgba(accent, 0.1),
                        borderColor: customTrainingGroupAccentRgba(accent, 0.38),
                      }
                    : undefined;
                  const timeStyle: CSSProperties | undefined = accent
                    ? { color: customTrainingGroupReadableOnAccent(accent) === "#fafafa" ? "rgba(255,255,255,0.75)" : accent }
                    : undefined;
                  const badgeStyle: CSSProperties | undefined = accent
                    ? {
                        background: accent,
                        borderColor: customTrainingGroupAccentRgba(accent, 0.55),
                        color: customTrainingGroupReadableOnAccent(accent),
                      }
                    : undefined;
                  return (
                  <li
                    key={session.id}
                    className={`amp-training-week-session-row${
                      session.eventType === "match" ? " amp-training-week-session-row--match" : ""
                    }${onDateClick ? " amp-training-week-session-row--clickable" : ""}`}
                    style={onDateClick ? { ...rowStyle, cursor: "pointer" } : rowStyle}
                    onClick={onDateClick ? () => onDateClick(session.date, session.id) : undefined}
                    role={onDateClick ? "button" : undefined}
                    tabIndex={onDateClick ? 0 : undefined}
                    onKeyDown={onDateClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDateClick(session.date, session.id); } } : undefined}
                  >
                    <span className="amp-training-week-session-row-time" style={timeStyle}>
                      {session.trainingTime?.trim()
                        ? session.trainingTime.trim()
                        : "—"}
                    </span>
                    <div className="amp-training-week-session-row-main">
                      <span className="amp-training-week-session-row-label">
                        {session.eventType === "match" ? (session.scopeLabel || session.label) : session.label}
                      </span>
                      {session.eventType === "match" && (
                        <span className="amp-training-week-session-row-meta">
                          {session.isHome ? "Домакин" : "Гост"}
                        </span>
                      )}
                      {session.eventType !== "match" && session.limitedSpots && (
                        <span
                          className="amp-training-week-session-row-meta"
                          title={`Ограничени места: ${session.limitedSpots.registeredCount} от ${session.limitedSpots.maxSpots} записани`}
                        >
                          {session.limitedSpots.registeredCount}/{session.limitedSpots.maxSpots} места
                        </span>
                      )}
                    </div>
                    <span
                      className={`amp-training-week-session-row-badge${
                        session.eventType === "match" ? " amp-training-week-session-row-badge--match" : ""
                      }`}
                      style={badgeStyle}
                      aria-hidden="true"
                    >
                      {session.eventType === "match" ? "М" : "Т"}
                    </span>
                    {onDateClick && (
                      <span className="amp-training-week-session-row-info" aria-hidden="true">i</span>
                    )}
                  </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main Page ── */
function getMonthKeyFromIsoDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : getTodayIsoDate().slice(0, 7);
}

function addMonthsToMonthKey(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map((value) => Number.parseInt(value, 10));
  const base = new Date(Date.UTC(Number.isInteger(year) ? year : 1970, Number.isInteger(month) ? month - 1 : 0, 1));
  base.setUTCMonth(base.getUTCMonth() + delta);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getCalendarDatesForMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map((value) => Number.parseInt(value, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) =>
    `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  );
}

interface GuideStep {
  id: string;
  title: string;
  description: string;
  adminOnly?: boolean;
  icon: string;
}

const ALL_GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Добре дошли в Наръчника',
    description: 'Това ръководство ще ви запознае с всички функции на страницата. Използвайте бутоните „Назад“ и „Напред“, за да преминавате между стъпките. В края ще намерите списък с всички теми, за да се върнете бързо към нужната.',
    icon: "<path d='M4 19.5A2.5 2.5 0 016.5 17H20'/><path d='M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z'/>",
  },
  {
    id: 'cards',
    title: 'Картичките на спортистите',
    description: 'Всяка картичка показва снимка, пълно име и статус на плащане. Зелено = платено. Жълто = предупреждение (текущият месец не е платен). Червено = просрочено (два или повече месеца неплатени). Търсете по горните полета и филтрирайте по отбор или група.',
    icon: "<rect x='1' y='4' width='22' height='16' rx='2' ry='2'/><line x1='1' y1='10' x2='23' y2='10'/><line x1='6' y1='15' x2='10' y2='15'/>",
  },
  {
    id: 'add-member',
    title: 'Добавяне на нов спортист',
    description: 'Зеленият бутон „Добави състезател” отваря регистрационна форма. Попълнете: пълно име, дата на раждане, статус, телефон на родител (задължително), телефон на състезател (по желание), начален месец на таксуване, номер в отбора и снимка. Кодът на картата се генерира автоматично.',
    icon: "<path d='M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2'/><circle cx='8.5' cy='7' r='4'/><line x1='20' y1='8' x2='20' y2='14'/><line x1='23' y1='11' x2='17' y2='11'/>",
  },
  {
    id: 'member-details',
    title: 'Детайли на спортиста',
    description: 'Кликнете върху картичка, за да отворите детайлите на спортиста. Виждате статус, активна карта, телефони, последно плащане и история на плащанията. Тук можете да назначите спортиста към треньорска група, да напишете бележка (вижда се само от треньора) и да редактирате данните му.',
    icon: "<path d='M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2'/><circle cx='12' cy='7' r='4'/>",
  },
  {
    id: 'member-profile',
    title: 'Клубна карта на спортиста',
    description: 'Натиснете бутона „Профил" върху картичката на спортиста, за да отворите личната му страница. Тук се отбелязват плащания, вижда се графикът на тренировките и може да се архивира спортистът. Това е същата страница, която се отваря при сканиране на картата.',
    icon: "<rect x='2' y='3' width='20' height='14' rx='2'/><path d='M8 21h8m-4-4v4'/>",
  },
  {
    id: 'monthly-fee',
    title: 'Месечна такса',
    description: 'Бутонът „Месечна такса“ задава стандартния размер на членската такса за клуба. При нужда може да се зададе индивидуална такса за конкретен спортист при редактиране на профила му.',
    icon: "<line x1='12' y1='1' x2='12' y2='23'/><path d='M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6'/>",
  },
  {
    id: 'groups',
    title: 'Настройки на групите',
    description: 'Бутонът „Групи“ управлява режима на тренировъчните групи: по набори (по годишнини) или по персонализирани групи с избран цвят. Тук се създават, редактират и изтриват групи.',
    adminOnly: true,
    icon: "<path d='M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 00-3-3.87'/><path d='M16 3.13a4 4 0 010 7.75'/>",
  },
  {
    id: 'subgroup',
    title: 'Създаване на група',
    description: 'Бутонът „Създай / редактирай група” отваря формата за нова група или редактиране на съществуваща. Въведете име, изберете цвят и добавете желаните спортисти. Групите се използват за по-фино разделение в рамките на отбора — например сутрешна и вечерна група.',
    icon: "<circle cx='12' cy='12' r='10'/><line x1='12' y1='8' x2='12' y2='16'/><line x1='8' y1='12' x2='16' y2='12'/>",
  },
  {
    id: 'coaches',
    title: 'Управление на треньори',
    description: 'Бутонът „Треньори“ задава кои спортисти са достъпни за всеки треньорски акаунт. Всеки треньор вижда само назначената му група. Тук добавяте и управлявате треньорски групи.',
    adminOnly: true,
    icon: "<circle cx='12' cy='8' r='6'/><path d='M15.477 12.89L17 22l-5-3-5 3 1.523-9.11'/>",
  },
  {
    id: 'schedule',
    title: 'График на тренировките',
    description: 'Бутонът „График“ отваря тренировъчния календар. Тук добавяте тренировъчни дни по седмица, задавате часове и терени, и планирате паузи или извънредни тренировки. Промените се отразяват на всички устройства на спортистите.',
    icon: "<rect x='3' y='4' width='18' height='18' rx='2' ry='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/>",
  },
  {
    id: 'attendance',
    title: 'Присъствия на тренировки',
    description: 'Бутонът „Присъствия“ отваря справка с мрежа от спортисти и тренировъчни дати. Можете да филтрирате по период, треньор и група, и да отпечатате справката. За да редактирате присъствията, натиснете „Редактирай“ — клетките стават кликаеми и можете да превключвате присъствие/отсъствие.',
    icon: "<polyline points='9 11 12 14 22 4'/><path d='M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'/>",
  },
  {
    id: 'notifications-settings',
    title: 'Настройки на напомнянията',
    description: 'Бутонът „Напомняния“ управлява автоматичните напомняния за плащане. Можете да настроите до две месечни напомняния (ден и час) и отделно напомняне за просрочени. Спортистите получават известие на телефона или компютъра си, ако са го активирали от личната си страница.',
    icon: "<path d='M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9'/><path d='M13.73 21a2 2 0 01-3.46 0'/>",
  },
  {
    id: 'message',
    title: 'Изпращане на съобщение',
    description: 'Бутонът „Съобщение“ позволява да изпратите персонализирано push известие до избрани спортисти или цели групи. Съобщението се появява на телефона или компютъра им веднага.',
    icon: "<path d='M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z'/>",
  },
  {
    id: 'reports',
    title: 'Отчети',
    description: 'Бутонът „Отчети“ показва финансова статистика за избран месец: брой платили, в предупреждение и просрочени. Подходящ за проверка преди родителска среща или при отчитане на приходите.',
    icon: "<line x1='18' y1='20' x2='18' y2='10'/><line x1='12' y1='20' x2='12' y2='4'/><line x1='6' y1='20' x2='6' y2='14'/>",
  },
  {
    id: 'import-sheets',
    title: 'Импорт от Google Sheets',
    description: 'Бутонът „Импорт“ позволява да заредите списък спортисти от Google Таблица. Посочете URL на таблицата и системата ще импортира имена, дати на раждане и номера в отбора автоматично. Удобно при прехвърляне от стара система.',
    adminOnly: true,
    icon: "<path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><polyline points='14 2 14 8 20 8'/><line x1='16' y1='13' x2='8' y2='13'/><line x1='16' y1='17' x2='8' y2='17'/>",
  },
  {
    id: 'import-photos',
    title: 'Импорт на снимки от Drive',
    description: 'Бутонът „Снимки“ зарежда снимки от Google Drive масово. Снимките трябва да са именувани по код на картата или пълно име — системата ги свързва автоматично с профилите.',
    adminOnly: true,
    icon: "<rect x='3' y='3' width='18' height='18' rx='2' ry='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/>",
  },
  {
    id: 'excel',
    title: 'Изтегляне на Excel',
    description: 'Бутонът „Excel“ изтегля актуален списък на всички активни спортисти като .xlsx файл, включващ имена, рождени дати, телефони и статуси на плащане. Удобно за архив или споделяне.',
    adminOnly: true,
    icon: "<path d='M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/>",
  },
  {
    id: 'inactive',
    title: 'Неактивни спортисти',
    description: 'Бутонът „Неактивни“ показва деактивираните спортисти. Можете да ги върнете в активния списък или да ги изтриете трайно от базата данни. Деактивирането не изтрива данните — просто ги скрива от основния списък.',
    adminOnly: true,
    icon: "<path d='M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2'/><circle cx='8.5' cy='7' r='4'/><line x1='18' y1='8' x2='23' y2='13'/><line x1='23' y1='8' x2='18' y2='13'/>",
  },
  {
    id: 'links',
    title: 'Изтегляне на линкове',
    description: 'Бутонът „Линкове“ изтегля текстов файл с персоналните URL адреси на всички спортисти — за разпечатване или изпращане. Всеки линк отваря личната страница на спортиста (за NFC карта или QR код).',
    adminOnly: true,
    icon: "<path d='M15 7h3a5 5 0 015 5 5 5 0 01-5 5h-3m-6 0H6a5 5 0 01-5-5 5 5 0 015-5h3'/><line x1='8' y1='12' x2='16' y2='12'/>",
  },
  {
    id: 'payment-workflow',
    title: 'Метод на плащане',
    description: 'Бутонът „Метод плащане“ избира как се изчисляват месечните такси: по календарен месец (стандартно) или Rolling 30 дни — 30 дни след датата на последното плащане. Промяната засяга статусите на всички спортисти.',
    adminOnly: true,
    icon: "<polyline points='23 4 23 10 17 10'/><polyline points='1 20 1 14 7 14'/><path d='M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15'/>",
  },
  {
    id: 'billing',
    title: 'Абонамент и такси',
    description: 'Бутонът „Такси“ показва информация за абонамента на клуба в платформата и историята на фактурирането.',
    adminOnly: true,
    icon: "<path d='M20 12V22H4V12'/><path d='M22 7H2v5h20V7z'/><path d='M12 22V7'/><path d='M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z'/><path d='M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z'/>",
  },
  {
    id: 'edit-team',
    title: 'Редактиране на отбора',
    description: 'Бутонът „Редактирай“ отваря настройките на отбора: промяна на логото, името, вида спорт и конфигурация. Тук се управляват и основните данни на клуба като стандартни времена за тренировки и терени.',
    adminOnly: true,
    icon: "<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z'/>",
  },
];


function AdminMembersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = searchParams.get("clubId") ?? "";
  const coachGroupId = searchParams.get("coachGroupId") ?? "";
  const [coachGroups, setCoachGroups] = useState<CoachGroup[]>([]);
  const [coachGroupsPanelOpen, setCoachGroupsPanelOpen] = useState(false);
  const [coachGroupCreateName, setCoachGroupCreateName] = useState("");
  const [coachGroupCreateError, setCoachGroupCreateError] = useState("");
  const [coachGroupCreateSaving, setCoachGroupCreateSaving] = useState(false);
  const [coachGroupDeleteId, setCoachGroupDeleteId] = useState<string | null>(null);
  const [coachGroupDeleteSaving, setCoachGroupDeleteSaving] = useState(false);
  const [coachGroupCopiedId, setCoachGroupCopiedId] = useState<string | null>(null);
  const [coachGroupEditId, setCoachGroupEditId] = useState<string | null>(null);
  const [coachGroupEditName, setCoachGroupEditName] = useState("");
  const [coachGroupEditSaving, setCoachGroupEditSaving] = useState(false);
  const [coachGroupEditError, setCoachGroupEditError] = useState("");
  const [memberCoachGroupAssignMemberId, setMemberCoachGroupAssignMemberId] = useState<string | null>(null);
  const [memberCoachGroupAssignValue, setMemberCoachGroupAssignValue] = useState<string[] | null>(null);
  const [memberCoachGroupAssignSaving, setMemberCoachGroupAssignSaving] = useState(false);
  const [memberCoachGroupAssignError, setMemberCoachGroupAssignError] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCoach, setIsCoach] = useState(false);
  const [isClubPushSupported, setIsClubPushSupported] = useState(true);
  const [isClubPushSubscribed, setIsClubPushSubscribed] = useState(false);
  const [clubPushBusy, setClubPushBusy] = useState(false);
  const [clubPushStatusMessage, setClubPushStatusMessage] = useState("");
  const [clubPushErrorMessage, setClubPushErrorMessage] = useState("");
  const [isClubIPhone, setIsClubIPhone] = useState(false);
  const [isClubStandalone, setIsClubStandalone] = useState(false);
  const [showClubIphoneGuide, setShowClubIphoneGuide] = useState(false);
  const [clubNotificationsPanelOpen, setClubNotificationsPanelOpen] = useState(false);
  const [clubNotificationsLoading, setClubNotificationsLoading] = useState(false);
  const [clubNotifications, setClubNotifications] = useState<MemberNotification[]>([]);
  const [clubNotificationsUnreadCount, setClubNotificationsUnreadCount] = useState(0);
  const [clubNotificationsDateFilter, setClubNotificationsDateFilter] = useState("");
  const [clubNotificationsScopeType, setClubNotificationsScopeType] = useState<"team" | "trainingGroup" | "admin">("team");
  const [clubNotificationsScopeValue, setClubNotificationsScopeValue] = useState("all");
  const [lastHandledCoachPushOpenTs, setLastHandledCoachPushOpenTs] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const [trainingGroupScope, setTrainingGroupScope] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberToEdit, setMemberToEdit] = useState<Member | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeletingMember, setIsDeletingMember] = useState(false);
  const [editError, setEditError] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [editForm, setEditForm] = useState({
    fullName: "",
    clubId: "",
    teamGroup: "",
    jerseyNumber: "",
    parentPhone: "",
    playerPhone: "",
    birthDate: "",
    paymentAmount: "",
    avatarUrl: "",
    imageUrl: "",
    imagePublicId: "",
  });
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreviewUrl, setEditAvatarPreviewUrl] = useState("");
  const [clubName, setClubName] = useState("Всички отбори");
  const [clubSport, setClubSport] = useState("");
  const [clubBillingStatus, setClubBillingStatus] = useState<string>("");
  type PaymentWorkflow = "calendar_month" | "rolling_30_days" | "training_credits" | "training_credits_30_days";
  const [clubPaymentWorkflow, setClubPaymentWorkflow] = useState<PaymentWorkflow>("calendar_month");
  const [paymentWorkflowModalOpen, setPaymentWorkflowModalOpen] = useState(false);
  const [paymentWorkflowDraft, setPaymentWorkflowDraft] = useState<PaymentWorkflow>("calendar_month");
  const [paymentWorkflowSaving, setPaymentWorkflowSaving] = useState(false);
  const [paymentWorkflowError, setPaymentWorkflowError] = useState("");
  const [paymentWorkflowSuccess, setPaymentWorkflowSuccess] = useState("");
  const [clubDefaultPaymentAmount, setClubDefaultPaymentAmount] = useState("");
  const [paymentAmountModalOpen, setPaymentAmountModalOpen] = useState(false);
  const [paymentAmountForm, setPaymentAmountForm] = useState("");
  const [paymentAmountSaving, setPaymentAmountSaving] = useState(false);
  const [paymentAmountError, setPaymentAmountError] = useState("");
  const [paymentAmountSuccess, setPaymentAmountSuccess] = useState("");
  const [clubLogoUrl, setClubLogoUrl] = useState<string | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [attendanceDashboardOpen, setAttendanceDashboardOpen] = useState(false);
  const [editingClub, setEditingClub] = useState<ClubOption | null>(null);
  const [clubEditForm, setClubEditForm] = useState({
    name: "",
    emblemUrl: "",
    imageUrl: "",
    imagePublicId: "",
  });
  const [clubEditImageFile, setClubEditImageFile] = useState<File | null>(null);
  const [clubEditPreviewUrl, setClubEditPreviewUrl] = useState<string | null>(null);
  const [isSavingClub, setIsSavingClub] = useState(false);
  const [clubEditError, setClubEditError] = useState("");
  const [isNewCardConfirmOpen, setIsNewCardConfirmOpen] = useState(false);
  const [isAssigningNewCard, setIsAssigningNewCard] = useState(false);
  const [inactivePlayersOpen, setInactivePlayersOpen] = useState(false);
  const [reactivatingMemberId, setReactivatingMemberId] = useState<string | null>(null);
  const [deletingPermanentMemberId, setDeletingPermanentMemberId] = useState<string | null>(null);
  const [memberToPermanentDelete, setMemberToPermanentDelete] = useState<Member | null>(null);
  const [inactiveActionError, setInactiveActionError] = useState("");
  const [isDeletingTeam, setIsDeletingTeam] = useState(false);
  const [isTeamDeleteConfirmOpen, setIsTeamDeleteConfirmOpen] = useState(false);
  const [schedulerSettingsOpen, setSchedulerSettingsOpen] = useState(false);
  const [schedulerSettingsLoading, setSchedulerSettingsLoading] = useState(false);
  const [schedulerSettingsSaving, setSchedulerSettingsSaving] = useState(false);
  const [schedulerSettingsError, setSchedulerSettingsError] = useState("");
  const [secondReminderEnabled, setSecondReminderEnabled] = useState(false);
  const [thirdReminderEnabled, setThirdReminderEnabled] = useState(false);
  const [schedulerForm, setSchedulerForm] = useState({
    reminderDay: "25",
    overdueDay: "1",
    reminderHour: "10",
    reminderMinute: "0",
    secondReminderDay: "",
    secondReminderHour: "10",
    secondReminderMinute: "0",
    thirdReminderDay: "",
    thirdReminderHour: "10",
    thirdReminderMinute: "0",
    overdueHour: "10",
    overdueMinute: "0",
    trainingDates: [] as string[],
    trainingTime: "",
    trainingDurationMinutes: String(DEFAULT_TRAINING_DURATION_MINUTES),
    trainingFieldId: "",
    trainingFieldPieceIds: [] as string[],
  });
  const [trainingDateTimes, setTrainingDateTimes] = useState<Record<string, string>>({});
  const [trainingFieldSelections, setTrainingFieldSelections] = useState<Record<string, TrainingFieldSelection>>({});
  const [trainingDaysInitialDateTimes, setTrainingDaysInitialDateTimes] = useState<Record<string, string>>({});
  const [trainingDaysInitialFieldSelections, setTrainingDaysInitialFieldSelections] = useState<Record<string, TrainingFieldSelection>>({});
  const [trainingTimeMode, setTrainingTimeMode] = useState<TrainingTimeMode>("all");
  const reminderTimeValue = `${schedulerForm.reminderHour.padStart(2, "0")}:${schedulerForm.reminderMinute.padStart(2, "0")}`;
  const secondReminderTimeValue = `${schedulerForm.secondReminderHour.padStart(2, "0")}:${schedulerForm.secondReminderMinute.padStart(2, "0")}`;
  const thirdReminderTimeValue = `${schedulerForm.thirdReminderHour.padStart(2, "0")}:${schedulerForm.thirdReminderMinute.padStart(2, "0")}`;
  const overdueTimeValue = `${schedulerForm.overdueHour.padStart(2, "0")}:${schedulerForm.overdueMinute.padStart(2, "0")}`;
  const [trainingAttendanceOpen, setTrainingAttendanceOpen] = useState(false);
  /** Club members page without `coachGroupId`: show week list only (hide «Отбори» tab). */
  const [trainingAttendanceHideTeamsTab, setTrainingAttendanceHideTeamsTab] = useState(false);
  const [schedulerCalendarVisibleMonthIdx, setSchedulerCalendarVisibleMonthIdx] = useState(0);
  const [matchCalendarVisibleMonthIdx, setMatchCalendarVisibleMonthIdx] = useState(0);
  const [trainingAttendanceView, setTrainingAttendanceView] = useState<"teamGroup" | "trainingGroups" | "today">("today");
  const [trainingAttendanceLoading, setTrainingAttendanceLoading] = useState(false);
  const [trainingAttendanceError, setTrainingAttendanceError] = useState("");
  const [trainingAttendanceDate, setTrainingAttendanceDate] = useState(getTodayIsoDate());
  const [trainingAttendanceMonth, setTrainingAttendanceMonth] = useState(getTodayIsoDate().slice(0, 7));
  const [trainingAttendancePlayers, setTrainingAttendancePlayers] = useState<TrainingAttendancePlayer[]>([]);
  const [trainingAttendanceStats, setTrainingAttendanceStats] = useState({
    total: 0,
    attending: 0,
    optedOut: 0,
  });
  const [trainingUpcomingDates, setTrainingUpcomingDates] = useState<TrainingUpcomingDateItem[]>([]);
  const [trainingWeekSessions, setTrainingWeekSessions] = useState<TrainingWeekSessionItem[]>([]);
  const [trainingWeekDates, setTrainingWeekDates] = useState<string[]>([]);
  const [trainingWeekLoading, setTrainingWeekLoading] = useState(false);
  const [weekColorFilter, setWeekColorFilter] = useState<string | null>(null);
  const [trainingNote, setTrainingNote] = useState("");
  const [trainingNoteSaving, setTrainingNoteSaving] = useState(false);
  const [trainingNoteTargetDates, setTrainingNoteTargetDates] = useState<string[]>([]);
  const [trainingBulkNoteOpen, setTrainingBulkNoteOpen] = useState(false);
  const [trainingNotesByDate, setTrainingNotesByDate] = useState<Record<string, string>>({});
  const [trainingNoteComparisonLoading, setTrainingNoteComparisonLoading] = useState(false);
  const [trainingDayDetailsOpen, setTrainingDayDetailsOpen] = useState(false);
  const [trainingDayDetailsOpening, setTrainingDayDetailsOpening] = useState(false);
  const [trainingDayDetailsViewSnapshot, setTrainingDayDetailsViewSnapshot] = useState<"teamGroup" | "trainingGroups" | "today">("today");
  const [trainingDayDurationMinutes, setTrainingDayDurationMinutes] = useState(DEFAULT_TRAINING_DURATION_MINUTES);
  const [trainingDayTime, setTrainingDayTime] = useState<string | null>(null);
  const [trainingDayField, setTrainingDayField] = useState<{ id: string; name: string; fieldType: string; pieces: { id: string; name: string }[] } | null>(null);
  const [trainingDayFieldPieceIds, setTrainingDayFieldPieceIds] = useState<string[]>([]);
  const [trainingPlayersExpanded, setTrainingPlayersExpanded] = useState(false);
  const [trainingDaysEditorOpen, setTrainingDaysEditorOpen] = useState(false);
  const [trainingDaysEditorLoading, setTrainingDaysEditorLoading] = useState(false);
  const [trainingDaysEditorSaving, setTrainingDaysEditorSaving] = useState(false);
  const [trainingDaysEditorError, setTrainingDaysEditorError] = useState("");
  const [trainingDaysPreExistingDates, setTrainingDaysPreExistingDates] = useState<string[]>([]);
  const [trainingDaysSingleEditDate, setTrainingDaysSingleEditDate] = useState<string | null>(null);
  const [scheduleEventModalOpen, setScheduleEventModalOpen] = useState(false);
  const [scheduleEventStep, setScheduleEventStep] = useState<"type" | "match-days" | "match-details">("type");
  const [matchEditorSaving, setMatchEditorSaving] = useState(false);
  const [matchEditorError, setMatchEditorError] = useState("");
  const [matchSelectedDates, setMatchSelectedDates] = useState<string[]>([]);
  const [matchDetailsPerDay, setMatchDetailsPerDay] = useState<Record<string, { opponent: string; location: string; time: string; duration: string; isHome: boolean | null }>>({});
  const [matchTeamGroups, setMatchTeamGroups] = useState<number[]>([]);
  const [matchExistingIdByDate, setMatchExistingIdByDate] = useState<Record<string, string>>({});
  const [clubMatches, setClubMatches] = useState<ClubMatch[]>([]);
  const [matchViewPopupOpen, setMatchViewPopupOpen] = useState(false);
  const [matchViewMatch, setMatchViewMatch] = useState<ClubMatch | null>(null);
  const [matchEditTarget, setMatchEditTarget] = useState<ClubMatch | null>(null);
  const [dayDetailsMatchEditOpen, setDayDetailsMatchEditOpen] = useState(false);
  const [dayDetailsMatchEditForm, setDayDetailsMatchEditForm] = useState<{ opponent: string; location: string; matchDate: string; matchTime: string; durationMinutes: string; isHome: boolean; customGroupId: string | null }>({ opponent: "", location: "", matchDate: "", matchTime: "", durationMinutes: "90", isHome: true, customGroupId: null });
  const [dayDetailsMatchSaving, setDayDetailsMatchSaving] = useState(false);
  const [dayDetailsMatchDeleteConfirm, setDayDetailsMatchDeleteConfirm] = useState(false);
  const [dayDetailsMatchError, setDayDetailsMatchError] = useState("");
  const [trainingDayDetailsTab, setTrainingDayDetailsTab] = useState<string>("training");
  const [trainingDayDetailsTabLoading, setTrainingDayDetailsTabLoading] = useState(false);
  const [trainingDaySessionCancelled, setTrainingDaySessionCancelled] = useState(false);
  const [trainingDayCancelLoading, setTrainingDayCancelLoading] = useState(false);
  const [trainingDayCancelConfirmOpen, setTrainingDayCancelConfirmOpen] = useState(false);
  const [limitedEvent, setLimitedEvent] = useState<LimitedEventDetail | null>(null);
  const [limitedEventLoading, setLimitedEventLoading] = useState(false);
  const [limitedSpotsInput, setLimitedSpotsInput] = useState("10");
  const [showLimitedForm, setShowLimitedForm] = useState(false);
  const [limitedEventSaving, setLimitedEventSaving] = useState(false);
  const [limitedEventError, setLimitedEventError] = useState("");
  const [trainingDaysActiveStep, setTrainingDaysActiveStep] = useState<TrainingDaysStep>("days");
  const [schedulerLimitedMode, setSchedulerLimitedMode] = useState(false);
  const [schedulerLimitedSpots, setSchedulerLimitedSpots] = useState("10");
  const [schedulerPerDayLimited, setSchedulerPerDayLimited] = useState(false);
  const [schedulerPerDayConfig, setSchedulerPerDayConfig] = useState<Record<string, { limited: boolean; spots: string }>>({});
  const [trainingFieldActiveDate, setTrainingFieldActiveDate] = useState("");
  const [trainingDaysInitialDates, setTrainingDaysInitialDates] = useState<string[]>([]);
  const [trainingDaysInitialDurationMinutes, setTrainingDaysInitialDurationMinutes] = useState(DEFAULT_TRAINING_DURATION_MINUTES);
  const [trainingDaysInitialFieldId, setTrainingDaysInitialFieldId] = useState("");
  const [trainingDaysInitialFieldPieceIds, setTrainingDaysInitialFieldPieceIds] = useState<string[]>([]);
  const [trainingDaysSuccessOpen, setTrainingDaysSuccessOpen] = useState(false);
  const [trainingDaysSuccessMessage, setTrainingDaysSuccessMessage] = useState("");
  const [trainingDayScheduleNotes, setTrainingDayScheduleNotes] = useState<Record<string, string>>({});
  const [trainingGroupMode, setTrainingGroupMode] = useState<"team_group" | "custom_group">("team_group");
  const [trainingGroupModeDraft, setTrainingGroupModeDraft] = useState<"team_group" | "custom_group">("team_group");
  const [trainingGroupModeSettingsOpen, setTrainingGroupModeSettingsOpen] = useState(false);
  const [trainingGroupModeSaving, setTrainingGroupModeSaving] = useState(false);
  const [trainingGroupModeError, setTrainingGroupModeError] = useState("");
  const [trainingDaysEditorMode, setTrainingDaysEditorMode] = useState<"teamGroup" | "createGroup" | "trainingGroup" | "customGroup" | "coachGroup">("teamGroup");
  const [trainingDaysEditorGroups, setTrainingDaysEditorGroups] = useState<string[]>([]);
  const [trainingDaysEditorGroupName, setTrainingDaysEditorGroupName] = useState("");
  const [trainingDaysEditorCreateOpen, setTrainingDaysEditorCreateOpen] = useState(false);
  const [trainingGroupCreateOpen, setTrainingGroupCreateOpen] = useState(false);
  const [trainingGroupCreateStep, setTrainingGroupCreateStep] = useState<"picker" | "create" | "edit-pick">("picker");
  const [trainingGroupEditPickId, setTrainingGroupEditPickId] = useState("");
  const [trainingGroupCreateSaving, setTrainingGroupCreateSaving] = useState(false);
  const [trainingGroupCreateError, setTrainingGroupCreateError] = useState("");
  const [trainingGroupCreateGroups, setTrainingGroupCreateGroups] = useState<string[]>([]);
  const [trainingGroupCreateName, setTrainingGroupCreateName] = useState("");
  const [trainingGroupCreatePlayerIds, setTrainingGroupCreatePlayerIds] = useState<string[]>([]);
  const [trainingGroupCreateColor, setTrainingGroupCreateColor] = useState("");
  const [customGroupCreateSearch, setCustomGroupCreateSearch] = useState("");
  const [trainingGroupEditOpen, setTrainingGroupEditOpen] = useState(false);
  const [trainingGroupEditSaving, setTrainingGroupEditSaving] = useState(false);
  const [trainingGroupEditError, setTrainingGroupEditError] = useState("");
  const [trainingGroupDeleteConfirmOpen, setTrainingGroupDeleteConfirmOpen] = useState(false);
  const [trainingGroupDeleteSaving, setTrainingGroupDeleteSaving] = useState(false);
  const [trainingGroupEditId, setTrainingGroupEditId] = useState("");
  const [trainingGroupEditName, setTrainingGroupEditName] = useState("");
  const [trainingGroupEditGroups, setTrainingGroupEditGroups] = useState<string[]>([]);
  const [trainingGroupEditPlayerIds, setTrainingGroupEditPlayerIds] = useState<string[]>([]);
  const [trainingGroupEditColor, setTrainingGroupEditColor] = useState("");
  const [customGroupEditSearch, setCustomGroupEditSearch] = useState("");
  const [selectedTrainingGroupId, setSelectedTrainingGroupId] = useState("");
  const [postTeamGroupSavePromptOpen, setPostTeamGroupSavePromptOpen] = useState(false);
  const [postTeamGroupSavePromptGroupId, setPostTeamGroupSavePromptGroupId] = useState("");
  const [postTeamGroupSavePromptGroupName, setPostTeamGroupSavePromptGroupName] = useState("");
  const [teamGroupWarningModalOpen, setTeamGroupWarningModalOpen] = useState(false);
  const [pendingTeamGroupWarningGroups, setPendingTeamGroupWarningGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [importSheetsOpen, setImportSheetsOpen] = useState(false);
  const [importPhotosOpen, setImportPhotosOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [rulesDocs, setRulesDocs] = useState<{ id: string; name: string }[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesUploading, setRulesUploading] = useState(false);
  const [rulesDeletingId, setRulesDeletingId] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [guideImgExpanded, setGuideImgExpanded] = useState(false);
  const [guideImgScale, setGuideImgScale] = useState(1);
  const [guideImgPos, setGuideImgPos] = useState({ x: 0, y: 0 });
  const guideImgTouchRef = useRef<{ startDist: number; startScale: number; startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const [notifyPanelOpen, setNotifyPanelOpen] = useState(false);
  const [coachMessageOpen, setCoachMessageOpen] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifySelectedIds, setNotifySelectedIds] = useState<Set<string>>(new Set());
  const [notifySearchTerm, setNotifySearchTerm] = useState("");
  const [notifyGroupFilter, setNotifyGroupFilter] = useState("all");
  const [notifyCoachGroupFilter, setNotifyCoachGroupFilter] = useState("");
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyError, setNotifyError] = useState("");
  const [notifySuccess, setNotifySuccess] = useState("");
  const [bulkCoachGroupTargetId, setBulkCoachGroupTargetId] = useState<string | null>(null);
  const [bulkCoachGroupAllMembers, setBulkCoachGroupAllMembers] = useState<Member[]>([]);
  const [bulkCoachGroupLoadingMembers, setBulkCoachGroupLoadingMembers] = useState(false);
  const [bulkCoachGroupSelectedIds, setBulkCoachGroupSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCoachGroupInitialIds, setBulkCoachGroupInitialIds] = useState<Set<string>>(new Set());
  const [bulkCoachGroupSearchTerm, setBulkCoachGroupSearchTerm] = useState("");
  const [bulkCoachGroupBusy, setBulkCoachGroupBusy] = useState(false);
  const [bulkCoachGroupError, setBulkCoachGroupError] = useState("");
  const [bulkCoachGroupSaved, setBulkCoachGroupSaved] = useState(false);
  const [trainingScheduleGroupsLoading, setTrainingScheduleGroupsLoading] = useState(false);
  const [trainingScheduleGroups, setTrainingScheduleGroups] = useState<TrainingScheduleGroup[]>([]);
  const [customTrainingGroups, setCustomTrainingGroups] = useState<CustomTrainingGroup[]>([]);
  const [trainingFields, setTrainingFields] = useState<TrainingField[]>([]);
  const [trainingFieldsLoading, setTrainingFieldsLoading] = useState(false);
  const [fieldConflictsMap, setFieldConflictsMap] = useState<Record<string, { blockedPieceIds: string[]; wholeFieldBlocked: boolean }>>({});
  const [fieldConflictsLoading, setFieldConflictsLoading] = useState(false);
  const [trainingFieldModalOpen, setTrainingFieldModalOpen] = useState(false);
  const [trainingFieldSaving, setTrainingFieldSaving] = useState(false);
  const [trainingFieldError, setTrainingFieldError] = useState("");
  const [trainingFieldEditId, setTrainingFieldEditId] = useState<string | null>(null);
  const [trainingFieldName, setTrainingFieldName] = useState("");
  const [trainingFieldType, setTrainingFieldType] = useState("football");
  const [trainingFieldPieces, setTrainingFieldPieces] = useState<Array<{ id: string | null; name: string }>>([]);
  const schedulerCalendarDates = getNextTrainingCalendarDates();
  const schedulerCalendarDateSet = new Set(schedulerCalendarDates);
  const schedulerCalendarMonths = buildCalendarMonths(schedulerCalendarDates);
  const matchCalendarDates = getNextTrainingCalendarDates(30);
  const matchCalendarDateSet = new Set(matchCalendarDates);
  const matchCalendarMonths = buildCalendarMonths(matchCalendarDates);
  const trimCalendarMonthCells = (months: ReturnType<typeof buildCalendarMonths>, fromDate: string) =>
    months.map((m) => {
      const firstIdx = m.cells.findIndex((d) => d !== null && d >= fromDate);
      return { ...m, cells: m.cells.slice(firstIdx >= 0 ? Math.floor(firstIdx / 7) * 7 : 0) };
    });
  const schedulerCalendarMonthsTrimmed = trimCalendarMonthCells(schedulerCalendarMonths, getTodayIsoDate());
  const matchCalendarMonthsTrimmed = trimCalendarMonthCells(matchCalendarMonths, getTodayIsoDate());
  const matchCalendarMatchesByDate = new Map<string, ClubMatch[]>();
  for (const match of clubMatches) {
    if (!matchCalendarDateSet.has(match.matchDate)) continue;
    const matchesForDate = matchCalendarMatchesByDate.get(match.matchDate) ?? [];
    matchesForDate.push(match);
    matchCalendarMatchesByDate.set(match.matchDate, matchesForDate);
  }
  const trainingUpcomingDateSet = new Set(trainingUpcomingDates.map((item) => item.date));
  const trainingUpcomingByDate = new Map(trainingUpcomingDates.map((item) => [item.date, item]));
  const trainingAttendanceCalendarDates = getCalendarDatesForMonth(trainingAttendanceMonth);
  const trainingAttendanceCalendarMonths = buildCalendarMonths(trainingAttendanceCalendarDates);
  const trainingAttendanceCalendarMonthsTrimmed = trimCalendarMonthCells(trainingAttendanceCalendarMonths, getTodayIsoDate());
  const todayIsoDate = getTodayIsoDate();
  const clubNotificationTeamGroups = Array.from(
    new Set(
      clubNotifications
        .map((item) => (typeof item.teamGroup === "number" ? item.teamGroup : null))
        .filter((value): value is number => typeof value === "number"),
    ),
  ).sort((a, b) => a - b);
  const clubNotificationTrainingGroups = Array.from(
    new Map(
      clubNotifications
        .flatMap((item) =>
          Array.isArray(item.trainingGroups)
            ? item.trainingGroups.map((group) => [group.id, group] as const)
            : [],
        ),
    ).values(),
  );
  const filteredClubNotifications = clubNotifications.filter((item) => {
    const notifDate = new Date(item.sentAt).toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });
    if (clubNotificationsDateFilter && notifDate !== clubNotificationsDateFilter) {
      return false;
    }
    if (clubNotificationsScopeType === "admin") {
      return item.type === "admin_message" || item.type === "myteam_message";
    }
    if (clubNotificationsScopeValue !== "all") {
      if (clubNotificationsScopeType === "team") {
        const selectedGroup = Number.parseInt(clubNotificationsScopeValue, 10);
        if (!Number.isInteger(selectedGroup) || item.teamGroup !== selectedGroup) {
          return false;
        }
      } else {
        const hasTrainingGroup = Array.isArray(item.trainingGroups)
          ? item.trainingGroups.some((group) => group.id === clubNotificationsScopeValue)
          : false;
        if (!hasTrainingGroup) {
          return false;
        }
      }
    }
    return true;
  });
  const trainingNoteTeamGroupFilter = parseSelectedTeamGroup(trainingGroupScope);
  const trainingNoteScopeKey =
    trainingAttendanceView === "trainingGroups"
      ? `trainingGroup:${selectedTrainingGroupId || "-"}`
      : `teamGroup:${trainingNoteTeamGroupFilter === null ? "all" : String(trainingNoteTeamGroupFilter)}`;
  const effectiveTrainingNoteTargetDates =
    trainingNoteTargetDates.length > 0
      ? trainingNoteTargetDates
      : trainingAttendanceDate
        ? [trainingAttendanceDate]
        : [];
  const effectiveTrainingNoteTargetDatesKey = effectiveTrainingNoteTargetDates.join("|");
  const isTrainingNoteSameAsExisting =
    effectiveTrainingNoteTargetDates.length > 0 &&
    effectiveTrainingNoteTargetDates.every((date) =>
      Object.prototype.hasOwnProperty.call(trainingNotesByDate, `${trainingNoteScopeKey}|${date}`),
    ) &&
    effectiveTrainingNoteTargetDates.every(
      (date) => (trainingNotesByDate[`${trainingNoteScopeKey}|${date}`] ?? "").trim() === trainingNote.trim(),
    );

  useEffect(() => {
    if (!clubId) return;
    document.cookie = `admin_last_club_id=${encodeURIComponent(clubId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [clubId]);

  useEffect(() => {
    if (!clubId) return;

    const sendPresence = (action: "connect" | "disconnect") => {
      const blob = new Blob(
        [JSON.stringify({ clubId, action })],
        { type: "application/json" }
      );
      try {
        navigator.sendBeacon("/api/admin/track/presence", blob);
      } catch {
        // Presence tracking is best-effort and should not interrupt the admin page.
      }
    };

    const sendConnect = () => {
      sendPresence("connect");
    };

    const sendDisconnect = () => {
      sendPresence("disconnect");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        sendDisconnect();
      } else {
        sendConnect();
      }
    };

    sendConnect();
    window.addEventListener("pagehide", sendDisconnect);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", sendDisconnect);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sendDisconnect();
    };
  }, [clubId]);

  useEffect(() => {
    if (!clubId) {
      setClubNotifications([]);
      setClubNotificationsUnreadCount(0);
      setClubNotificationsDateFilter("");
      setClubNotificationsScopeType("team");
      setClubNotificationsScopeValue("all");
      return;
    }
    void fetchClubNotifications();
  }, [clubId]);

  useEffect(() => {
    if (!clubId) {
      return;
    }

    const streamUrl = `/api/admin/clubs/${encodeURIComponent(clubId)}/notifications/events`;
    const source = new EventSource(streamUrl, { withCredentials: true });

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
      if (type !== "notification-created") {
        return;
      }

      void fetchClubNotifications();
    };

    source.onerror = () => {
      // Let browser auto-reconnect.
    };

    return () => {
      source.close();
    };
  }, [clubId]);

  // Force early layout calculation for group filter dropdown
  useEffect(() => {
    const select = document.querySelector('.amp-content > .amp-edit-field:first-child select');
    if (select) {
      // Trigger a reflow to force browser to calculate dropdown position early
      (select as HTMLSelectElement).focus();
      setTimeout(() => {
        (select as HTMLSelectElement).blur();
      }, 0);
    }
  }, []);

  const closeEditModal = () => {
    setMemberToEdit(null);
    setEditAvatarFile(null);
    setEditAvatarPreviewUrl("");
  };

  const openPaymentAmountModal = () => {
    setPaymentAmountForm(clubDefaultPaymentAmount || "");
    setPaymentAmountError("");
    setPaymentAmountSuccess("");
    setPaymentAmountModalOpen(true);
  };

  const openRulesModal = async () => {
    if (!clubId) return;
    setRulesError("");
    setRulesDocs([]);
    setRulesModalOpen(true);
    setRulesLoading(true);
    try {
      const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/rules`);
      if (res.ok) {
        const data = await res.json() as { documents: { id: string; name: string }[] };
        setRulesDocs(data.documents);
      }
    } catch {
      // non-critical
    } finally {
      setRulesLoading(false);
    }
  };

  const handleRulesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !clubId) return;
    if (file.type !== "application/pdf") { setRulesError("Само PDF файлове са разрешени."); return; }
    if (file.size > 20 * 1024 * 1024) { setRulesError("Файлът е твърде голям (макс. 20 MB)."); return; }
    setRulesError("");
    setRulesUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/rules`, { method: "POST", body: formData });
      const data = await res.json() as { document?: { id: string; name: string }; error?: string };
      if (!res.ok) { setRulesError(data.error ?? "Грешка при качване."); return; }
      if (data.document) setRulesDocs((prev) => [...prev, data.document!]);
    } catch {
      setRulesError("Грешка при качване.");
    } finally {
      setRulesUploading(false);
      e.target.value = "";
    }
  };

  const handleRulesDelete = async (docId: string) => {
    if (!clubId) return;
    setRulesError("");
    setRulesDeletingId(docId);
    try {
      const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/rules/${encodeURIComponent(docId)}`, { method: "DELETE" });
      if (res.ok) { setRulesDocs((prev) => prev.filter((d) => d.id !== docId)); }
      else { const data = await res.json() as { error?: string }; setRulesError(data.error ?? "Грешка при изтриване."); }
    } catch {
      setRulesError("Грешка при изтриване.");
    } finally {
      setRulesDeletingId(null);
    }
  };

  const closePaymentAmountModal = () => {
    if (paymentAmountSaving) return;
    setPaymentAmountModalOpen(false);
    setPaymentAmountError("");
    setPaymentAmountSuccess("");
  };

  const openPaymentWorkflowModal = () => {
    setPaymentWorkflowDraft(clubPaymentWorkflow);
    setPaymentWorkflowError("");
    setPaymentWorkflowSuccess("");
    setPaymentWorkflowModalOpen(true);
  };

  const closePaymentWorkflowModal = () => {
    if (paymentWorkflowSaving) return;
    setPaymentWorkflowModalOpen(false);
    setPaymentWorkflowError("");
    setPaymentWorkflowSuccess("");
  };

  const handleSavePaymentWorkflow = async () => {
    if (!clubId || paymentWorkflowSaving) return;

    setPaymentWorkflowSaving(true);
    setPaymentWorkflowError("");
    setPaymentWorkflowSuccess("");

    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/payment-workflow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentWorkflow: paymentWorkflowDraft }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPaymentWorkflowError(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно запазване на метода за плащане.",
        );
        return;
      }

      setClubPaymentWorkflow(paymentWorkflowDraft);
      setClubs((prev) =>
        prev.map((club) =>
          club.id === clubId ? { ...club, paymentWorkflow: paymentWorkflowDraft } : club,
        ),
      );
      setPaymentWorkflowSuccess("Методът за плащане е обновен за клуба.");
      await refreshMembersList();
    } catch (error) {
      console.error("Payment workflow save error:", error);
      setPaymentWorkflowError("Възникна грешка при запазване на метода за плащане.");
    } finally {
      setPaymentWorkflowSaving(false);
    }
  };

  const handleSavePaymentAmount = async () => {
    if (!clubId || paymentAmountSaving) return;

    const normalizedPaymentAmount = paymentAmountForm.trim().replace(",", ".");
    if (!normalizedPaymentAmount || !/^\d+(\.\d{1,2})?$/.test(normalizedPaymentAmount)) {
      setPaymentAmountError("Въведете валидна сума с до 2 знака след десетичната запетая.");
      return;
    }

    setPaymentAmountSaving(true);
    setPaymentAmountError("");
    setPaymentAmountSuccess("");

    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/payment-amount`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentAmount: normalizedPaymentAmount }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPaymentAmountError(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно запазване на месечната такса.",
        );
        return;
      }

      setClubDefaultPaymentAmount(normalizedPaymentAmount);
      setPaymentAmountSuccess("Месечната такса е обновена за клуба и всички състезатели.");
      setMembers((prev) => prev.map((member) => ({ ...member, paymentAmount: normalizedPaymentAmount })));
    } catch (error) {
      console.error("Payment amount save error:", error);
      setPaymentAmountError("Възникна грешка при запазване на месечната такса.");
    } finally {
      setPaymentAmountSaving(false);
    }
  };

  const handleEnableClubNotifications = async () => {
    setClubPushStatusMessage("");
    setClubPushErrorMessage("");

    if (!clubId || !isClubPushSupported) {
      setClubPushErrorMessage("Този браузър не поддържа push известия или липсва HTTPS.");
      return;
    }

    setClubPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setClubPushErrorMessage("Достъпът до известия е отказан от браузъра.");
        setIsClubPushSubscribed(false);
        return;
      }

      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;

      const publicKeyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
      if (!publicKeyResponse.ok) {
        const payload = await publicKeyResponse.json().catch(() => ({ error: "Missing VAPID configuration" }));
        throw new Error(String(payload.error ?? "Failed to get VAPID public key"));
      }
      const { publicKey } = (await publicKeyResponse.json()) as { publicKey: string };
      const subscription = await getCompatiblePushSubscription(registration, publicKey);

      const saveResponse = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/push-subscriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          ...(coachGroupId ? { coachGroupId } : {}),
        }),
      });

      if (!saveResponse.ok) {
        const payload = await saveResponse.json().catch(() => ({ error: "Failed to save subscription" }));
        throw new Error(String(payload.error ?? "Failed to save subscription"));
      }

      setIsClubPushSubscribed(true);
      const scopeLabel = coachGroupId
        ? (coachGroups.find((g) => g.id === coachGroupId)?.name ?? "тази група треньор")
        : "този отбор";
      setClubPushStatusMessage(`Известията за треньори са активирани за ${scopeLabel}.`);
    } catch (error) {
      console.error("Enable club notifications error:", error);
      setClubPushErrorMessage(error instanceof Error ? error.message : "Неуспешно активиране на известията.");
    } finally {
      setClubPushBusy(false);
    }
  };

  const handleDisableClubNotifications = async () => {
    setClubPushStatusMessage("");
    setClubPushErrorMessage("");

    if (!clubId) {
      return;
    }

    setClubPushBusy(true);
    try {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setIsClubPushSubscribed(false);
        return;
      }

      const endpoint = subscription.endpoint;
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/push-subscriptions`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Failed to disable subscription" }));
        throw new Error(String(payload.error ?? "Failed to disable subscription"));
      }

      setIsClubPushSubscribed(false);
      setClubPushStatusMessage("Известията за треньори са изключени за този отбор.");
    } catch (error) {
      console.error("Disable club notifications error:", error);
      setClubPushErrorMessage(error instanceof Error ? error.message : "Неуспешно изключване на известията.");
    } finally {
      setClubPushBusy(false);
    }
  };

  const fetchClubNotifications = async () => {
    if (!clubId) {
      setClubNotifications([]);
      setClubNotificationsUnreadCount(0);
      return;
    }

    setClubNotificationsLoading(true);
    try {
      const search = new URLSearchParams();
      if (coachGroupId) {
        search.set("coachGroupId", coachGroupId);
      }
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/notifications${search.size ? `?${search.toString()}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      setClubNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
      setClubNotificationsUnreadCount(Number(payload.unreadCount ?? 0));
    } catch (error) {
      console.error("Failed to fetch club notifications:", error);
    } finally {
      setClubNotificationsLoading(false);
    }
  };

  const markClubNotificationsRead = async () => {
    if (!clubId) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/notifications/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(coachGroupId ? { coachGroupId } : {}),
        }),
      });
      if (!response.ok) {
        return;
      }

      const nowIso = new Date().toISOString();
      setClubNotifications((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? nowIso })));
      setClubNotificationsUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark club notifications as read:", error);
    }
  };

  const handleOpenClubNotificationsPanel = async () => {
    setClubNotificationsPanelOpen(true);
    await fetchClubNotifications();
    await markClubNotificationsRead();
  };

  useEffect(() => {
    const pushOpenTs = searchParams.get("pushOpenTs");
    const shouldOpenFromPush =
      searchParams.get("fromPush") === "1" &&
      searchParams.get("openCoachNotifications") === "1" &&
      Boolean(pushOpenTs);

    if (!shouldOpenFromPush || !pushOpenTs || pushOpenTs === lastHandledCoachPushOpenTs) {
      return;
    }

    setLastHandledCoachPushOpenTs(pushOpenTs);
    void handleOpenClubNotificationsPanel();

    const cleanedParams = new URLSearchParams(searchParams.toString());
    cleanedParams.delete("fromPush");
    cleanedParams.delete("openBell");
    cleanedParams.delete("openCoachNotifications");
    cleanedParams.delete("pushOpenTs");
    const cleanedQuery = cleanedParams.toString();
    const cleanPath = "/admin/members";
    router.replace(cleanedQuery ? `${cleanPath}?${cleanedQuery}` : cleanPath, { scroll: false });
  }, [lastHandledCoachPushOpenTs, router, searchParams]);

  const handleDeleteMember = async () => {
    if (!memberToDelete || isDeletingMember) return;

    setIsDeletingMember(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/admin/members/${memberToDelete.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        let message = "Неуспешно премахване на състезател.";
        try {
          const data = await response.json();
          if (typeof data?.error === "string" && data.error.trim()) {
            message = data.error.trim();
          }
        } catch {
          // Keep generic message when response body is not JSON.
        }
        setDeleteError(message);
        return;
      }

      setMembers((prev) =>
        prev.map((member) =>
          member.id === memberToDelete.id
            ? {
              ...member,
              isActive: false,
              cards: member.cards.map((card) => ({ ...card, isActive: false })),
            }
            : member,
        ),
      );
      setSelectedMember((prev) => (prev?.id === memberToDelete.id ? null : prev));
      setMemberToDelete(null);
    } catch (error) {
      console.error("Error removing member:", error);
      setDeleteError("Възникна грешка при премахване на състезател.");
    } finally {
      setIsDeletingMember(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!isAdmin || !clubId || isDeletingTeam) {
      return;
    }

    const displayTeamName = clubName?.trim() || "този отбор";
    setIsDeletingTeam(true);
    try {
      const response = await fetch(`/api/admin/teams/${encodeURIComponent(clubId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно изтриване на отбора.";
        throw new Error(message);
      }

      window.alert(`Отбор "${displayTeamName}" беше изтрит успешно.`);
      setIsTeamDeleteConfirmOpen(false);
      router.push("/admin/players");
    } catch (error) {
      console.error("Error deleting team:", error);
      window.alert(
        error instanceof Error
          ? error.message
          : "Възникна грешка при изтриване на отбора.",
      );
    } finally {
      setIsDeletingTeam(false);
    }
  };

  const openEditMember = async (member: Member) => {
    setEditError("");
    if (clubs.length === 0) {
      try {
        const response = await fetch("/api/admin/clubs", { cache: "no-store" });
        if (response.ok) {
          const clubsPayload: unknown = await response.json();
          const normalizedClubs: ClubOption[] = Array.isArray(clubsPayload)
            ? clubsPayload
              .map((club) => {
                const item =
                  typeof club === "object" && club !== null
                    ? (club as {
                      id?: unknown;
                      name?: unknown;
                      sports?: unknown;
                      emblemUrl?: unknown;
                      imageUrl?: unknown;
                      imagePublicId?: unknown;
                      paymentWorkflow?: unknown;
                    })
                    : {};
                const rawName = String(item.name ?? "").trim();
                return {
                  id: String(item.id ?? ""),
                  name: rawName,
                  sports: typeof item.sports === "string" ? item.sports : null,
                  emblemUrl: typeof item.emblemUrl === "string" ? item.emblemUrl : null,
                  imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
                  imagePublicId: typeof item.imagePublicId === "string" ? item.imagePublicId : null,
                  paymentWorkflow: item.paymentWorkflow === "rolling_30_days"
                    ? ("rolling_30_days" as const)
                    : item.paymentWorkflow === "training_credits"
                      ? ("training_credits" as const)
                      : item.paymentWorkflow === "training_credits_30_days"
                        ? ("training_credits_30_days" as const)
                      : ("calendar_month" as const),
                };
              })
              .filter((club) => club.id && club.name)
            : [];
          setClubs(normalizedClubs);
        }
      } catch (error) {
        console.error("Error loading clubs for edit:", error);
      }
    }
    setMemberToEdit(member);
    setEditAvatarFile(null);
    setEditAvatarPreviewUrl("");
    setMemberCoachGroupAssignValue(null);
    setMemberCoachGroupAssignError("");
    setEditForm({
      fullName: member.fullName,
      clubId: member.club?.id ?? "",
      teamGroup: member.teamGroup !== null ? String(member.teamGroup) : "",
      jerseyNumber: member.jerseyNumber ?? "",
      parentPhone: member.parentPhone ?? "",
      playerPhone: member.playerPhone ?? "",
      birthDate: member.birthDate ? new Date(member.birthDate).toISOString().slice(0, 10) : "",
      paymentAmount: member.paymentAmount ?? "",
      avatarUrl: member.avatarUrl ?? "",
      imageUrl: member.imageUrl ?? "",
      imagePublicId: member.imagePublicId ?? "",
    });
  };

  useEffect(() => {
    if (!editAvatarFile) {
      setEditAvatarPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(editAvatarFile);
    setEditAvatarPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [editAvatarFile]);

  const handleSaveMemberEdit = async () => {
    if (!memberToEdit || isSavingEdit) return;
    const fullName = editForm.fullName.trim();
    if (!fullName) {
      setEditError("Името е задължително.");
      return;
    }
    if (!editForm.clubId) {
      setEditError("Изберете отбор.");
      return;
    }

    const teamGroupValue = editForm.teamGroup.trim();
    const parsedTeamGroup = teamGroupValue === "" ? null : Number.parseInt(teamGroupValue, 10);
    if (parsedTeamGroup !== null && Number.isNaN(parsedTeamGroup)) {
      setEditError("Наборът трябва да е число.");
      return;
    }

    if (editForm.parentPhone.trim() && !isValidPhone(editForm.parentPhone)) {
      setEditError("Parent phone is invalid.");
      return;
    }
    if (editForm.playerPhone.trim() && !isValidPhone(editForm.playerPhone)) {
      setEditError("Player phone is invalid.");
      return;
    }
    const normalizedPaymentAmount = !coachGroupId ? editForm.paymentAmount.trim().replace(",", ".") : "";
    if (normalizedPaymentAmount && !/^\d+(\.\d{1,2})?$/.test(normalizedPaymentAmount)) {
      setEditError("Месечната такса трябва да е положително число с до 2 знака след десетичната запетая.");
      return;
    }

    setIsSavingEdit(true);
    setEditError("");
    try {
      let resolvedAvatarUrl = editForm.avatarUrl.trim() || null;
      let resolvedImageUrl = editForm.imageUrl.trim() || null;
      let resolvedImagePublicId = editForm.imagePublicId.trim() || null;

      if (editAvatarFile) {
        const uploaded = await uploadImage(
          editAvatarFile,
          "player",
          fullName || editAvatarFile.name,
        );
        resolvedAvatarUrl = uploaded.secure_url;
        resolvedImageUrl = extractUploadPathFromCloudinaryUrl(uploaded.secure_url);
        resolvedImagePublicId = uploaded.public_id;
      }

      const response = await fetch(`/api/admin/members/${memberToEdit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          clubId: editForm.clubId,
          teamGroup: parsedTeamGroup,
          jerseyNumber: editForm.jerseyNumber.trim() || null,
          parentPhone: editForm.parentPhone.trim() || null,
          playerPhone: editForm.playerPhone.trim() || null,
          birthDate: editForm.birthDate.trim() || null,
          ...(normalizedPaymentAmount ? { paymentAmount: normalizedPaymentAmount } : {}),
          avatarUrl: resolvedAvatarUrl,
          imageUrl: resolvedImageUrl,
          imagePublicId: resolvedImagePublicId,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" && data.error.trim()
            ? data.error.trim()
            : "Неуспешно редактиране на състезател.";
        setEditError(message);
        return;
      }

      const updatedMember = normalizeMember(data);
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberToEdit.id ? updatedMember : m
        )
      );

      setSelectedMember((prev) =>
        prev?.id === memberToEdit.id ? updatedMember : prev
      );

      closeEditModal();
      await refreshMembersList();
      router.refresh();
    } catch (error) {
      console.error("Error updating member:", error);
      setEditError("Възникна грешка при редактиране.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleAssignNewCard = async () => {
    if (!memberToEdit || isSavingEdit || isAssigningNewCard) return;

    setIsAssigningNewCard(true);
    setEditError("");

    try {
      const response = await fetch(`/api/admin/members/${memberToEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_new_card" }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" && data.error.trim()
            ? data.error.trim()
            : "Неуспешно генериране на нова карта.";
        setEditError(message);
        return;
      }

      const updatedMember = normalizeMember(data);
      setMembers((prev) => prev.map((m) => (m.id === memberToEdit.id ? updatedMember : m)));
      setSelectedMember((prev) => (prev?.id === memberToEdit.id ? updatedMember : prev));
      setMemberToEdit(updatedMember);
    } catch (error) {
      console.error("Error assigning new card:", error);
      setEditError("Възникна грешка при генериране на нова карта.");
    } finally {
      setIsAssigningNewCard(false);
    }
  };

  const handleConfirmAssignNewCard = async () => {
    setIsNewCardConfirmOpen(false);
    await handleAssignNewCard();
  };

  const handleReactivateMember = async (member: Member) => {
    if (reactivatingMemberId || deletingPermanentMemberId) return;
    setInactiveActionError("");
    setReactivatingMemberId(member.id);
    try {
      const response = await fetch(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reactivate" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" && data.error.trim()
            ? data.error.trim()
            : "Неуспешно активиране на състезател.";
        setInactiveActionError(message);
        return;
      }

      const updatedMember = normalizeMember(data);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? updatedMember : m)));
      setSelectedMember((prev) => (prev?.id === member.id ? updatedMember : prev));
    } catch (error) {
      console.error("Error reactivating member:", error);
      setInactiveActionError("Възникна грешка при активиране на състезател.");
    } finally {
      setReactivatingMemberId(null);
    }
  };

  const handlePermanentDeleteMember = async () => {
    if (!memberToPermanentDelete || reactivatingMemberId || deletingPermanentMemberId) return;
    const member = memberToPermanentDelete;

    setInactiveActionError("");
    setDeletingPermanentMemberId(member.id);
    try {
      const response = await fetch(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_permanently" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string" && data.error.trim()
            ? data.error.trim()
            : "Неуспешно изтриване на състезател.";
        setInactiveActionError(message);
        return;
      }

      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      setSelectedMember((prev) => (prev?.id === member.id ? null : prev));
    } catch (error) {
      console.error("Error permanently deleting member:", error);
      setInactiveActionError("Възникна грешка при изтриване на състезател.");
    } finally {
      setDeletingPermanentMemberId(null);
      setMemberToPermanentDelete(null);
    }
  };

  const refreshMembersList = async () => {
    try {
      const params = new URLSearchParams();
      if (clubId) params.set("clubId", clubId);
      if (coachGroupId) params.set("coachGroupId", coachGroupId);
      const endpoint = params.toString() ? `/api/admin/members?${params.toString()}` : "/api/admin/members";
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data: unknown = await response.json();
      const rawItems = Array.isArray(data) ? data : [];
      const normalized: Member[] = rawItems.map((item) => normalizeMember(item));
      setMembers(normalized);
    } catch (error) {
      console.error("Error refreshing members list:", error);
    }
  };

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch("/api/admin/check-session", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          setIsAdmin(false);
          setIsCoach(false);
          return;
        }

        const payload = (await response.json()) as {
          isAdmin?: boolean;
          isCoach?: boolean;
          roles?: string[];
        };
        setIsAdmin(Boolean(payload.isAdmin) || (Array.isArray(payload.roles) && payload.roles.includes("admin")));
        setIsCoach(Boolean(payload.isCoach) || (Array.isArray(payload.roles) && payload.roles.includes("coach")));
      } catch {
        setIsAdmin(false);
        setIsCoach(false);
      }
    };

    void fetchSession();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ua = window.navigator.userAgent || "";
    setIsClubIPhone(/iPhone/i.test(ua));
    const standaloneByDisplayMode = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const standaloneByNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsClubStandalone(standaloneByDisplayMode || standaloneByNavigator);
  }, []);

  const clubPushScopeKey = `${clubId}|${coachGroupId}`;

  useEffect(() => {
    let cancelled = false;

    const syncClubPushState = async () => {
      setClubPushErrorMessage("");
      setClubPushStatusMessage("");

      if (!clubId || typeof window === "undefined") {
        if (!cancelled) {
          setIsClubPushSubscribed(false);
        }
        return;
      }

      const supportsPush =
        window.isSecureContext &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!supportsPush) {
        if (!cancelled) {
          setIsClubPushSupported(false);
          setIsClubPushSubscribed(false);
        }
        return;
      }

      if (!cancelled) {
        setIsClubPushSupported(true);
      }

      try {
        await navigator.serviceWorker.register("/sw.js");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          if (!cancelled) {
            setIsClubPushSubscribed(false);
          }
          return;
        }

        const endpoint = subscription.endpoint.trim();
        const search = new URLSearchParams({ endpoint });
        if (coachGroupId) {
          search.set("coachGroupId", coachGroupId);
        }
        const response = await fetch(
          `/api/admin/clubs/${encodeURIComponent(clubId)}/push-subscriptions?${search.toString()}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          if (!cancelled) {
            setIsClubPushSubscribed(false);
          }
          return;
        }

        const payload = (await response.json()) as { isActive?: unknown };
        if (!cancelled) {
          setIsClubPushSubscribed(Boolean(payload.isActive));
        }
      } catch (error) {
        console.error("Club push state sync error:", error);
        if (!cancelled) {
          setIsClubPushSubscribed(false);
        }
      }
    };

    void syncClubPushState();

    return () => {
      cancelled = true;
    };
  }, [clubPushScopeKey]);

  useEffect(() => {
    if (!clubId) {
      router.replace("/admin/login");
      return;
    }

    const fetchMembers = async () => {
      setLoading(true);
      try {
        const clubsResponse = await fetch("/api/admin/clubs", { cache: "no-store" });
        if (!clubsResponse.ok) {
          router.replace("/404");
          return;
        }

        const clubsPayload: unknown = await clubsResponse.json();
        if (clubId) {
          const selectedClub = Array.isArray(clubsPayload)
            ? clubsPayload.find((club) => {
              const item =
                typeof club === "object" && club !== null
                  ? (club as { id?: unknown; name?: unknown })
                  : {};
              return String(item.id ?? "") === clubId;
            })
            : null;

          if (!selectedClub || typeof selectedClub.name !== "string" || !selectedClub.name.trim()) {
            router.replace("/404");
            return;
          }

          setClubName(selectedClub.name.trim());
          const selectedSport = (selectedClub as Record<string, unknown>).sports;
          setClubSport(typeof selectedSport === "string" ? selectedSport.trim() : "");
          const selectedMode = (selectedClub as Record<string, unknown>).trainingGroupMode;
          setTrainingGroupMode(selectedMode === "custom_group" ? "custom_group" : "team_group");
          setTrainingGroupModeDraft(selectedMode === "custom_group" ? "custom_group" : "team_group");

          const billing = (selectedClub as Record<string, unknown>).billingStatus;
          setClubBillingStatus(typeof billing === "string" ? billing : "");
          const workflow = (selectedClub as Record<string, unknown>).paymentWorkflow;
          setClubPaymentWorkflow(
            workflow === "rolling_30_days"
              ? "rolling_30_days"
              : workflow === "training_credits"
                ? "training_credits"
                : workflow === "training_credits_30_days"
                  ? "training_credits_30_days"
                : "calendar_month",
          );
          const defaultPaymentAmount = (selectedClub as Record<string, unknown>).defaultPaymentAmount;
          setClubDefaultPaymentAmount(
            defaultPaymentAmount === null || defaultPaymentAmount === undefined ? "" : String(defaultPaymentAmount),
          );

          const logo = (selectedClub as Record<string, unknown>).imageUrl;
          if (typeof logo === "string" && logo) {
            setClubLogoUrl(logo);
          } else {
            setClubLogoUrl(null);
          }
        } else {
          setClubName("Всички отбори");
          setClubBillingStatus("");
          setClubDefaultPaymentAmount("");
          setClubLogoUrl(null);
        }

        const fetchParams = new URLSearchParams();
        if (clubId) fetchParams.set("clubId", clubId);
        if (coachGroupId) fetchParams.set("coachGroupId", coachGroupId);
        const endpoint = fetchParams.toString() ? `/api/admin/members?${fetchParams.toString()}` : "/api/admin/members";
        const res = await fetch(endpoint);
        if (res.status === 404) {
          router.replace("/404");
          return;
        }
        if (res.ok) {
          const data: unknown = await res.json();
          const rawItems = Array.isArray(data) ? data : [];
          const normalized: Member[] = rawItems.map((item) => normalizeMember(item));
          setMembers(normalized);
          const nameFromMembers = normalized[0]?.club?.name;
          if (clubId && nameFromMembers) {
            setClubName(nameFromMembers);
          }
        }
      } catch (err) {
        console.error("Error fetching members:", err);
      } finally {
        setLoading(false);
      }
    };

    const fetchClubName = async () => {
      if (!clubId) {
        setClubName("Всички отбори");
        return;
      }

      try {
        const response = await fetch("/api/admin/clubs", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const clubs: unknown = await response.json();
        const selectedClub = Array.isArray(clubs)
          ? clubs.find((club) => {
            const item =
              typeof club === "object" && club !== null
                ? (club as { id?: unknown })
                : {};
            return String(item.id ?? "") === clubId;
          })
          : null;
        if (selectedClub?.name) {
          setClubName(String(selectedClub.name));
        }
        const selectedSport = (selectedClub as Record<string, unknown> | null)?.sports;
        setClubSport(typeof selectedSport === "string" ? selectedSport.trim() : "");
        const selectedMode = (selectedClub as Record<string, unknown> | null)?.trainingGroupMode;
        setTrainingGroupMode(selectedMode === "custom_group" ? "custom_group" : "team_group");
        setTrainingGroupModeDraft(selectedMode === "custom_group" ? "custom_group" : "team_group");
        const billing = (selectedClub as Record<string, unknown> | null)?.billingStatus;
        setClubBillingStatus(typeof billing === "string" ? billing : "");
        const workflow = (selectedClub as Record<string, unknown> | null)?.paymentWorkflow;
        setClubPaymentWorkflow(
          workflow === "rolling_30_days"
            ? "rolling_30_days"
            : workflow === "training_credits"
              ? "training_credits"
              : workflow === "training_credits_30_days"
                ? "training_credits_30_days"
              : "calendar_month",
        );
        const defaultPaymentAmount = (selectedClub as Record<string, unknown> | null)?.defaultPaymentAmount;
        setClubDefaultPaymentAmount(
          defaultPaymentAmount === null || defaultPaymentAmount === undefined ? "" : String(defaultPaymentAmount),
        );
        const logo = (selectedClub as Record<string, unknown> | null)?.imageUrl;
        if (typeof logo === "string" && logo) {
          setClubLogoUrl(logo);
        }
      } catch (err) {
        console.error("Error fetching clubs:", err);
      }
    };

    void fetchMembers();
    void fetchClubName();
    void loadCoachGroups();
  }, [clubId, coachGroupId, router]);

  const canViewInactiveMembers = isAdmin || isCoach;

  useEffect(() => {
    if (!canViewInactiveMembers) {
      setInactivePlayersOpen(false);
      setReactivatingMemberId(null);
      setDeletingPermanentMemberId(null);
      setMemberToPermanentDelete(null);
      setInactiveActionError("");
    }
  }, [canViewInactiveMembers]);

  useEffect(() => {
    setSelectedGroup("all");
  }, [trainingGroupMode]);

  /* ── Derived ── */
  const canManageMemberActions = isAdmin || isCoach || !searchParams.has("coachGroupId");
  const groupOptions = [...new Set(
    members.filter((m) => m.isActive).map((m) => m.teamGroup).filter((g): g is number => g !== null)
  )].sort((a, b) => a - b);
  const activeMembersByGroup = members.reduce<Record<number, number>>((acc, member) => {
    if (!member.isActive || member.teamGroup === null) {
      return acc;
    }
    acc[member.teamGroup] = (acc[member.teamGroup] ?? 0) + 1;
    return acc;
  }, {});
  const resolvedTrainingGroupScope = groupOptions.some((group) => String(group) === trainingGroupScope)
    ? trainingGroupScope
    : (groupOptions[0] ? String(groupOptions[0]) : "");
  const selectedTeamGroup = parseSelectedTeamGroup(resolvedTrainingGroupScope);
  const selectedTrainingGroup = trainingScheduleGroups.find((group) => group.id === selectedTrainingGroupId) ?? null;
  const selectedCustomGroup = customTrainingGroups.find((group) => group.id === selectedTrainingGroupId) ?? null;
  const fieldConflictsFetchParams = useMemo<string | null>(() => {
    if (!trainingDaysEditorOpen || trainingDaysEditorMode === "createGroup" || !clubId) return null;
    const datesArr = [...schedulerForm.trainingDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (datesArr.length === 0) return null;
    const effectiveTimes: Record<string, string> = {};
    const fallback = trainingTimeMode === "all" ? schedulerForm.trainingTime.trim() : "";
    for (const date of datesArr) {
      const t = ((trainingDateTimes as Record<string, unknown>)[date] as string | undefined)?.trim() ?? fallback;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
        effectiveTimes[date] = t;
      }
    }
    const dur = Math.max(1, Math.min(1440, Number.parseInt(schedulerForm.trainingDurationMinutes, 10) || 60));
    const params = new URLSearchParams();
    params.set("dates", datesArr.join(","));
    if (Object.keys(effectiveTimes).length > 0) {
      params.set("dateTimes", JSON.stringify(effectiveTimes));
    }
    params.set("duration", String(dur));
    if (trainingDaysEditorMode === "trainingGroup" && selectedTrainingGroupId) {
      params.set("excludeType", "trainingGroup");
      params.set("excludeId", selectedTrainingGroupId);
    } else if (trainingDaysEditorMode === "customGroup" && selectedTrainingGroupId) {
      params.set("excludeType", "customGroup");
      params.set("excludeId", selectedTrainingGroupId);
    } else if (trainingDaysEditorMode === "coachGroup" && coachGroupId) {
      params.set("excludeType", "coachGroup");
      params.set("excludeId", coachGroupId);
    } else if (trainingDaysEditorMode === "teamGroup") {
      if (selectedTeamGroup !== null) {
        params.set("excludeType", "teamGroup");
        params.set("excludeTeamGroup", String(selectedTeamGroup));
        params.set("excludeTeamGroups", String(selectedTeamGroup));
      } else {
        params.set("excludeType", "club");
      }
    }
    return params.toString();
  }, [trainingDaysEditorOpen, trainingDaysEditorMode, clubId, schedulerForm.trainingDates, schedulerForm.trainingDurationMinutes, schedulerForm.trainingTime, trainingDateTimes, trainingTimeMode, selectedTrainingGroupId, coachGroupId, selectedTeamGroup]);

  useEffect(() => {
    if (!fieldConflictsFetchParams || !clubId) {
      setFieldConflictsMap({});
      return;
    }
    let cancelled = false;
    setFieldConflictsLoading(true);
    const run = async () => {
      try {
        const response = await fetch(
          `/api/admin/clubs/${encodeURIComponent(clubId)}/field-conflicts?${fieldConflictsFetchParams}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (!response.ok) {
          setFieldConflictsMap({});
          return;
        }
        const payload = await response.json() as { occupiedResources?: unknown[] };
        if (cancelled) return;
        const occupied = Array.isArray(payload?.occupiedResources) ? payload.occupiedResources as Array<{ date?: string; fieldId: string; pieceIds: string[] }> : [];
        const map: Record<string, { blockedPieceIds: string[]; wholeFieldBlocked: boolean }> = {};
        for (const field of trainingFields) {
          const relevant = occupied.filter((r) => r.fieldId === field.id && (!r.date || r.date === trainingFieldActiveDate));
          if (relevant.length === 0) continue;
          const blockedSet = new Set<string>();
          for (const r of relevant) {
            if (r.pieceIds.length === 0) {
              for (const piece of field.pieces) blockedSet.add(piece.id);
            } else {
              for (const pid of r.pieceIds) blockedSet.add(pid);
            }
          }
          map[field.id] = { blockedPieceIds: Array.from(blockedSet), wholeFieldBlocked: true };
        }
        setFieldConflictsMap(map);
      } catch {
        if (!cancelled) setFieldConflictsMap({});
      } finally {
        if (!cancelled) setFieldConflictsLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [fieldConflictsFetchParams, clubId, trainingFields, trainingFieldActiveDate]);
  const currentCoachGroupName = coachGroupId
    ? (coachGroups.find((group) => group.id === coachGroupId)?.name.trim() ?? "")
    : "";
  const isCustomTrainingGroupMode = trainingGroupMode === "custom_group";
  const customTrainingGroupCoachScope = useMemo(
    () => customTrainingGroupCoachScopeKey(coachGroupId),
    [coachGroupId],
  );
  const weekSessionColorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of trainingWeekSessions) {
      if (s.color && isCustomTrainingGroupPaletteColor(s.color) && !seen.has(s.color)) {
        const group = customTrainingGroups.find((g) => g.color === s.color);
        seen.set(s.color, group?.name ?? "");
      }
    }
    return Array.from(seen.entries()).map(([color, label]) => ({ color, label }));
  }, [trainingWeekSessions, customTrainingGroups]);
  const noFreeCustomTrainingGroupColor = useMemo(() => {
    if (!isCustomTrainingGroupMode) return false;
    const used = new Set(
      customTrainingGroups
        .filter((g) => (g.coachGroupId ?? null) === customTrainingGroupCoachScope)
        .map((g) => g.color)
        .filter(isCustomTrainingGroupPaletteColor),
    );
    return !CUSTOM_TRAINING_GROUP_COLOR_PALETTE.some((c) => !used.has(c));
  }, [isCustomTrainingGroupMode, customTrainingGroups, customTrainingGroupCoachScope]);
  const trainingAttendanceMatchesByDate = new Map<string, ClubMatch[]>();
  for (const match of clubMatches) {
    const appliesToAll = match.teamGroups.length === 0 && match.customGroupId === null;
    const appliesToSelectedTeam =
      selectedTeamGroup === null || match.teamGroups.includes(selectedTeamGroup);
    const appliesToSelectedTrainingGroup =
      selectedTrainingGroup?.teamGroups.some((teamGroup) => match.teamGroups.includes(teamGroup)) ?? false;
    let appliesToCurrentScope: boolean;
    if (match.customGroupId !== null) {
      appliesToCurrentScope = isCustomTrainingGroupMode && match.customGroupId === selectedCustomGroup?.id;
    } else {
      appliesToCurrentScope =
        appliesToAll ||
        (isCustomTrainingGroupMode
          ? false
          : trainingAttendanceView === "trainingGroups"
            ? appliesToSelectedTrainingGroup
            : appliesToSelectedTeam);
    }
    if (!appliesToCurrentScope) continue;
    const matchesForDate = trainingAttendanceMatchesByDate.get(match.matchDate) ?? [];
    matchesForDate.push(match);
    trainingAttendanceMatchesByDate.set(match.matchDate, matchesForDate);
  }
  const dayDetailsDate = trainingDayDetailsOpen ? (trainingAttendanceDate ?? "") : "";
  const dayDetailsSessions = dayDetailsDate
    ? trainingWeekSessions.filter((s) => s.date === dayDetailsDate && s.eventType !== "match")
    : [];
  const dayDetailsMatchesAll: ClubMatch[] = dayDetailsDate
    ? clubMatches.filter((m) => m.matchDate === dayDetailsDate)
    : [];
  const dayDetailsHasTabs = dayDetailsSessions.length > 1 || dayDetailsMatchesAll.length > 0;
  const dayDetailsIsMatchTab = trainingDayDetailsTab.startsWith("match-");
  const dayDetailsActiveMatch = dayDetailsIsMatchTab
    ? (matchEditTarget ?? dayDetailsMatchesAll.find((m) => `match-${m.id}` === trainingDayDetailsTab) ?? null)
    : null;
  const activeMemberIdSet = new Set(members.filter((m) => m.isActive).map((m) => m.id));
  const activeMembersByCustomGroup = customTrainingGroups.reduce<Record<string, number>>((acc, group) => {
    acc[group.id] = group.playerIds.filter((id) => activeMemberIdSet.has(id)).length;
    return acc;
  }, {});
  const availablePlayersForCustomGroupCreate = members.filter(
    (member) => member.isActive,
  );
  const availablePlayersForCustomGroupEdit = members.filter(
    (member) => member.isActive,
  );
  const filteredPlayersForCustomGroupCreate = customGroupCreateSearch.trim()
    ? availablePlayersForCustomGroupCreate.filter((m) =>
        m.fullName.toLowerCase().includes(customGroupCreateSearch.toLowerCase()),
      )
    : availablePlayersForCustomGroupCreate;
  const filteredPlayersForCustomGroupEdit = customGroupEditSearch.trim()
    ? availablePlayersForCustomGroupEdit.filter((m) =>
        m.fullName.toLowerCase().includes(customGroupEditSearch.toLowerCase()),
      )
    : availablePlayersForCustomGroupEdit;
  const trainingGroupTeamGroupSet = new Set(trainingScheduleGroups.flatMap((g) => g.teamGroups));
  const standaloneTeamGroups = groupOptions.filter((g) => !trainingGroupTeamGroupSet.has(g));
  const unifiedGroupScopeValue =
    isCustomTrainingGroupMode
      ? (selectedTrainingGroupId || "")
      : trainingAttendanceView === "trainingGroups"
      ? (selectedTrainingGroupId || "")
      : `year:${resolvedTrainingGroupScope}`;
  const selectedCustomTrainingGroupDotColor =
    isCustomTrainingGroupMode && selectedTrainingGroupId
      ? (() => {
          const g = customTrainingGroups.find((item) => item.id === selectedTrainingGroupId);
          return g?.color && isCustomTrainingGroupPaletteColor(g.color) ? g.color : null;
        })()
      : null;
  const selectedTeamGroupLinkedTrainingGroups =
    selectedTeamGroup === null
      ? []
      : trainingScheduleGroups.filter((group) => group.teamGroups.includes(selectedTeamGroup));
  const activeTrainingFieldSelection = trainingFieldSelections[trainingFieldActiveDate] ?? { trainingFieldId: "", trainingFieldPieceIds: [] };
  const selectedActiveTrainingField = trainingFields.find((field) => field.id === activeTrainingFieldSelection.trainingFieldId) ?? null;
  const hasMissingTrainingField =
    trainingDaysEditorMode !== "createGroup" &&
    trainingFields.length > 0 &&
    schedulerForm.trainingDates.length > 0 &&
    schedulerForm.trainingDates.some((date) => !trainingFieldSelections[date]?.trainingFieldId);
  const missingTrainingFieldDates = schedulerForm.trainingDates
    .map((value) => String(value ?? "").trim())
    .filter((date) => schedulerCalendarDateSet.has(date) && !trainingFieldSelections[date]?.trainingFieldId)
    .sort((a, b) => a.localeCompare(b));
  const missingTrainingFieldMessage =
    missingTrainingFieldDates.length === 0
      ? "Трябва да изберете терен"
      : `Трябва да изберете терен за: ${missingTrainingFieldDates.map((date) => formatIsoDateForDisplay(date)).join(", ")}`;
  const normalizedTrainingDaysSelection = schedulerForm.trainingDates
    .map((value) => String(value ?? "").trim())
    .filter((value) => schedulerCalendarDateSet.has(value))
    .sort((a, b) => a.localeCompare(b));
  const normalizedTrainingDaysInitial = trainingDaysInitialDates
    .map((value) => String(value ?? "").trim())
    .filter((value) => schedulerCalendarDateSet.has(value))
    .sort((a, b) => a.localeCompare(b));
  const normalizedTrainingDateTimesSelection = normalizeTrainingDateTimes(
    trainingDateTimes,
    normalizedTrainingDaysSelection,
    trainingTimeMode === "all" ? schedulerForm.trainingTime : null,
  );
  const normalizedTrainingDateTimesInitial = normalizeTrainingDateTimes(
    trainingDaysInitialDateTimes,
    normalizedTrainingDaysInitial,
    "",
  );
  const hasMissingTrainingTime =
    normalizedTrainingDaysSelection.length > 0 &&
    normalizedTrainingDaysSelection.some((date) => !TRAINING_TIME_REGEX.test((normalizedTrainingDateTimesSelection[date] ?? "").trim()));
  const parsedTrainingDurationSelection = Number.parseInt(schedulerForm.trainingDurationMinutes.trim(), 10);
  const normalizedTrainingDurationSelection = Number.isInteger(parsedTrainingDurationSelection)
    ? parsedTrainingDurationSelection
    : DEFAULT_TRAINING_DURATION_MINUTES;
  const hasInvalidTrainingDuration =
    trainingDaysEditorMode !== "createGroup" &&
    (!/^\d+$/.test(schedulerForm.trainingDurationMinutes.trim()) ||
      normalizedTrainingDurationSelection < 1 ||
      normalizedTrainingDurationSelection > 1440);
  const canShowTrainingDaysTimeStep =
    trainingDaysEditorMode !== "createGroup" &&
    normalizedTrainingDaysSelection.length > 0;
  const canShowTrainingDaysFieldStep =
    canShowTrainingDaysTimeStep &&
    !hasMissingTrainingTime &&
    !hasInvalidTrainingDuration;
  const spotsStepSupportedByMode =
    trainingDaysEditorMode === "teamGroup" ||
    trainingDaysEditorMode === "customGroup" ||
    trainingDaysEditorMode === "coachGroup";
  const canShowTrainingDaysSpotsStep = canShowTrainingDaysFieldStep && spotsStepSupportedByMode;
  const canShowTrainingDaysNotesStep = canShowTrainingDaysFieldStep;
  const stepSequence: TrainingDaysStep[] = spotsStepSupportedByMode
    ? ["days", "time", "spots", "field", "notes"]
    : ["days", "time", "field", "notes"];
  const schedulerLimitedSpotsValue = parseInt(schedulerLimitedSpots, 10);
  const isSchedulerLimitedSpotsValid =
    Number.isInteger(schedulerLimitedSpotsValue) && schedulerLimitedSpotsValue >= 1 && schedulerLimitedSpotsValue <= 200;
  const isSchedulerPerDayConfigValid =
    !schedulerPerDayLimited ||
    !normalizedTrainingDaysSelection.some((d) => {
      const cfg = schedulerPerDayConfig[d];
      if (!cfg?.limited) return false;
      const s = parseInt(cfg.spots, 10);
      return !Number.isInteger(s) || s < 1 || s > 200;
    });
  const effectiveTrainingDaysActiveStep: TrainingDaysStep =
    trainingDaysEditorMode === "createGroup"
      ? "days"
      : trainingDaysActiveStep === "notes" && !canShowTrainingDaysNotesStep
        ? canShowTrainingDaysFieldStep
          ? "field"
          : canShowTrainingDaysSpotsStep
            ? "spots"
            : canShowTrainingDaysTimeStep
              ? "time"
              : "days"
        : trainingDaysActiveStep === "field" && !canShowTrainingDaysFieldStep
          ? canShowTrainingDaysSpotsStep
            ? "spots"
            : canShowTrainingDaysTimeStep
              ? "time"
              : "days"
          : trainingDaysActiveStep === "spots" && !canShowTrainingDaysSpotsStep
            ? canShowTrainingDaysTimeStep
              ? "time"
              : "days"
            : trainingDaysActiveStep === "time" && !canShowTrainingDaysTimeStep
              ? "days"
              : trainingDaysActiveStep;
  const currentStepOrder = stepSequence.indexOf(effectiveTrainingDaysActiveStep);
  const trainingWeekdayBuckets = Array.from(
    new Set(
      normalizedTrainingDaysSelection
        .map((date) => getWeekdayMondayFirstIndex(date))
        .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6),
    ),
  ).sort((a, b) => a - b);
  const trainingDaysSummaryText =
    normalizedTrainingDaysSelection.length === 0
      ? "Няма избрани дни"
      : normalizedTrainingDaysSelection.length <= 4
        ? normalizedTrainingDaysSelection.map((date) => formatIsoDateForDisplay(date)).join(", ")
        : `${normalizedTrainingDaysSelection.slice(0, 4).map((date) => formatIsoDateForDisplay(date)).join(", ")} + още ${normalizedTrainingDaysSelection.length - 4}`;
  const trainingTimeSummaryText = hasMissingTrainingTime
    ? "Няма въведен валиден час"
    : trainingTimeMode === "all"
      ? `Всички тренировки: ${schedulerForm.trainingTime.trim()}`
      : trainingTimeMode === "byWeekday"
        ? `По седмични дни: ${trainingWeekdayBuckets.map((weekdayIndex) => {
            const weekdayDate = normalizedTrainingDaysSelection.find(
              (date) => getWeekdayMondayFirstIndex(date) === weekdayIndex,
            );
            const weekdayTime = weekdayDate ? normalizedTrainingDateTimesSelection[weekdayDate] : "";
            return `${TRAINING_WEEKDAY_LONG_BG[weekdayIndex] ?? `#${weekdayIndex + 1}`} ${weekdayTime}`;
          }).join(", ")}`
        : normalizedTrainingDaysSelection.length <= 3
          ? `Индивидуално: ${normalizedTrainingDaysSelection.map((date) => `${formatIsoDateForDisplay(date)} ${normalizedTrainingDateTimesSelection[date] ?? ""}`).join(", ")}`
          : `Индивидуални часове за ${normalizedTrainingDaysSelection.length} тренировки`;
  const trainingDurationSummaryText = hasInvalidTrainingDuration
    ? "Невалидна продължителност"
    : `${normalizedTrainingDurationSelection} мин.`;
  const primaryTrainingFieldSelection =
    normalizedTrainingDaysSelection.map((date) => trainingFieldSelections[date]).find((selection) => selection?.trainingFieldId) ??
    { trainingFieldId: null, trainingFieldPieceIds: [] };
  const showTrainingStepBack =
    trainingDaysEditorMode !== "createGroup" &&
    effectiveTrainingDaysActiveStep !== "days";
  const showTrainingStepNext =
    trainingDaysEditorMode !== "createGroup" &&
    effectiveTrainingDaysActiveStep !== "notes";
  const isTrainingStepNextDisabled =
    trainingDaysEditorSaving ||
    (effectiveTrainingDaysActiveStep === "days" && !canShowTrainingDaysTimeStep) ||
    (effectiveTrainingDaysActiveStep === "time" && !canShowTrainingDaysFieldStep) ||
    (effectiveTrainingDaysActiveStep === "spots" && !schedulerPerDayLimited && schedulerLimitedMode && !isSchedulerLimitedSpotsValid) ||
    (effectiveTrainingDaysActiveStep === "spots" && !isSchedulerPerDayConfigValid);
  const normalizedTrainingDateTimesSelectionKey = normalizedTrainingDaysSelection
    .map((date) => `${date}:${normalizedTrainingDateTimesSelection[date] ?? ""}`)
    .join("|");
  const normalizedTrainingDateTimesInitialKey = normalizedTrainingDaysInitial
    .map((date) => `${date}:${normalizedTrainingDateTimesInitial[date] ?? ""}`)
    .join("|");
  const normalizedTrainingFieldSelectionsKey = normalizedTrainingDaysSelection
    .map((date) => {
      const selection = trainingFieldSelections[date];
      return `${date}:${selection?.trainingFieldId ?? ""}:${[...(selection?.trainingFieldPieceIds ?? [])].sort().join(",")}`;
    })
    .join("|");
  const normalizedTrainingFieldSelectionsInitialKey = normalizedTrainingDaysInitial
    .map((date) => {
      const selection = trainingDaysInitialFieldSelections[date];
      return `${date}:${selection?.trainingFieldId ?? ""}:${[...(selection?.trainingFieldPieceIds ?? [])].sort().join(",")}`;
    })
    .join("|");
  const buildMergedTrainingDateTimes = (dates: string[], fallbackTrainingTime: string | null) =>
    normalizeTrainingDateTimes(
      { ...trainingDaysInitialDateTimes, ...trainingDateTimes },
      dates,
      fallbackTrainingTime,
    );
  const buildMergedTrainingFieldSelections = (dates: string[]) => {
    const allowedDates = new Set(dates);
    const merged: Record<string, TrainingFieldSelection> = {};
    for (const [date, selection] of Object.entries({
      ...trainingDaysInitialFieldSelections,
      ...trainingFieldSelections,
    })) {
      if (allowedDates.has(date)) {
        merged[date] = selection;
      }
    }
    return merged;
  };
  const isTrainingDaysScheduleUnchanged =
    trainingDaysEditorMode !== "createGroup" &&
    normalizedTrainingDaysSelection.join("|") === normalizedTrainingDaysInitial.join("|") &&
    normalizedTrainingDateTimesSelectionKey === normalizedTrainingDateTimesInitialKey &&
    normalizedTrainingDurationSelection === trainingDaysInitialDurationMinutes &&
    normalizedTrainingFieldSelectionsKey === normalizedTrainingFieldSelectionsInitialKey;
  const activeMembersCount = members.filter((m) => m.isActive).length;
  const inactiveMembers = members.filter((m) => !m.isActive);

  useEffect(() => {
    if (groupOptions.length === 0) {
      if (trainingGroupScope !== "") {
        setTrainingGroupScope("");
      }
      return;
    }
    const hasSelectedScope = groupOptions.some((group) => String(group) === trainingGroupScope);
    if (!hasSelectedScope) {
      setTrainingGroupScope(String(groupOptions[0]));
    }
  }, [groupOptions, trainingGroupScope]);

  useEffect(() => {
    setTrainingDateTimes((prev) => {
      const selected = new Set([...trainingDaysPreExistingDates, ...schedulerForm.trainingDates]);
      let changed = false;
      const next: Record<string, string> = {};
      for (const date of selected) {
        const value = (prev[date] ?? "").trim();
        if (value) {
          next[date] = value;
        }
      }
      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      } else {
        for (const key of Object.keys(prev)) {
          if (!selected.has(key) || prev[key] !== next[key]) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
    setTrainingFieldSelections((prev) => {
      const next: Record<string, TrainingFieldSelection> = {};
      for (const date of new Set([...trainingDaysPreExistingDates, ...schedulerForm.trainingDates])) {
        if (prev[date]) next[date] = prev[date];
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    if (schedulerForm.trainingDates.length > 0 && !schedulerForm.trainingDates.includes(trainingFieldActiveDate)) {
      setTrainingFieldActiveDate(schedulerForm.trainingDates[0]);
    }
  }, [schedulerForm.trainingDates, trainingDaysPreExistingDates]);

  useEffect(() => {
    if (trainingTimeMode === "all") {
      return;
    }
    if (schedulerForm.trainingDates.length === 0) {
      if (schedulerForm.trainingTime) {
        setSchedulerForm((prev) => ({ ...prev, trainingTime: "" }));
      }
      return;
    }

    const firstTime = schedulerForm.trainingDates
      .map((date) => (trainingDateTimes[date] ?? "").trim())
      .find((value) => TRAINING_TIME_REGEX.test(value)) ?? "";

    if (firstTime && firstTime !== schedulerForm.trainingTime) {
      setSchedulerForm((prev) => ({ ...prev, trainingTime: firstTime }));
    }
  }, [schedulerForm.trainingDates, schedulerForm.trainingTime, trainingDateTimes, trainingTimeMode]);

  const filtered = members.filter((m) => {
    if (!m.isActive) return false;

    const matchGroup = selectedGroup === "all"
      || (isCustomTrainingGroupMode
        ? (customTrainingGroups.find((g) => g.id === selectedGroup)?.playerIds ?? []).includes(m.id)
        : String(m.teamGroup) === selectedGroup);
    if (!matchGroup) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      m.fullName.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.jerseyNumber ?? "").toLowerCase().includes(q) ||
      m.cards.some((c) => c.cardCode.toLowerCase().includes(q)) ||
      (m.club?.name ?? "").toLowerCase().includes(q)
    );
  });

  const notifyVisibleMembers = useMemo(() => {
    let list = members.filter((m) => m.isActive);
    if (!coachGroupId && notifyCoachGroupFilter) {
      list = list.filter((m) => m.coachGroupIds.includes(notifyCoachGroupFilter));
    }
    if (notifyGroupFilter !== "all") {
      if (isCustomTrainingGroupMode) {
        list = list.filter((m) =>
          (customTrainingGroups.find((g) => g.id === notifyGroupFilter)?.playerIds ?? []).includes(m.id)
        );
      } else {
        const tsg = trainingScheduleGroups.find((g) => g.id === notifyGroupFilter);
        if (tsg) {
          list = list.filter((m) => m.teamGroup !== null && tsg.teamGroups.includes(m.teamGroup));
        } else {
          list = list.filter((m) => String(m.teamGroup) === notifyGroupFilter);
        }
      }
    }
    if (notifySearchTerm.trim()) {
      const q = notifySearchTerm.trim().toLowerCase();
      list = list.filter((m) => m.fullName.toLowerCase().includes(q));
    }
    return list;
  }, [members, notifyGroupFilter, notifySearchTerm, notifyCoachGroupFilter, coachGroupId, isCustomTrainingGroupMode, customTrainingGroups, trainingScheduleGroups]);

  const bulkCoachGroupVisibleMembers = useMemo(() => {
    let list = bulkCoachGroupAllMembers.filter((m) => m.isActive);
    if (bulkCoachGroupSearchTerm.trim()) {
      const q = bulkCoachGroupSearchTerm.trim().toLowerCase();
      list = list.filter((m) => m.fullName.toLowerCase().includes(q));
    }
    return list;
  }, [bulkCoachGroupAllMembers, bulkCoachGroupSearchTerm]);

  const guideSteps = useMemo(
    () => ALL_GUIDE_STEPS.filter((s) => !s.adminOnly || isAdmin),
    [isAdmin],
  );

  useEffect(() => {
    if (!guideImgExpanded) {
      setGuideImgScale(1);
      setGuideImgPos({ x: 0, y: 0 });
      guideImgTouchRef.current = null;
    }
  }, [guideImgExpanded]);

  const handleGuideImgTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.stopPropagation();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      guideImgTouchRef.current = {
        startDist: Math.hypot(dx, dy),
        startScale: guideImgScale,
        startX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        startY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        startPosX: guideImgPos.x,
        startPosY: guideImgPos.y,
      };
    } else if (e.touches.length === 1 && guideImgScale > 1) {
      e.stopPropagation();
      guideImgTouchRef.current = {
        startDist: 0,
        startScale: guideImgScale,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startPosX: guideImgPos.x,
        startPosY: guideImgPos.y,
      };
    }
  }, [guideImgScale, guideImgPos]);

  const handleGuideImgTouchMove = useCallback((e: React.TouchEvent) => {
    if (!guideImgTouchRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length === 2 && guideImgTouchRef.current.startDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(5, Math.max(1, guideImgTouchRef.current.startScale * (dist / guideImgTouchRef.current.startDist)));
      setGuideImgScale(newScale);
    } else if (e.touches.length === 1 && guideImgTouchRef.current.startDist === 0) {
      const dx = e.touches[0].clientX - guideImgTouchRef.current.startX;
      const dy = e.touches[0].clientY - guideImgTouchRef.current.startY;
      setGuideImgPos({ x: guideImgTouchRef.current.startPosX + dx, y: guideImgTouchRef.current.startPosY + dy });
    }
  }, []);

  const handleGuideImgTouchEnd = useCallback(() => {
    guideImgTouchRef.current = null;
  }, []);

  const openBulkCoachGroupModal = async (groupId: string) => {
    setBulkCoachGroupTargetId(groupId);
    setBulkCoachGroupAllMembers([]);
    setBulkCoachGroupSelectedIds(new Set());
    setBulkCoachGroupInitialIds(new Set());
    setBulkCoachGroupSearchTerm("");
    setBulkCoachGroupError("");
    setBulkCoachGroupSaved(false);
    setBulkCoachGroupBusy(false);
    setBulkCoachGroupLoadingMembers(true);
    try {
      const res = await fetch(`/api/admin/members?clubId=${encodeURIComponent(clubId)}`);
      const data = (await res.json().catch(() => [])) as Member[];
      const allActive = Array.isArray(data) ? data.filter((m) => m.isActive) : [];
      const alreadyIn = new Set(allActive.filter((m) => m.coachGroupIds.includes(groupId)).map((m) => m.id));
      setBulkCoachGroupAllMembers(allActive);
      setBulkCoachGroupSelectedIds(new Set(alreadyIn));
      setBulkCoachGroupInitialIds(new Set(alreadyIn));
    } catch {
      setBulkCoachGroupError("Грешка при зареждане на състезателите.");
    } finally {
      setBulkCoachGroupLoadingMembers(false);
    }
  };

  const handleBulkCoachGroupSave = async () => {
    if (!bulkCoachGroupTargetId) return;
    setBulkCoachGroupBusy(true);
    setBulkCoachGroupError("");
    try {
      const toAdd = bulkCoachGroupAllMembers.filter(
        (m) => m.isActive && bulkCoachGroupSelectedIds.has(m.id) && !bulkCoachGroupInitialIds.has(m.id)
      );
      const toRemove = bulkCoachGroupAllMembers.filter(
        (m) => m.isActive && !bulkCoachGroupSelectedIds.has(m.id) && bulkCoachGroupInitialIds.has(m.id)
      );
      const allChanged = [...toAdd, ...toRemove];
      if (allChanged.length === 0) {
        setBulkCoachGroupSaved(true);
        setTimeout(() => setBulkCoachGroupSaved(false), 2000);
        return;
      }
      for (const member of allChanged) {
        const isAdding = bulkCoachGroupSelectedIds.has(member.id);
        const newGroupIds = isAdding
          ? [...new Set([...(member.coachGroupIds ?? []), bulkCoachGroupTargetId])]
          : (member.coachGroupIds ?? []).filter((id) => id !== bulkCoachGroupTargetId);
        const res = await fetch(`/api/admin/members/${encodeURIComponent(member.id)}/coach-group`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coachGroupIds: newGroupIds }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Грешка при запазване");
        }
      }
      setBulkCoachGroupSaved(true);
      setBulkCoachGroupInitialIds(new Set(bulkCoachGroupSelectedIds));
      void refreshMembersList();
      setTimeout(() => setBulkCoachGroupSaved(false), 2000);
    } catch (err) {
      setBulkCoachGroupError(err instanceof Error ? err.message : "Грешка");
    } finally {
      setBulkCoachGroupBusy(false);
    }
  };

  const handleSendNotify = async () => {
    if (!notifyMessage.trim() || notifySelectedIds.size === 0) return;
    setNotifyBusy(true);
    setNotifyError("");
    setNotifySuccess("");
    try {
      const res = await fetch("/api/admin/members/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberIds: Array.from(notifySelectedIds),
          message: notifyMessage.trim(),
          clubId,
          ...(coachGroupId ? { coachGroupId } : {}),
        }),
      });
      const data = (await res.json()) as { success?: boolean; sent?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Грешка");
      setNotifySuccess(`Изпратено до ${data.sent ?? 0} членове.`);
      setNotifySelectedIds(new Set());
      setNotifyMessage("");
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : "Грешка");
    } finally {
      setNotifyBusy(false);
    }
  };

  const handleDownloadMemberLinks = async () => {
    if (!isAdmin || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const rows = members
      .filter((member) => member.isActive)
      .map((member) => {
        const cardCode =
          member.cards.find((card) => card.isActive)?.cardCode ||
          member.cards[0]?.cardCode ||
          "";

        if (!cardCode) {
          return null;
        }

        return {
          fullName: member.fullName,
          birthDate: formatBirthDateForExport(member.birthDate),
          url: `${window.location.origin}/member/${encodeURIComponent(cardCode)}`,
        };
      })
      .filter((item): item is { fullName: string; birthDate: string; url: string } => item !== null)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }));

    if (rows.length === 0) {
      window.alert("Няма активни състезатели с карта за export.");
      return;
    }

    const header = [
      `Отбор: ${clubName || "-"}`,
      `Общо активни състезатели: ${rows.length}`,
      "",
    ].join("\n");
    const entries = rows
      .map(
        (row, index) =>
          `${index + 1}. ${row.fullName}\n` +
          `   Birthdate: ${row.birthDate}\n` +
          `   ${row.url}`,
      )
      .join("\n\n");
    const content = `${header}${entries}\n`.replace(/\n/g, "\r\n");
    const safeClub = (clubName || "club")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "");
    const defaultBaseName = `${safeClub || "club"}-member-links`;
    const requestedName = window.prompt("Име на файла:", defaultBaseName) ?? "";
    const cleanBaseName = (requestedName.trim() || defaultBaseName).replace(/[\\/:*?"<>|]/g, "-");
    const filename = `${cleanBaseName}.txt`;
    const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPlayersExcel = () => {
    if (!isAdmin || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const rows = members
      .filter((member) => member.isActive)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "bg"))
      .map((member) => {
        const cells = [
          member.fullName,
          clubSport,
          formatBirthDateForExport(member.birthDate).replace(/-/g, ""),
          member.jerseyNumber?.trim() ?? "",
        ];
        return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table><thead><tr><th>Име, фамилия</th><th>спорт</th><th>роден</th><th>номер</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const safeClub = (clubName || "club").trim().replace(/[\\/:*?"<>|]+/g, "-") || "club";
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `players-${safeClub}-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const enableSecondReminder = () => {
    setSecondReminderEnabled(true);
    setSchedulerForm((prev) => {
      const primaryDay = Number.parseInt(prev.reminderDay, 10);
      const fallbackDay = Number.isInteger(primaryDay)
        ? Math.min(28, Math.max(1, primaryDay < 28 ? primaryDay + 1 : primaryDay - 1))
        : 26;
      return {
        ...prev,
        secondReminderDay: prev.secondReminderDay || String(fallbackDay),
        secondReminderHour: prev.secondReminderHour || "10",
        secondReminderMinute: prev.secondReminderMinute || "0",
      };
    });
  };

  const disableSecondReminder = () => {
    setSecondReminderEnabled(false);
    setThirdReminderEnabled(false);
    setSchedulerForm((prev) => ({
      ...prev,
      secondReminderDay: "",
      secondReminderHour: "10",
      secondReminderMinute: "0",
      thirdReminderDay: "",
      thirdReminderHour: "10",
      thirdReminderMinute: "0",
    }));
  };

  const enableThirdReminder = () => {
    setThirdReminderEnabled(true);
    setSchedulerForm((prev) => {
      const usedDays = [
        Number.parseInt(prev.reminderDay, 10),
        Number.parseInt(prev.secondReminderDay, 10),
      ].filter((day) => Number.isInteger(day) && day >= 1 && day <= 28);
      const fallbackDay = Array.from({ length: 28 }, (_, index) => index + 1).find((day) => !usedDays.includes(day)) ?? 27;
      return {
        ...prev,
        thirdReminderDay: prev.thirdReminderDay || String(fallbackDay),
        thirdReminderHour: prev.thirdReminderHour || "10",
        thirdReminderMinute: prev.thirdReminderMinute || "0",
      };
    });
  };

  const disableThirdReminder = () => {
    setThirdReminderEnabled(false);
    setSchedulerForm((prev) => ({
      ...prev,
      thirdReminderDay: "",
      thirdReminderHour: "10",
      thirdReminderMinute: "0",
    }));
  };

  const openSchedulerSettings = async () => {
    if (!clubId) return;
    setSchedulerSettingsError("");
    setSchedulerSettingsLoading(true);
    setSchedulerSettingsOpen(true);
    try {
      const search = new URLSearchParams();
      if (selectedTeamGroup !== null) {
        search.set("teamGroup", String(selectedTeamGroup));
      }
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/scheduler${search.size ? `?${search.toString()}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешно зареждане на графика.");
      }
      const payload = await response.json();
      const resolvedTrainingDates = Array.isArray(payload.trainingDates)
        ? payload.trainingDates
          .map((value: unknown) => String(value ?? "").trim())
          .filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value))
          .sort((a: string, b: string) => a.localeCompare(b))
        : [];
      const resolvedDateTimes = normalizeTrainingDateTimes(
        payload.trainingDateTimes,
        resolvedTrainingDates,
        typeof payload.trainingTime === "string" ? payload.trainingTime : null,
      );
      const resolvedUniformTime =
        getUniformTrainingTime(
          resolvedTrainingDates,
          resolvedDateTimes,
        ) ||
        (typeof payload.trainingTime === "string" && TRAINING_TIME_REGEX.test(payload.trainingTime.trim())
          ? payload.trainingTime.trim()
          : "");
      const hasSecondReminder =
        Number.isInteger(payload.secondReminderDay) &&
        Number.isInteger(payload.secondReminderHour) &&
        Number.isInteger(payload.secondReminderMinute);
      const hasThirdReminder =
        Number.isInteger(payload.thirdReminderDay) &&
        Number.isInteger(payload.thirdReminderHour) &&
        Number.isInteger(payload.thirdReminderMinute);
      setSchedulerForm({
        reminderDay: String(payload.reminderDay ?? 25),
        overdueDay: String(payload.overdueDay ?? 1),
        reminderHour: String(payload.reminderHour ?? 10),
        reminderMinute: String(payload.reminderMinute ?? 0),
        secondReminderDay: hasSecondReminder ? String(payload.secondReminderDay) : "",
        secondReminderHour: hasSecondReminder ? String(payload.secondReminderHour) : "10",
        secondReminderMinute: hasSecondReminder ? String(payload.secondReminderMinute) : "0",
        thirdReminderDay: hasThirdReminder ? String(payload.thirdReminderDay) : "",
        thirdReminderHour: hasThirdReminder ? String(payload.thirdReminderHour) : "10",
        thirdReminderMinute: hasThirdReminder ? String(payload.thirdReminderMinute) : "0",
        overdueHour: String(payload.overdueHour ?? 10),
        overdueMinute: String(payload.overdueMinute ?? 0),
        trainingDates: resolvedTrainingDates,
        trainingTime: resolvedUniformTime,
        trainingDurationMinutes: getTrainingDurationFormValue(payload.trainingDurationMinutes),
        trainingFieldId: normalizeOptionalId(payload.trainingFieldId) ?? "",
        trainingFieldPieceIds: Array.isArray(payload.trainingFieldPieceIds) ? payload.trainingFieldPieceIds.map(String) : [],
      });
      setSecondReminderEnabled(hasSecondReminder);
      setThirdReminderEnabled(hasThirdReminder);
      setTrainingDateTimes(resolvedDateTimes);
      setTrainingTimeMode(inferTrainingTimeMode(resolvedTrainingDates, resolvedDateTimes));
    } catch (error) {
      setSchedulerSettingsError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setSchedulerSettingsLoading(false);
    }
  };

  const loadTrainingScheduleGroups = async (): Promise<TrainingScheduleGroup[]> => {
    if (!clubId) return [];
    setTrainingScheduleGroupsLoading(true);
    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-groups`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Неуспешно зареждане на тренировъчните групи.");
      }
      const payload: unknown = await response.json();
      const groups = Array.isArray(payload)
        ? payload.map((item) => {
          const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
          const teamGroups = Array.isArray(raw.teamGroups)
            ? raw.teamGroups
              .map((value) => Number.parseInt(String(value), 10))
              .filter((value) => Number.isInteger(value))
              .sort((a, b) => a - b)
            : [];
          const trainingDates = Array.isArray(raw.trainingDates)
            ? raw.trainingDates
              .map((value) => String(value ?? "").trim())
              .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
              .sort((a, b) => a.localeCompare(b))
            : [];
          return {
            id: String(raw.id ?? ""),
            name: String(raw.name ?? "").trim(),
            teamGroups,
            trainingDates,
            trainingTime:
              typeof raw.trainingTime === "string" && TRAINING_TIME_REGEX.test(raw.trainingTime.trim())
                ? raw.trainingTime.trim()
                : null,
            trainingDateTimes: normalizeTrainingDateTimes(
              raw.trainingDateTimes,
              trainingDates,
              typeof raw.trainingTime === "string" ? raw.trainingTime : null,
            ),
            trainingDurationMinutes: normalizeTrainingDurationInput(raw.trainingDurationMinutes),
            trainingFieldId: normalizeOptionalId(raw.trainingFieldId),
            trainingFieldPieceIds: Array.isArray(raw.trainingFieldPieceIds) ? raw.trainingFieldPieceIds.map(String) : [],
            trainingFieldSelections: normalizeTrainingFieldSelections(raw.trainingFieldSelections, trainingDates, {
              trainingFieldId: normalizeOptionalId(raw.trainingFieldId),
              trainingFieldPieceIds: Array.isArray(raw.trainingFieldPieceIds) ? raw.trainingFieldPieceIds.map(String) : [],
            }),
          } satisfies TrainingScheduleGroup;
        }).filter((group) => group.id && group.teamGroups.length >= 2)
        : [];
      const sortedGroups = sortByName(groups);
      setTrainingScheduleGroups(sortedGroups);
      setSelectedTrainingGroupId((prev) => {
        if (prev && sortedGroups.some((group) => group.id === prev)) {
          return prev;
        }
        return sortedGroups[0]?.id ?? "";
      });
      return sortedGroups;
    } catch {
      setTrainingScheduleGroups([]);
      setSelectedTrainingGroupId("");
      return [];
    } finally {
      setTrainingScheduleGroupsLoading(false);
    }
  };

  const loadTrainingFields = async (): Promise<TrainingField[]> => {
    if (!clubId) return [];
    setTrainingFieldsLoading(true);
    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/fields`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setTrainingFields([]);
        return [];
      }
      const payload: unknown = await response.json();
      const fields = Array.isArray(payload)
        ? payload.map((item) => {
          const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
          const pieces = Array.isArray(raw.pieces)
            ? raw.pieces.map((piece) => {
              const pieceRaw = typeof piece === "object" && piece !== null ? (piece as Record<string, unknown>) : {};
              return {
                id: String(pieceRaw.id ?? ""),
                name: String(pieceRaw.name ?? "").trim(),
                sortOrder: Number.isInteger(pieceRaw.sortOrder) ? Number(pieceRaw.sortOrder) : 0,
              };
            }).filter((piece) => piece.id && piece.name)
            : [];
          return {
            id: String(raw.id ?? ""),
            name: String(raw.name ?? "").trim(),
            fieldType: typeof raw.fieldType === "string" ? raw.fieldType : "football",
            pieces: pieces.sort((a, b) => a.sortOrder - b.sortOrder),
          } satisfies TrainingField;
        }).filter((field) => field.id && field.name)
        : [];
      setTrainingFields(fields);
      return fields;
    } catch (error) {
      setTrainingDaysEditorError(error instanceof Error ? error.message : "Възникна грешка.");
      setTrainingFields([]);
      return [];
    } finally {
      setTrainingFieldsLoading(false);
    }
  };

  const loadCustomTrainingGroups = useCallback(async (): Promise<CustomTrainingGroup[]> => {
    if (!clubId) return [];
    setTrainingScheduleGroupsLoading(true);
    try {
      const search = new URLSearchParams();
      if (coachGroupId) search.set("coachGroupId", coachGroupId);
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/custom-training-groups${search.size ? `?${search.toString()}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to load custom training groups.");
      }
      const payload: unknown = await response.json();
      const groups = Array.isArray(payload)
        ? payload.map((item) => {
          const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
          const trainingDates = Array.isArray(raw.trainingDates)
            ? raw.trainingDates
              .map((value) => String(value ?? "").trim())
              .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
              .sort((a, b) => a.localeCompare(b))
            : [];
          const playerIds = Array.isArray(raw.playerIds)
            ? raw.playerIds.map((value) => String(value ?? "").trim()).filter(Boolean)
            : [];
          return {
            id: String(raw.id ?? ""),
            name: String(raw.name ?? "").trim(),
            coachGroupId: normalizeOptionalId(raw.coachGroupId),
            playerIds,
            trainingDates,
            trainingTime:
              typeof raw.trainingTime === "string" && TRAINING_TIME_REGEX.test(raw.trainingTime.trim())
                ? raw.trainingTime.trim()
                : null,
            trainingDateTimes: normalizeTrainingDateTimes(
              raw.trainingDateTimes,
              trainingDates,
              typeof raw.trainingTime === "string" ? raw.trainingTime : null,
            ),
            trainingDurationMinutes: normalizeTrainingDurationInput(raw.trainingDurationMinutes),
            trainingFieldId: normalizeOptionalId(raw.trainingFieldId),
            trainingFieldPieceIds: Array.isArray(raw.trainingFieldPieceIds) ? raw.trainingFieldPieceIds.map(String) : [],
            trainingFieldSelections: normalizeTrainingFieldSelections(raw.trainingFieldSelections, trainingDates, {
              trainingFieldId: normalizeOptionalId(raw.trainingFieldId),
              trainingFieldPieceIds: Array.isArray(raw.trainingFieldPieceIds) ? raw.trainingFieldPieceIds.map(String) : [],
            }),
            color:
              typeof raw.color === "string" &&
              isCustomTrainingGroupPaletteColor(raw.color.trim())
                ? raw.color.trim()
                : null,
          } satisfies CustomTrainingGroup;
        }).filter((group) => group.id && group.name)
        : [];
      const sortedGroups = sortByName(groups);
      setCustomTrainingGroups(sortedGroups);
      setSelectedTrainingGroupId((prev) => {
        if (prev && sortedGroups.some((group) => group.id === prev)) {
          return prev;
        }
        return sortedGroups[0]?.id ?? "";
      });
      return sortedGroups;
    } catch {
      setCustomTrainingGroups([]);
      setSelectedTrainingGroupId("");
      return [];
    } finally {
      setTrainingScheduleGroupsLoading(false);
    }
  }, [clubId, coachGroupId]);

  useEffect(() => {
    if (!clubId) {
      setCustomTrainingGroups([]);
      return;
    }

    if (trainingGroupMode !== "custom_group") {
      setCustomTrainingGroups([]);
      return;
    }

    void loadCustomTrainingGroups();
  }, [clubId, loadCustomTrainingGroups, trainingGroupMode]);

  const loadCoachGroups = async (): Promise<CoachGroup[]> => {
    if (!clubId) return [];
    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/coach-groups`, {
        cache: "no-store",
      });
      if (!response.ok) return [];
      const payload: unknown = await response.json();
      const groups: CoachGroup[] = Array.isArray(payload)
        ? payload
          .map((item) => {
            const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
            return {
              id: String(raw.id ?? ""),
              name: String(raw.name ?? "").trim(),
              playerCount: typeof raw.playerCount === "number" ? raw.playerCount : 0,
            };
          })
          .filter((g) => g.id && g.name)
        : [];
      const sortedGroups = sortByName(groups);
      setCoachGroups(sortedGroups);
      return sortedGroups;
    } catch {
      return [];
    }
  };

  const saveTrainingGroupMode = async (nextMode: "team_group" | "custom_group") => {
    if (!clubId || trainingGroupModeSaving) return;
    if (nextMode === trainingGroupMode) {
      setTrainingGroupModeSettingsOpen(false);
      setTrainingGroupModeError("");
      return;
    }
    setTrainingGroupModeSaving(true);
    setTrainingAttendanceError("");
    setTrainingGroupModeError("");
    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-group-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainingGroupMode: nextMode }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to save training group mode.");
      }
      setTrainingGroupMode(nextMode);
      setTrainingGroupModeDraft(nextMode);
      setSelectedTrainingGroupId("");
      setTrainingAttendancePlayers([]);
      setTrainingAttendanceStats({ total: 0, attending: 0, optedOut: 0 });
      setTrainingUpcomingDates([]);
      if (nextMode === "custom_group") {
        await loadCustomTrainingGroups();
      } else {
        await loadTrainingScheduleGroups();
      }
      setTrainingGroupModeSettingsOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save training group mode.";
      setTrainingGroupModeError(message);
      setTrainingAttendanceError(message);
    } finally {
      setTrainingGroupModeSaving(false);
    }
  };

  const openTrainingGroupModeSettings = () => {
    setTrainingGroupModeDraft(trainingGroupMode);
    setTrainingGroupModeError("");
    setTrainingGroupModeSettingsOpen(true);
  };

  const openTrainingGroupCreateModal = () => {
    setTrainingGroupCreateError("");
    setTrainingGroupCreateGroups([]);
    setTrainingGroupCreateName("");
    setTrainingGroupCreatePlayerIds([]);
    setCustomGroupCreateSearch("");
    const used = new Set(
      customTrainingGroups
        .filter((g) => (g.coachGroupId ?? null) === customTrainingGroupCoachScope)
        .map((g) => g.color)
        .filter(isCustomTrainingGroupPaletteColor),
    );
    const firstFree =
      CUSTOM_TRAINING_GROUP_COLOR_PALETTE.find((c) => !used.has(c)) ?? CUSTOM_TRAINING_GROUP_COLOR_PALETTE[0];
    setTrainingGroupCreateColor(firstFree);
    setTrainingGroupCreateStep("picker");
    const firstGroup = isCustomTrainingGroupMode ? customTrainingGroups[0] : trainingScheduleGroups[0];
    setTrainingGroupEditPickId(firstGroup?.id ?? "");
    setTrainingGroupCreateOpen(true);
  };

  const openTrainingGroupEditModal = (groupId: string) => {
    if (isCustomTrainingGroupMode) {
      const group = customTrainingGroups.find((item) => item.id === groupId);
      if (!group) {
        setTrainingAttendanceError("Custom training group not found.");
        return;
      }
      const activeIds = new Set(members.filter((m) => m.isActive).map((m) => m.id));
      setTrainingGroupEditError("");
      setTrainingGroupEditId(group.id);
      setTrainingGroupEditName(group.name);
      setTrainingGroupEditPlayerIds(group.playerIds.filter((id) => activeIds.has(id)));
      setCustomGroupEditSearch("");
      const usedByOthers = new Set(
        customTrainingGroups
          .filter((item) => item.id !== group.id && (item.coachGroupId ?? null) === customTrainingGroupCoachScope)
          .map((item) => item.color)
          .filter(isCustomTrainingGroupPaletteColor),
      );
      const keepColor =
        group.color &&
        isCustomTrainingGroupPaletteColor(group.color) &&
        !usedByOthers.has(group.color)
          ? group.color
          : null;
      setTrainingGroupEditColor(
        keepColor ??
          CUSTOM_TRAINING_GROUP_COLOR_PALETTE.find((c) => !usedByOthers.has(c)) ??
          CUSTOM_TRAINING_GROUP_COLOR_PALETTE[0],
      );
      setTrainingGroupEditOpen(true);
      return;
    }
    const group = trainingScheduleGroups.find((item) => item.id === groupId);
    if (!group) {
      setTrainingAttendanceError("Сборният отбор не е намерен.");
      return;
    }
    const initialGroups = group.teamGroups.map((value) => String(value));
    setTrainingGroupEditError("");
    setTrainingGroupEditId(group.id);
    setTrainingGroupEditGroups(initialGroups);
    setTrainingGroupEditName(group.name || initialGroups.slice().sort((a, b) => Number(a) - Number(b)).join("/"));
    setTrainingGroupEditOpen(true);
  };

  const saveTrainingGroupFromModal = async () => {
    if (!clubId || trainingGroupCreateSaving) return;
    setTrainingGroupCreateSaving(true);
    setTrainingGroupCreateError("");
    try {
      if (isCustomTrainingGroupMode) {
        const name = trainingGroupCreateName.trim();
        if (!name) {
          throw new Error("Enter a group name.");
        }
        if (noFreeCustomTrainingGroupColor) {
          throw new Error("Няма свободни цветове за нова група в тази треньорска група.");
        }
        if (!isCustomTrainingGroupPaletteColor(trainingGroupCreateColor)) {
          throw new Error("Изберете цвят от палитрата.");
        }
        const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/custom-training-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            playerIds: trainingGroupCreatePlayerIds,
            coachGroupId: coachGroupId || null,
            color: trainingGroupCreateColor,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || "Failed to create custom training group.");
        }
        setTrainingGroupCreateOpen(false);
        setTrainingGroupCreateStep("picker");
        await loadCustomTrainingGroups();
        void refreshMembersList();
        return;
      }
      const selectedGroups = trainingGroupCreateGroups
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value));
      if (selectedGroups.length < 2) {
        throw new Error("Изберете поне 2 набора.");
      }

      const defaultName = selectedGroups.map((group) => String(group)).join("/");
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: defaultName,
          teamGroups: selectedGroups,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешно създаване на сборен отбор.");
      }

      setTrainingGroupCreateOpen(false);
      setTrainingGroupCreateStep("picker");
      await loadTrainingScheduleGroups();
    } catch (error) {
      setTrainingGroupCreateError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingGroupCreateSaving(false);
    }
  };

  const saveTrainingGroupEditFromModal = async () => {
    if (!clubId || !trainingGroupEditId || trainingGroupEditSaving) return;
    setTrainingGroupEditSaving(true);
    setTrainingGroupEditError("");
    try {
      if (isCustomTrainingGroupMode) {
        const name = trainingGroupEditName.trim();
        if (!name) {
          throw new Error("Enter a group name.");
        }
        if (!isCustomTrainingGroupPaletteColor(trainingGroupEditColor)) {
          throw new Error("Изберете цвят от палитрата.");
        }
        const response = await fetch(
          `/api/admin/clubs/${encodeURIComponent(clubId)}/custom-training-groups/${encodeURIComponent(trainingGroupEditId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              playerIds: trainingGroupEditPlayerIds,
              color: trainingGroupEditColor,
            }),
          },
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || "Failed to edit custom training group.");
        }
        setTrainingGroupEditOpen(false);
        const refreshedGroups = await loadCustomTrainingGroups();
        void refreshMembersList();
        const fallbackId = refreshedGroups.some((group) => group.id === trainingGroupEditId)
          ? trainingGroupEditId
          : refreshedGroups[0]?.id ?? "";
        setSelectedTrainingGroupId(fallbackId);
        if (trainingAttendanceOpen && fallbackId) {
          await fetchTrainingAttendance(undefined, undefined, fallbackId, "trainingGroups");
        }
        return;
      }
      const selectedGroups = trainingGroupEditGroups
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value));
      if (selectedGroups.length < 2) {
        throw new Error("Изберете поне 2 набора.");
      }

      const generatedName = selectedGroups
        .slice()
        .sort((a, b) => a - b)
        .map((value) => String(value))
        .join("/");
      const nextName = trainingGroupEditName.trim() || generatedName;

      const response = await fetch(
        `/api/admin/clubs/${encodeURIComponent(clubId)}/training-groups/${encodeURIComponent(trainingGroupEditId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nextName,
            teamGroups: selectedGroups,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешна редакция на сборния отбор.");
      }

      setTrainingGroupEditOpen(false);
      const refreshedGroups = isCustomTrainingGroupMode
        ? await loadCustomTrainingGroups()
        : await loadTrainingScheduleGroups();
      if (trainingAttendanceView === "trainingGroups") {
        const hasSelected = refreshedGroups.some((group) => group.id === trainingGroupEditId);
        if (hasSelected) {
          setSelectedTrainingGroupId(trainingGroupEditId);
          await fetchTrainingAttendance(undefined, undefined, trainingGroupEditId, "trainingGroups");
        } else {
          const fallbackId = refreshedGroups[0]?.id ?? "";
          setSelectedTrainingGroupId(fallbackId);
          if (fallbackId) {
            await fetchTrainingAttendance(undefined, undefined, fallbackId, "trainingGroups");
          } else {
            setTrainingAttendancePlayers([]);
            setTrainingAttendanceStats({ total: 0, attending: 0, optedOut: 0 });
            setTrainingUpcomingDates([]);
            setTrainingAttendanceDate("");
          }
        }
      }
    } catch (error) {
      setTrainingGroupEditError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingGroupEditSaving(false);
    }
  };

  const deleteSelectedTrainingGroup = async () => {
    if (!clubId || !selectedTrainingGroupId || trainingGroupDeleteSaving) return;

    setTrainingGroupDeleteSaving(true);
    setTrainingAttendanceError("");
    try {
      const response = await fetch(
        isCustomTrainingGroupMode
          ? `/api/admin/clubs/${encodeURIComponent(clubId)}/custom-training-groups/${encodeURIComponent(selectedTrainingGroupId)}`
          : `/api/admin/clubs/${encodeURIComponent(clubId)}/training-groups/${encodeURIComponent(selectedTrainingGroupId)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешно изтриване на сборния отбор.");
      }

      setTrainingDayDetailsOpen(false);
      setTrainingBulkNoteOpen(false);
      setTrainingDaysEditorOpen(false);
      setTrainingDaysEditorError("");
      setTrainingNoteTargetDates([]);
      const refreshedGroups = isCustomTrainingGroupMode
        ? await loadCustomTrainingGroups()
        : await loadTrainingScheduleGroups();
      const fallbackId = refreshedGroups[0]?.id ?? "";
      setSelectedTrainingGroupId(fallbackId);
      if (trainingAttendanceView === "trainingGroups") {
        if (fallbackId) {
          await fetchTrainingAttendance(undefined, undefined, fallbackId, "trainingGroups");
        } else {
          setTrainingAttendancePlayers([]);
          setTrainingAttendanceStats({ total: 0, attending: 0, optedOut: 0 });
          setTrainingUpcomingDates([]);
          setTrainingAttendanceDate("");
        }
      }
    } catch (error) {
      setTrainingAttendanceError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingGroupDeleteSaving(false);
      setTrainingGroupDeleteConfirmOpen(false);
    }
  };

  const openTrainingDaysEditor = async (mode: "teamGroup" | "createGroup" | "trainingGroup" | "customGroup" | "coachGroup" = "teamGroup", editDate?: string) => {
    if (!clubId) return;
    if (trainingDaysEditorOpen) {
      setTrainingDaysEditorOpen(false);
      setTrainingDaysEditorError("");
      return;
    }

    setTrainingDaysEditorMode(mode);
    setTrainingDaysSingleEditDate(editDate ?? null);
    setTrainingDaysActiveStep(editDate ? "time" : "days");
    setTrainingDayScheduleNotes(editDate && trainingNote.trim() ? { [editDate]: trainingNote } : {});
    setTrainingDaysEditorGroups([]);
    setTrainingDaysEditorGroupName("");
    setTrainingDaysEditorCreateOpen(true);
    setTrainingDaysEditorError("");
    setTrainingDaysInitialDates([]);
    setTrainingDaysInitialDateTimes({});
    setTrainingDaysInitialFieldSelections({});
    setTrainingDaysInitialDurationMinutes(DEFAULT_TRAINING_DURATION_MINUTES);
    setTrainingDaysInitialFieldId("");
    setTrainingDaysInitialFieldPieceIds([]);
    setTrainingDateTimes({});
    setTrainingFieldSelections({});
    setTrainingFieldActiveDate("");
    setTrainingTimeMode("all");
    setSchedulerLimitedMode(false);
    setSchedulerLimitedSpots("10");
    setSchedulerPerDayLimited(false);
    setSchedulerPerDayConfig({});
    setTrainingDaysEditorLoading(true);
    await loadTrainingFields();
    const loadedGroups = isCustomTrainingGroupMode ? [] : await loadTrainingScheduleGroups();
    const loadedCustomGroups = isCustomTrainingGroupMode ? await loadCustomTrainingGroups() : [];
    try {
      if (mode === "customGroup") {
        const resolvedGroup =
          loadedCustomGroups.find((group) => group.id === selectedTrainingGroupId) ??
          customTrainingGroups.find((group) => group.id === selectedTrainingGroupId) ??
          null;
        if (!resolvedGroup) {
          throw new Error("Select a custom training group.");
        }
        const nextWindowDates = [...resolvedGroup.trainingDates]
          .map((value) => String(value ?? "").trim())
          .filter((value) => schedulerCalendarDateSet.has(value))
          .sort((a, b) => a.localeCompare(b));
        const resolvedDateTimes = normalizeTrainingDateTimes(
          resolvedGroup.trainingDateTimes,
          nextWindowDates,
          resolvedGroup.trainingTime ?? null,
        );
        const resolvedUniformTime = getUniformTrainingTime(nextWindowDates, resolvedDateTimes);
        const resolvedFieldSelections = normalizeTrainingFieldSelections(
          resolvedGroup.trainingFieldSelections,
          nextWindowDates,
          { trainingFieldId: resolvedGroup.trainingFieldId ?? null, trainingFieldPieceIds: resolvedGroup.trainingFieldPieceIds ?? [] },
        );
        const customEditDates = editDate ? [editDate].filter(d => nextWindowDates.includes(d)) : [];
        setTrainingDaysPreExistingDates(nextWindowDates);
        setSchedulerForm((prev) => ({
          ...prev,
          trainingDates: customEditDates,
          trainingTime: resolvedUniformTime,
          trainingDurationMinutes: getTrainingDurationFormValue(resolvedGroup.trainingDurationMinutes),
          trainingFieldId: resolvedGroup.trainingFieldId ?? "",
          trainingFieldPieceIds: resolvedGroup.trainingFieldPieceIds ?? [],
        }));
        setTrainingDaysInitialDates(customEditDates);
        setTrainingDaysInitialDurationMinutes(normalizeTrainingDurationInput(resolvedGroup.trainingDurationMinutes));
        setTrainingDaysInitialFieldId(resolvedGroup.trainingFieldId ?? "");
        setTrainingDaysInitialFieldPieceIds(resolvedGroup.trainingFieldPieceIds ?? []);
        setTrainingDateTimes(resolvedDateTimes);
        setTrainingDaysInitialDateTimes(resolvedDateTimes);
        setTrainingFieldSelections(resolvedFieldSelections);
        setTrainingDaysInitialFieldSelections(resolvedFieldSelections);
        setTrainingFieldActiveDate(editDate ?? nextWindowDates[0] ?? "");
        setTrainingTimeMode(inferTrainingTimeMode(nextWindowDates, resolvedDateTimes));
        setTrainingDaysEditorOpen(true);
        return;
      }
      if (mode === "trainingGroup") {
        const resolvedGroup =
          loadedGroups.find((group) => group.id === selectedTrainingGroupId) ??
          trainingScheduleGroups.find((group) => group.id === selectedTrainingGroupId) ??
          null;
        if (!resolvedGroup) {
          throw new Error("Изберете сборен отбор.");
        }
        const nextWindowDates = [...resolvedGroup.trainingDates]
          .map((value) => String(value ?? "").trim())
          .filter((value) => schedulerCalendarDateSet.has(value))
          .sort((a, b) => a.localeCompare(b));
        const resolvedDateTimes = normalizeTrainingDateTimes(
          resolvedGroup.trainingDateTimes,
          nextWindowDates,
          resolvedGroup.trainingTime ?? null,
        );
        const resolvedUniformTime = getUniformTrainingTime(nextWindowDates, resolvedDateTimes);
        const resolvedFieldSelections = normalizeTrainingFieldSelections(
          resolvedGroup.trainingFieldSelections,
          nextWindowDates,
          { trainingFieldId: resolvedGroup.trainingFieldId ?? null, trainingFieldPieceIds: resolvedGroup.trainingFieldPieceIds ?? [] },
        );
        const trainingGroupEditDates = editDate ? [editDate].filter(d => nextWindowDates.includes(d)) : [];
        setTrainingDaysPreExistingDates(nextWindowDates);
        setSchedulerForm((prev) => ({
          ...prev,
          trainingDates: trainingGroupEditDates,
          trainingTime: resolvedUniformTime,
          trainingDurationMinutes: getTrainingDurationFormValue(resolvedGroup.trainingDurationMinutes),
          trainingFieldId: resolvedGroup.trainingFieldId ?? "",
          trainingFieldPieceIds: resolvedGroup.trainingFieldPieceIds ?? [],
        }));
        setTrainingDaysInitialDates(trainingGroupEditDates);
        setTrainingDaysInitialDurationMinutes(normalizeTrainingDurationInput(resolvedGroup.trainingDurationMinutes));
        setTrainingDaysInitialFieldId(resolvedGroup.trainingFieldId ?? "");
        setTrainingDaysInitialFieldPieceIds(resolvedGroup.trainingFieldPieceIds ?? []);
        setTrainingDateTimes(resolvedDateTimes);
        setTrainingDaysInitialDateTimes(resolvedDateTimes);
        setTrainingFieldSelections(resolvedFieldSelections);
        setTrainingDaysInitialFieldSelections(resolvedFieldSelections);
        setTrainingFieldActiveDate(editDate ?? nextWindowDates[0] ?? "");
        setTrainingTimeMode(inferTrainingTimeMode(nextWindowDates, resolvedDateTimes));
        setTrainingDaysEditorOpen(true);
        return;
      }
      if (mode === "coachGroup") {
        if (!coachGroupId) throw new Error("Няма избрана треньорска група.");
        const cgResponse = await fetch(
          `/api/admin/clubs/${encodeURIComponent(clubId)}/coach-groups/${encodeURIComponent(coachGroupId)}/schedule`,
          { cache: "no-store" },
        );
        if (!cgResponse.ok) {
          const cgPayload = await cgResponse.json().catch(() => ({}));
          throw new Error((cgPayload as { error?: unknown }).error as string || "Неуспешно зареждане на графика.");
        }
        const cgPayload = await cgResponse.json();
        const nextWindowDates = Array.isArray(cgPayload.trainingDates)
          ? (cgPayload.trainingDates as unknown[])
              .map((v) => String(v ?? "").trim())
              .filter((v) => schedulerCalendarDateSet.has(v))
              .sort((a, b) => a.localeCompare(b))
          : [];
        const resolvedDateTimes = normalizeTrainingDateTimes(
          cgPayload.trainingDateTimes,
          nextWindowDates,
          typeof cgPayload.trainingTime === "string" ? cgPayload.trainingTime : null,
        );
        const resolvedUniformTime = getUniformTrainingTime(nextWindowDates, resolvedDateTimes);
        const resolvedFieldSelections = normalizeTrainingFieldSelections(
          cgPayload.trainingFieldSelections,
          nextWindowDates,
          { trainingFieldId: normalizeOptionalId(cgPayload.trainingFieldId), trainingFieldPieceIds: Array.isArray(cgPayload.trainingFieldPieceIds) ? cgPayload.trainingFieldPieceIds.map(String) : [] },
        );
        const coachGroupEditDates = editDate ? [editDate].filter(d => nextWindowDates.includes(d)) : [];
        setTrainingDaysPreExistingDates(nextWindowDates);
        setSchedulerForm((prev) => ({
          ...prev,
          trainingDates: coachGroupEditDates,
          trainingTime: resolvedUniformTime,
          trainingDurationMinutes: getTrainingDurationFormValue(cgPayload.trainingDurationMinutes),
          trainingFieldId: normalizeOptionalId(cgPayload.trainingFieldId) ?? "",
          trainingFieldPieceIds: Array.isArray(cgPayload.trainingFieldPieceIds) ? cgPayload.trainingFieldPieceIds.map(String) : [],
        }));
        setTrainingDaysInitialDates(coachGroupEditDates);
        setTrainingDaysInitialDurationMinutes(normalizeTrainingDurationInput(cgPayload.trainingDurationMinutes));
        setTrainingDaysInitialFieldId(normalizeOptionalId(cgPayload.trainingFieldId) ?? "");
        setTrainingDaysInitialFieldPieceIds(Array.isArray(cgPayload.trainingFieldPieceIds) ? cgPayload.trainingFieldPieceIds.map(String) : []);
        setTrainingDateTimes(resolvedDateTimes);
        setTrainingDaysInitialDateTimes(resolvedDateTimes);
        setTrainingFieldSelections(resolvedFieldSelections);
        setTrainingDaysInitialFieldSelections(resolvedFieldSelections);
        setTrainingFieldActiveDate(editDate ?? nextWindowDates[0] ?? "");
        setTrainingTimeMode(inferTrainingTimeMode(nextWindowDates, resolvedDateTimes));
        setTrainingDaysEditorOpen(true);
        return;
      }

      const search = new URLSearchParams();
      if (selectedTeamGroup !== null) {
        search.set("teamGroup", String(selectedTeamGroup));
      }
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/scheduler${search.size ? `?${search.toString()}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешно зареждане на графика.");
      }
      const payload = await response.json();
      const resolvedTrainingDates =
        mode === "createGroup"
          ? []
          : Array.isArray(payload.trainingDates)
            ? payload.trainingDates
              .map((value: unknown) => String(value ?? "").trim())
              .filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value))
              .sort((a: string, b: string) => a.localeCompare(b))
            : [];
      const resolvedDateTimes = mode === "createGroup"
        ? {}
        : normalizeTrainingDateTimes(
          payload.trainingDateTimes,
          resolvedTrainingDates,
          typeof payload.trainingTime === "string" ? payload.trainingTime : null,
        );
      const resolvedUniformTime = getUniformTrainingTime(resolvedTrainingDates, resolvedDateTimes);
      const resolvedFieldSelections = normalizeTrainingFieldSelections(
        payload.trainingFieldSelections,
        resolvedTrainingDates,
        { trainingFieldId: normalizeOptionalId(payload.trainingFieldId), trainingFieldPieceIds: Array.isArray(payload.trainingFieldPieceIds) ? payload.trainingFieldPieceIds.map(String) : [] },
      );
      const hasSecondReminder =
        Number.isInteger(payload.secondReminderDay) &&
        Number.isInteger(payload.secondReminderHour) &&
        Number.isInteger(payload.secondReminderMinute);
      const hasThirdReminder =
        Number.isInteger(payload.thirdReminderDay) &&
        Number.isInteger(payload.thirdReminderHour) &&
        Number.isInteger(payload.thirdReminderMinute);
      const teamGroupEditDates = editDate ? [editDate].filter(d => resolvedTrainingDates.includes(d)) : [];
      setTrainingDaysPreExistingDates(mode === "createGroup" ? [] : resolvedTrainingDates);
      setSchedulerForm({
        reminderDay: String(payload.reminderDay ?? 25),
        overdueDay: String(payload.overdueDay ?? 1),
        reminderHour: String(payload.reminderHour ?? 10),
        reminderMinute: String(payload.reminderMinute ?? 0),
        secondReminderDay: hasSecondReminder ? String(payload.secondReminderDay) : "",
        secondReminderHour: hasSecondReminder ? String(payload.secondReminderHour) : "10",
        secondReminderMinute: hasSecondReminder ? String(payload.secondReminderMinute) : "0",
        thirdReminderDay: hasThirdReminder ? String(payload.thirdReminderDay) : "",
        thirdReminderHour: hasThirdReminder ? String(payload.thirdReminderHour) : "10",
        thirdReminderMinute: hasThirdReminder ? String(payload.thirdReminderMinute) : "0",
        overdueHour: String(payload.overdueHour ?? 10),
        overdueMinute: String(payload.overdueMinute ?? 0),
        trainingDates: mode === "createGroup" ? [] : teamGroupEditDates,
        trainingTime: resolvedUniformTime,
        trainingDurationMinutes: getTrainingDurationFormValue(payload.trainingDurationMinutes),
        trainingFieldId: normalizeOptionalId(payload.trainingFieldId) ?? "",
        trainingFieldPieceIds: Array.isArray(payload.trainingFieldPieceIds) ? payload.trainingFieldPieceIds.map(String) : [],
      });
      setSecondReminderEnabled(hasSecondReminder);
      setThirdReminderEnabled(hasThirdReminder);
      setTrainingDaysInitialDates(mode === "createGroup" ? [] : teamGroupEditDates);
      setTrainingDaysInitialDurationMinutes(normalizeTrainingDurationInput(payload.trainingDurationMinutes));
      setTrainingDaysInitialFieldId(normalizeOptionalId(payload.trainingFieldId) ?? "");
      setTrainingDaysInitialFieldPieceIds(Array.isArray(payload.trainingFieldPieceIds) ? payload.trainingFieldPieceIds.map(String) : []);
      setTrainingDateTimes(resolvedDateTimes);
      setTrainingDaysInitialDateTimes(resolvedDateTimes);
      setTrainingFieldSelections(resolvedFieldSelections);
      setTrainingDaysInitialFieldSelections(resolvedFieldSelections);
      setTrainingFieldActiveDate(editDate ?? resolvedTrainingDates[0] ?? "");
      setTrainingTimeMode(inferTrainingTimeMode(resolvedTrainingDates, resolvedDateTimes));
      setTrainingDaysEditorOpen(true);
    } catch (error) {
      setTrainingDaysEditorError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingDaysEditorLoading(false);
    }
  };

  const executeTeamGroupTrainingDaysSave = async (affectedTrainingGroupsSnapshot: Array<{ id: string; name: string }>) => {
    const normalizedTrainingTime = schedulerForm.trainingTime.trim();
    if (hasMissingTrainingTime) {
      throw new Error("Въведете валиден час на тренировка (HH:mm).");
    }
    if (hasInvalidTrainingDuration) {
      throw new Error("Въведете продължителност на тренировката между 1 и 1440 минути.");
    }
    if (hasMissingTrainingField) {
      throw new Error(missingTrainingFieldMessage);
    }
    const _preExistingSet = new Set(trainingDaysPreExistingDates);
    const _mergedDates = [...trainingDaysPreExistingDates, ...schedulerForm.trainingDates.filter(d => !_preExistingSet.has(d))].sort((a, b) => a.localeCompare(b));
    const mergedTrainingDateTimes = buildMergedTrainingDateTimes(
      _mergedDates,
      trainingTimeMode === "all" ? normalizedTrainingTime : null,
    );
    const mergedTrainingFieldSelections = buildMergedTrainingFieldSelections(_mergedDates);
    const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/scheduler`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reminderDay: Number.parseInt(schedulerForm.reminderDay, 10),
        overdueDay: Number.parseInt(schedulerForm.overdueDay, 10),
        reminderHour: Number.parseInt(schedulerForm.reminderHour, 10),
        reminderMinute: Number.parseInt(schedulerForm.reminderMinute, 10),
        secondReminderDay: secondReminderEnabled ? Number.parseInt(schedulerForm.secondReminderDay, 10) : null,
        secondReminderHour: secondReminderEnabled ? Number.parseInt(schedulerForm.secondReminderHour, 10) : null,
        secondReminderMinute: secondReminderEnabled ? Number.parseInt(schedulerForm.secondReminderMinute, 10) : null,
        thirdReminderDay: thirdReminderEnabled ? Number.parseInt(schedulerForm.thirdReminderDay, 10) : null,
        thirdReminderHour: thirdReminderEnabled ? Number.parseInt(schedulerForm.thirdReminderHour, 10) : null,
        thirdReminderMinute: thirdReminderEnabled ? Number.parseInt(schedulerForm.thirdReminderMinute, 10) : null,
        overdueHour: Number.parseInt(schedulerForm.overdueHour, 10),
        overdueMinute: Number.parseInt(schedulerForm.overdueMinute, 10),
        trainingDates: _mergedDates,
        trainingTime: normalizedTrainingTime || null,
        trainingDurationMinutes: normalizedTrainingDurationSelection,
        trainingFieldId: primaryTrainingFieldSelection.trainingFieldId || null,
        trainingFieldPieceIds: primaryTrainingFieldSelection.trainingFieldPieceIds,
        trainingFieldSelections: mergedTrainingFieldSelections,
        trainingDateTimes: mergedTrainingDateTimes,
        conflictCheckDates: schedulerForm.trainingDates,
        teamGroup: selectedTeamGroup,
      }),
    });
    const schedulerPayload = await response.json().catch(() => ({})) as { error?: string; warning?: string };
    if (!response.ok) {
      throw new Error(schedulerPayload?.error || "Неуспешно запазване на тренировъчните дни.");
    }

    if (clubId && selectedTeamGroup !== null && schedulerForm.trainingDates.length > 0) {
      const scopeKey = `team_group:${selectedTeamGroup}`;
      const datesToLimit: Array<{ date: string; spots: number }> = schedulerPerDayLimited
        ? schedulerForm.trainingDates
            .filter((d) => schedulerPerDayConfig[d]?.limited)
            .map((d) => ({ date: d, spots: parseInt(schedulerPerDayConfig[d].spots, 10) }))
            .filter(({ spots }) => Number.isInteger(spots) && spots >= 1 && spots <= 200)
        : schedulerLimitedMode && isSchedulerLimitedSpotsValid
          ? schedulerForm.trainingDates.map((d) => ({ date: d, spots: schedulerLimitedSpotsValue }))
          : [];
      if (datesToLimit.length > 0) {
        await Promise.allSettled(datesToLimit.map(({ date, spots }) =>
          fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scopeKey, scopeId: null, teamGroup: selectedTeamGroup, trainingDate: date, maxSpots: spots }),
          })
        ));
      }
      const datesToNote = schedulerForm.trainingDates.filter((d) => (trainingDayScheduleNotes[d] ?? "").trim());
      if (datesToNote.length > 0) {
        await Promise.allSettled(datesToNote.map((date) =>
          fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trainingDate: date, note: trainingDayScheduleNotes[date]!.trim(), teamGroup: selectedTeamGroup }),
          })
        ));
      }
    }

    setTrainingDaysEditorCreateOpen(false);
    setTrainingDaysEditorGroupName("");
    setTrainingDaysEditorGroups([]);
    setTrainingDaysEditorOpen(false);
    const schedulerBaseMsg = _mergedDates.length > 1
      ? `Промените по графика са изпратени успешно за ${_mergedDates.length} дни.`
      : "Промените по графика са изпратени успешно.";
    setTrainingDaysSuccessMessage(schedulerPayload.warning ? `${schedulerBaseMsg} Внимание: ${schedulerPayload.warning}` : schedulerBaseMsg);
    setTrainingDaysSuccessOpen(true);
    const refreshedGroups = await loadTrainingScheduleGroups();
    await fetchTrainingAttendance(trainingAttendanceDate);
    if (affectedTrainingGroupsSnapshot.length > 0) {
      const firstExisting =
        refreshedGroups.find((group) => affectedTrainingGroupsSnapshot.some((item) => item.id === group.id)) ?? null;
      if (firstExisting) {
        setPostTeamGroupSavePromptGroupId(firstExisting.id);
        setPostTeamGroupSavePromptGroupName(firstExisting.name);
        setPostTeamGroupSavePromptOpen(true);
      }
    }
  };

  const saveTrainingDaysFromTrainingModal = async () => {
    if (!clubId || trainingDaysEditorSaving) return;
    setTrainingDaysEditorSaving(true);
    setTrainingDaysEditorError("");
    try {
      const affectedTrainingGroupsSnapshot = selectedTeamGroupLinkedTrainingGroups.map((group) => ({
        id: group.id,
        name: group.name,
      }));
      if (trainingDaysEditorMode === "trainingGroup" || trainingDaysEditorMode === "customGroup" || trainingDaysEditorMode === "coachGroup") {
        const normalizedTrainingTime = schedulerForm.trainingTime.trim();
        if (hasMissingTrainingTime) {
          throw new Error("Въведете валиден час на тренировка (HH:mm).");
        }
        if (hasInvalidTrainingDuration) {
          throw new Error("Въведете продължителност на тренировката между 1 и 1440 минути.");
        }
        if (hasMissingTrainingField) {
          throw new Error(missingTrainingFieldMessage);
        }
        const nextTrainingDates = schedulerForm.trainingDates
          .map((value) => String(value ?? "").trim())
          .filter((value) => schedulerCalendarDateSet.has(value))
          .sort((a, b) => a.localeCompare(b));
        const _groupPreExistingSet = new Set(trainingDaysPreExistingDates);
        const mergedTrainingDates = [...trainingDaysPreExistingDates, ...nextTrainingDates.filter(d => !_groupPreExistingSet.has(d))].sort((a, b) => a.localeCompare(b));
        const mergedTrainingDateTimesForPayload = buildMergedTrainingDateTimes(
          mergedTrainingDates,
          trainingTimeMode === "all" ? normalizedTrainingTime : null,
        );
        const mergedTrainingFieldSelectionsForPayload = buildMergedTrainingFieldSelections(mergedTrainingDates);
        const nextTrainingDateTimes = normalizeTrainingDateTimes(
          trainingDateTimes,
          nextTrainingDates,
          trainingTimeMode === "all" ? normalizedTrainingTime : null,
        );
        const nextTrainingDateTimesKey = nextTrainingDates
          .map((date) => `${date}:${nextTrainingDateTimes[date] ?? ""}`)
          .join("|");
        const initialTrainingDateTimesKey = normalizedTrainingDaysInitial
          .map((date) => `${date}:${normalizedTrainingDateTimesInitial[date] ?? ""}`)
          .join("|");
        if (
          nextTrainingDates.join("|") === normalizedTrainingDaysInitial.join("|") &&
          nextTrainingDateTimesKey === initialTrainingDateTimesKey &&
          normalizedTrainingDurationSelection === trainingDaysInitialDurationMinutes &&
          normalizedTrainingFieldSelectionsKey === normalizedTrainingFieldSelectionsInitialKey
        ) {
          throw new Error("Графикът е същият като предишния.");
        }
        const groupResponse = await fetch(
          trainingDaysEditorMode === "customGroup"
            ? `/api/admin/clubs/${encodeURIComponent(clubId)}/custom-training-groups/${encodeURIComponent(selectedTrainingGroupId)}`
            : trainingDaysEditorMode === "coachGroup"
              ? `/api/admin/clubs/${encodeURIComponent(clubId)}/coach-groups/${encodeURIComponent(coachGroupId)}/schedule`
              : `/api/admin/clubs/${encodeURIComponent(clubId)}/training-groups/${encodeURIComponent(selectedTrainingGroupId)}`,
          {
            method: trainingDaysEditorMode === "coachGroup" ? "PUT" : "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trainingDates: mergedTrainingDates,
              trainingTime: normalizedTrainingTime || null,
              trainingDurationMinutes: normalizedTrainingDurationSelection,
              trainingFieldId: primaryTrainingFieldSelection.trainingFieldId || null,
              trainingFieldPieceIds: primaryTrainingFieldSelection.trainingFieldPieceIds,
              trainingFieldSelections: mergedTrainingFieldSelectionsForPayload,
              trainingDateTimes: mergedTrainingDateTimesForPayload,
              conflictCheckDates: nextTrainingDates,
            }),
          },
        );
        const groupPayload = await groupResponse.json().catch(() => ({})) as { error?: string; warning?: string };
        if (!groupResponse.ok) {
          throw new Error(groupPayload.error || "Неуспешно запазване на тренировъчните дни.");
        }

        if (clubId && nextTrainingDates.length > 0) {
          let scopeKey = "";
          let scopeId: string | null = null;
          if (trainingDaysEditorMode === "customGroup") {
            scopeKey = `custom_group:${selectedTrainingGroupId}`;
            scopeId = selectedTrainingGroupId;
          } else if (trainingDaysEditorMode === "coachGroup") {
            scopeKey = `coach_group:${coachGroupId}`;
          }
          if (scopeKey) {
            const datesToLimit: Array<{ date: string; spots: number }> = schedulerPerDayLimited
              ? nextTrainingDates
                  .filter((d) => schedulerPerDayConfig[d]?.limited)
                  .map((d) => ({ date: d, spots: parseInt(schedulerPerDayConfig[d].spots, 10) }))
                  .filter(({ spots }) => Number.isInteger(spots) && spots >= 1 && spots <= 200)
              : schedulerLimitedMode && isSchedulerLimitedSpotsValid
                ? nextTrainingDates.map((d) => ({ date: d, spots: schedulerLimitedSpotsValue }))
                : [];
            if (datesToLimit.length > 0) {
              await Promise.allSettled(datesToLimit.map(({ date, spots }) =>
                fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ scopeKey, scopeId, teamGroup: null, trainingDate: date, maxSpots: spots }),
                })
              ));
            }
          }
          if (trainingDaysEditorMode !== "coachGroup") {
            const datesToNote = nextTrainingDates.filter((d) => (trainingDayScheduleNotes[d] ?? "").trim());
            if (datesToNote.length > 0) {
              const noteBody = (date: string) =>
                trainingDaysEditorMode === "customGroup"
                  ? { trainingDate: date, note: trainingDayScheduleNotes[date]!.trim(), customTrainingGroupId: selectedTrainingGroupId }
                  : { trainingDate: date, note: trainingDayScheduleNotes[date]!.trim(), trainingGroupId: selectedTrainingGroupId };
              await Promise.allSettled(datesToNote.map((date) =>
                fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(noteBody(date)),
                })
              ));
            }
          }
        }

        setTrainingDaysEditorCreateOpen(false);
        setTrainingDaysEditorGroupName("");
        setTrainingDaysEditorGroups([]);
        if (trainingDaysEditorMode === "coachGroup") {
          setTrainingDaysEditorOpen(false);
        } else if (trainingDaysEditorMode === "customGroup") {
          await loadCustomTrainingGroups();
          await fetchTrainingAttendance(trainingAttendanceDate);
          setTrainingDaysEditorOpen(false);
        } else {
          await loadTrainingScheduleGroups();
          await fetchTrainingAttendance(trainingAttendanceDate);
          setTrainingDaysEditorOpen(false);
        }
        const baseMsg = nextTrainingDates.length > 1
          ? `Промените по графика са изпратени успешно за ${nextTrainingDates.length} дни.`
          : "Промените по графика са изпратени успешно.";
        setTrainingDaysSuccessMessage(groupPayload.warning ? `${baseMsg} Внимание: ${groupPayload.warning}` : baseMsg);
        setTrainingDaysSuccessOpen(true);
        return;
      }

      if (
        normalizedTrainingDaysSelection.join("|") === normalizedTrainingDaysInitial.join("|") &&
        normalizedTrainingDateTimesSelectionKey === normalizedTrainingDateTimesInitialKey &&
        normalizedTrainingFieldSelectionsKey === normalizedTrainingFieldSelectionsInitialKey
      ) {
        throw new Error("Графикът е същият като предишния.");
      }
      if (selectedTeamGroupLinkedTrainingGroups.length > 0) {
        setPendingTeamGroupWarningGroups(affectedTrainingGroupsSnapshot);
        setTeamGroupWarningModalOpen(true);
        return;
      }
      await executeTeamGroupTrainingDaysSave(affectedTrainingGroupsSnapshot);
    } catch (error) {
      setTrainingDaysEditorError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingDaysEditorSaving(false);
    }
  };

  const saveTrainingDaysForSelectedGroups = async () => {
    if (!clubId || trainingDaysEditorSaving) return;
    setTrainingDaysEditorSaving(true);
    setTrainingDaysEditorError("");
    try {
      const selectedGroups = trainingDaysEditorGroups
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value));
      if (selectedGroups.length < 2) {
        throw new Error("Изберете поне 2 набора.");
      }
      const defaultName = selectedGroups.map((group) => String(group)).join("/");
      const createResponse = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trainingDaysEditorGroupName.trim() || defaultName,
          teamGroups: selectedGroups,
        }),
      });
      if (!createResponse.ok) {
        const payload = await createResponse.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешно създаване на сборен отбор.");
      }
      setTrainingDaysEditorOpen(false);
      await fetchTrainingAttendance(trainingAttendanceDate);
    } catch (error) {
      setTrainingDaysEditorError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingDaysEditorSaving(false);
    }
  };

  const openTrainingFieldModal = (field?: TrainingField) => {
    setTrainingFieldError("");
    if (field) {
      setTrainingFieldEditId(field.id);
      setTrainingFieldName(field.name);
      setTrainingFieldType(field.fieldType || "football");
      setTrainingFieldPieces(field.pieces.map((piece) => ({ id: piece.id, name: piece.name })));
    } else {
      setTrainingFieldEditId(null);
      setTrainingFieldName("");
      setTrainingFieldType(clubSport ? clubSportToFieldType(clubSport) : "football");
      setTrainingFieldPieces([]);
    }
    setTrainingFieldModalOpen(true);
  };

  const saveTrainingField = async () => {
    if (!clubId || trainingFieldSaving) return;
    setTrainingFieldSaving(true);
    setTrainingFieldError("");
    try {
      const endpoint = trainingFieldEditId
        ? `/api/admin/clubs/${encodeURIComponent(clubId)}/fields/${encodeURIComponent(trainingFieldEditId)}`
        : `/api/admin/clubs/${encodeURIComponent(clubId)}/fields`;
      const response = await fetch(endpoint, {
        method: trainingFieldEditId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trainingFieldName.trim(),
          fieldType: trainingFieldType,
          pieces: trainingFieldEditId
            ? trainingFieldPieces.map((piece) => ({ id: piece.id, name: piece.name.trim() }))
            : trainingFieldPieces.map((piece) => piece.name.trim()),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Неуспешно запазване на терена.");
      }
      const fields = await loadTrainingFields();
      const savedId = typeof payload?.id === "string" ? payload.id : trainingFieldEditId;
      if (savedId && (!schedulerForm.trainingFieldId || schedulerForm.trainingFieldId === trainingFieldEditId)) {
        const savedField = fields.find((field) => field.id === savedId);
        setSchedulerForm((prev) => ({
          ...prev,
          trainingFieldId: savedId,
          trainingFieldPieceIds: savedField?.pieces.length
            ? prev.trainingFieldPieceIds.filter((id) => savedField.pieces.some((p) => p.id === id))
            : [],
        }));
      }
      setTrainingFieldModalOpen(false);
    } catch (error) {
      setTrainingFieldError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingFieldSaving(false);
    }
  };

  const deleteTrainingField = async (fieldId: string) => {
    if (!clubId || trainingFieldSaving) return;
    setTrainingFieldSaving(true);
    setTrainingFieldError("");
    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/fields/${encodeURIComponent(fieldId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Неуспешно изтриване на терена.");
      }
      await loadTrainingFields();
      setSchedulerForm((prev) => prev.trainingFieldId === fieldId
        ? { ...prev, trainingFieldId: "", trainingFieldPieceIds: [] }
        : prev);
      setTrainingFieldModalOpen(false);
    } catch (error) {
      setTrainingFieldError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingFieldSaving(false);
    }
  };

  const saveSchedulerSettings = async () => {
    if (!clubId || schedulerSettingsSaving) return;
    setSchedulerSettingsSaving(true);
    setSchedulerSettingsError("");
    try {
      const normalizedTrainingTime = schedulerForm.trainingTime.trim();
      if (hasInvalidTrainingDuration) {
        throw new Error("Въведете продължителност на тренировката между 1 и 1440 минути.");
      }
      if (hasMissingTrainingField) {
        throw new Error(missingTrainingFieldMessage);
      }
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/scheduler`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminderDay: Number.parseInt(schedulerForm.reminderDay, 10),
          overdueDay: Number.parseInt(schedulerForm.overdueDay, 10),
          reminderHour: Number.parseInt(schedulerForm.reminderHour, 10),
          reminderMinute: Number.parseInt(schedulerForm.reminderMinute, 10),
          secondReminderDay: secondReminderEnabled ? Number.parseInt(schedulerForm.secondReminderDay, 10) : null,
          secondReminderHour: secondReminderEnabled ? Number.parseInt(schedulerForm.secondReminderHour, 10) : null,
          secondReminderMinute: secondReminderEnabled ? Number.parseInt(schedulerForm.secondReminderMinute, 10) : null,
          thirdReminderDay: thirdReminderEnabled ? Number.parseInt(schedulerForm.thirdReminderDay, 10) : null,
          thirdReminderHour: thirdReminderEnabled ? Number.parseInt(schedulerForm.thirdReminderHour, 10) : null,
          thirdReminderMinute: thirdReminderEnabled ? Number.parseInt(schedulerForm.thirdReminderMinute, 10) : null,
          overdueHour: Number.parseInt(schedulerForm.overdueHour, 10),
          overdueMinute: Number.parseInt(schedulerForm.overdueMinute, 10),
          trainingDates: schedulerForm.trainingDates,
          trainingTime: normalizedTrainingTime || null,
          trainingDurationMinutes: normalizedTrainingDurationSelection,
          trainingFieldId: primaryTrainingFieldSelection.trainingFieldId || null,
          trainingFieldPieceIds: primaryTrainingFieldSelection.trainingFieldPieceIds,
          trainingFieldSelections,
          trainingDateTimes: normalizeTrainingDateTimes(
            trainingDateTimes,
            schedulerForm.trainingDates,
            trainingTimeMode === "all" ? normalizedTrainingTime : null,
          ),
          teamGroup: selectedTeamGroup,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Неуспешно запазване на графика.");
      }
      setSchedulerSettingsOpen(false);
    } catch (error) {
      setSchedulerSettingsError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setSchedulerSettingsSaving(false);
    }
  };

  const handleTrainingTimeModeChange = (mode: TrainingTimeMode) => {
    setTrainingTimeMode(mode);
    if (mode === "all") {
      const current = schedulerForm.trainingTime.trim();
      if (TRAINING_TIME_REGEX.test(current)) {
        setTrainingDateTimes((prev) => {
          const next = { ...prev };
          for (const date of schedulerForm.trainingDates) {
            next[date] = current;
          }
          return next;
        });
      } else {
        const uniform = getUniformTrainingTime(schedulerForm.trainingDates, trainingDateTimes);
        if (uniform) {
          setSchedulerForm((prev) => ({ ...prev, trainingTime: uniform }));
        }
      }
    }
  };

  const handleTrainingAllTimeChange = (value: string) => {
    const nextValue = value.trim();
    setSchedulerForm((prev) => ({
      ...prev,
      trainingTime: nextValue,
    }));
    if (!TRAINING_TIME_REGEX.test(nextValue)) {
      return;
    }
    setTrainingDateTimes((prev) => {
      const next = { ...prev };
      for (const date of schedulerForm.trainingDates) {
        next[date] = nextValue;
      }
      return next;
    });
  };

  const handleTrainingDateTimeChange = (date: string, value: string) => {
    const nextValue = value.trim();
    setTrainingDateTimes((prev) => ({
      ...prev,
      [date]: nextValue,
    }));
  };

  const handleTrainingWeekdayTimeChange = (weekdayIndex: number, value: string) => {
    const nextValue = value.trim();
    setTrainingDateTimes((prev) => {
      const next = { ...prev };
      for (const date of schedulerForm.trainingDates) {
        if (getWeekdayMondayFirstIndex(date) === weekdayIndex) {
          next[date] = nextValue;
        }
      }
      return next;
    });
  };

  const toggleTrainingDate = (date: string) => {
    if (trainingDaysSingleEditDate === date) return;
    setSchedulerForm((prev) => {
      const hasDate = prev.trainingDates.includes(date);
      const nextDates = hasDate
        ? prev.trainingDates.filter((value) => value !== date)
        : [...prev.trainingDates, date].sort((a, b) => a.localeCompare(b));
      return {
        ...prev,
        trainingDates: nextDates,
      };
    });
    setTrainingDateTimes((prev) => {
      const next = { ...prev };
      const hasDate = Object.prototype.hasOwnProperty.call(next, date);
      if (hasDate) {
        delete next[date];
      } else if (trainingTimeMode === "all" && TRAINING_TIME_REGEX.test(schedulerForm.trainingTime.trim())) {
        next[date] = schedulerForm.trainingTime.trim();
      } else if (trainingTimeMode === "byWeekday") {
        const weekdayIndex = getWeekdayMondayFirstIndex(date);
        const weekdayMatch = schedulerForm.trainingDates.find(
          (existingDate) => getWeekdayMondayFirstIndex(existingDate) === weekdayIndex && TRAINING_TIME_REGEX.test((next[existingDate] ?? "").trim()),
        );
        if (weekdayMatch) {
          next[date] = (next[weekdayMatch] ?? "").trim();
        }
      }
      return next;
    });
  };

  const toggleTrainingNoteTargetDate = (date: string) => {
    setTrainingNoteTargetDates((prev) => {
      const hasDate = prev.includes(date);
      if (hasDate) {
        return prev.filter((value) => value !== date);
      }
      return [...prev, date].sort((a, b) => a.localeCompare(b));
    });
  };

  const fetchTrainingAttendance = async (
    date?: string,
    groupScopeOverride?: string,
    trainingGroupIdOverride?: string,
    viewOverride?: "teamGroup" | "trainingGroups",
    monthOverride?: string,
  ) => {
    if (!clubId) return;
    const resolvedView = viewOverride ?? trainingAttendanceView;
    const teamGroupFilter =
      resolvedView === "teamGroup"
        ? parseSelectedTeamGroup(groupScopeOverride ?? trainingGroupScope)
        : null;
    const trainingGroupFilter =
      resolvedView === "trainingGroups"
        ? (trainingGroupIdOverride ?? selectedTrainingGroupId).trim()
        : "";
    setTrainingAttendanceLoading(true);
    setTrainingAttendanceError("");
    try {
      const search = new URLSearchParams();
      if (date) {
        search.set("date", date);
      }
      const requestedMonth = monthOverride ?? (date ? getMonthKeyFromIsoDate(date) : trainingAttendanceMonth);
      search.set("month", requestedMonth);
      if (teamGroupFilter !== null) {
        search.set("teamGroup", String(teamGroupFilter));
      }
      if (trainingGroupFilter) {
        search.set(isCustomTrainingGroupMode ? "customTrainingGroupId" : "trainingGroupId", trainingGroupFilter);
      }
      const query = search.size ? `?${search.toString()}` : "";
      const response = await fetch(
        `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance${query}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно зареждане на присъствие.",
        );
      }

      const payload = await response.json();
      const players = Array.isArray(payload?.players)
        ? payload.players.map((item: unknown) => {
          const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
          return {
            id: String(raw.id ?? ""),
            fullName: String(raw.fullName ?? ""),
            teamGroup: typeof raw.teamGroup === "number" ? raw.teamGroup : null,
            cardCode: raw.cardCode ? String(raw.cardCode) : null,
            optedOut: Boolean(raw.optedOut),
          } satisfies TrainingAttendancePlayer;
        })
        : [];
      const upcomingDates = Array.isArray(payload?.upcomingDates)
        ? payload.upcomingDates
          .map((item: unknown) => {
            const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
            const rawStats =
              typeof raw.stats === "object" && raw.stats !== null
                ? (raw.stats as Record<string, unknown>)
                : {};
            return {
              date: String(raw.date ?? ""),
              weekday: Number(raw.weekday ?? 0),
              trainingTime:
                typeof raw.trainingTime === "string" && TRAINING_TIME_REGEX.test(raw.trainingTime.trim())
                  ? raw.trainingTime.trim()
                  : null,
              stats: {
                total: Number(rawStats.total ?? 0),
                attending: Number(rawStats.attending ?? 0),
                optedOut: Number(rawStats.optedOut ?? 0),
              },
            };
          })
          .filter((item: TrainingUpcomingDateItem) => /^\d{4}-\d{2}-\d{2}$/.test(item.date))
        : [];

      const resolvedDate = payload?.trainingDate || date || "";
      const resolvedScopeKey =
        resolvedView === "trainingGroups"
          ? `trainingGroup:${trainingGroupFilter || "-"}`
          : `teamGroup:${teamGroupFilter === null ? "all" : String(teamGroupFilter)}`;
      setTrainingAttendanceDate(resolvedDate);
      setTrainingAttendancePlayers(players);
      setTrainingAttendanceStats({
        total: Number(payload?.stats?.total ?? players.length),
        attending: Number(
          payload?.stats?.attending ??
          players.filter((player: TrainingAttendancePlayer) => !player.optedOut).length,
        ),
        optedOut: Number(
          payload?.stats?.optedOut ??
          players.filter((player: TrainingAttendancePlayer) => player.optedOut).length,
        ),
      });
      setTrainingUpcomingDates(upcomingDates);
      setTrainingNote(typeof payload?.note === "string" ? payload.note : "");
      if (resolvedDate) {
        setTrainingNotesByDate((prev) => ({
          ...prev,
          [`${resolvedScopeKey}|${resolvedDate}`]: typeof payload?.note === "string" ? payload.note : "",
        }));
      }
      setTrainingNoteTargetDates((prev) => {
        const allowedSet = new Set(upcomingDates.map((item: TrainingUpcomingDateItem) => item.date));
        const filtered = prev.filter((item) => allowedSet.has(item));
        if (filtered.length > 0) {
          return filtered;
        }
        return resolvedDate ? [resolvedDate] : [];
      });
      setTrainingDayDurationMinutes(
        typeof payload?.trainingDurationMinutes === "number" && payload.trainingDurationMinutes > 0
          ? payload.trainingDurationMinutes
          : DEFAULT_TRAINING_DURATION_MINUTES,
      );
      setTrainingDayTime(
        typeof payload?.trainingTime === "string" && TRAINING_TIME_REGEX.test(payload.trainingTime.trim())
          ? payload.trainingTime.trim()
          : null,
      );
      setTrainingPlayersExpanded(false);
      const rawField = payload?.trainingField;
      setTrainingDayField(
        rawField && typeof rawField === "object" && rawField !== null
          ? {
              id: String((rawField as Record<string, unknown>).id ?? ""),
              name: String((rawField as Record<string, unknown>).name ?? ""),
              fieldType: typeof (rawField as Record<string, unknown>).fieldType === "string"
                ? String((rawField as Record<string, unknown>).fieldType)
                : "football",
              pieces: Array.isArray((rawField as Record<string, unknown>).pieces)
                ? ((rawField as Record<string, unknown>).pieces as unknown[]).map((p) => {
                    const rp = typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
                    return { id: String(rp.id ?? ""), name: String(rp.name ?? "") };
                  })
                : [],
            }
          : null,
      );
      setTrainingDayFieldPieceIds(
        Array.isArray(payload?.trainingFieldPieceIds)
          ? (payload.trainingFieldPieceIds as unknown[]).map(String)
          : [],
      );
      setTrainingDaySessionCancelled(
        typeof payload?.sessionStatus === "string" ? payload.sessionStatus === "cancelled" : false,
      );
      setTrainingDayCancelConfirmOpen(false);
    } catch (error) {
      setTrainingAttendancePlayers([]);
      setTrainingAttendanceStats({ total: 0, attending: 0, optedOut: 0 });
      setTrainingUpcomingDates([]);
      setTrainingNote("");
      setTrainingNoteTargetDates([]);
      setTrainingDayDurationMinutes(DEFAULT_TRAINING_DURATION_MINUTES);
      setTrainingDayTime(null);
      setTrainingDayField(null);
      setTrainingDayFieldPieceIds([]);
      setTrainingDaySessionCancelled(false);
      setTrainingDayCancelConfirmOpen(false);
      setTrainingAttendanceError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingAttendanceLoading(false);
    }
  };

  const fetchTrainingWeekSessions = async (options?: { silent?: boolean }) => {
    if (!clubId) return;
    const showLoading = !options?.silent;
    if (showLoading) {
      setTrainingWeekLoading(true);
    }
    setTrainingAttendanceError("");
    try {
      const response = await fetch(
        `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance/week`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно зареждане на седмичния график.",
        );
      }
      const payload = await response.json();
      const dates: string[] = Array.isArray(payload?.dates)
        ? payload.dates.filter((d: unknown) => typeof d === "string")
        : [];
      const sessions: TrainingWeekSessionItem[] = Array.isArray(payload?.sessions)
        ? payload.sessions.map((item: unknown) => {
            const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
            return {
              id: String(raw.id ?? ""),
              date: String(raw.date ?? ""),
              trainingTime: typeof raw.trainingTime === "string" ? raw.trainingTime : null,
              scopeType: raw.scopeType === "trainingGroup" ? "trainingGroup" : "teamGroup",
              eventType: raw.eventType === "match" ? "match" : "training",
              label: String(raw.label ?? ""),
              teamGroups: Array.isArray(raw.teamGroups)
                ? (raw.teamGroups as unknown[]).map(Number).filter(Number.isInteger)
                : [],
              location: typeof raw.location === "string" ? raw.location : undefined,
              scopeLabel: typeof raw.scopeLabel === "string" ? raw.scopeLabel : undefined,
              isHome: typeof raw.isHome === "boolean" ? raw.isHome : undefined,
              durationMinutes: typeof raw.durationMinutes === "number" ? raw.durationMinutes : undefined,
              customGroupId: typeof raw.customGroupId === "string" ? raw.customGroupId : null,
              color: (() => {
                const c = typeof raw.color === "string" ? raw.color.trim() : "";
                return isCustomTrainingGroupPaletteColor(c) ? c : undefined;
              })(),
              limitedSpots: (() => {
                const ls = raw.limitedSpots;
                if (!ls || typeof ls !== "object") return null;
                const o = ls as Record<string, unknown>;
                if (typeof o.id !== "string" || typeof o.maxSpots !== "number" || typeof o.registeredCount !== "number") return null;
                return { id: o.id, maxSpots: o.maxSpots, registeredCount: o.registeredCount };
              })(),
            } satisfies TrainingWeekSessionItem;
          })
        : [];
      setTrainingWeekDates(dates);
      setTrainingWeekSessions(sessions);
      console.log("[WeekSchedule] sessions", sessions);
      return sessions;
    } catch (error) {
      if (showLoading) {
        setTrainingWeekDates([]);
        setTrainingWeekSessions([]);
      }
      setTrainingAttendanceError(error instanceof Error ? error.message : "Възникна грешка.");
      return [];
    } finally {
      if (showLoading) {
        setTrainingWeekLoading(false);
      }
    }
  };

  const openTrainingAttendance = async (options?: { hideTeamsTab?: boolean }) => {
    if (!clubId) return;
    const currentMonth = getTodayIsoDate().slice(0, 7);
    setTrainingAttendanceHideTeamsTab(Boolean(options?.hideTeamsTab));
    setTrainingAttendanceOpen(true);
    setTrainingAttendanceMonth(currentMonth);
    setPostTeamGroupSavePromptOpen(false);
    setTrainingAttendanceView("today");
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingNoteTargetDates([]);
    setWeekColorFilter(null);
    setSchedulerCalendarVisibleMonthIdx(0);
    setMatchCalendarVisibleMonthIdx(0);
    const [sessions = []] = await Promise.all([fetchTrainingWeekSessions(), fetchClubMatches()]);
    if (!options?.hideTeamsTab && sessions.length === 0) {
      setTrainingAttendanceView("trainingGroups");
      const groups = isCustomTrainingGroupMode
        ? (customTrainingGroups.length > 0 ? customTrainingGroups : await loadCustomTrainingGroups())
        : (trainingScheduleGroups.length > 0 ? trainingScheduleGroups : await loadTrainingScheduleGroups());
      const resolvedGroupId =
        selectedTrainingGroupId && groups.some((g) => g.id === selectedTrainingGroupId)
          ? selectedTrainingGroupId
          : (groups[0]?.id ?? "");
      setSelectedTrainingGroupId(resolvedGroupId);
      if (!resolvedGroupId) {
        if (!isCustomTrainingGroupMode && standaloneTeamGroups.length > 0) {
          const firstYear = String(standaloneTeamGroups[0]);
          setTrainingAttendanceView("teamGroup");
          setTrainingGroupScope(firstYear);
          await fetchTrainingAttendance(undefined, firstYear, undefined, "teamGroup");
          return;
        }
        return;
      }
      await fetchTrainingAttendance(undefined, undefined, resolvedGroupId, "trainingGroups");
    }
  };

  const handleTrainingGroupScopeChange = async (nextScope: string) => {
    setTrainingGroupScope(nextScope);
    if (!trainingAttendanceOpen) {
      return;
    }
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingAttendanceError("");
    setTrainingNoteTargetDates([]);
    await fetchTrainingAttendance(undefined, nextScope);
  };

  const handleTrainingAttendanceViewChange = async (nextView: "teamGroup" | "trainingGroups" | "today") => {
    if (trainingAttendanceHideTeamsTab && nextView !== "today") {
      return;
    }
    setTrainingAttendanceView(nextView);
    if (!trainingAttendanceOpen) {
      return;
    }
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingAttendanceError("");
    setTrainingNoteTargetDates([]);

    if (nextView === "today") {
      await fetchTrainingWeekSessions();
      return;
    }

    if (nextView === "teamGroup") {
      // Internally kept for standalone team group selections
      await fetchTrainingAttendance(undefined, resolvedTrainingGroupScope, undefined, "teamGroup");
      return;
    }

    const groups = isCustomTrainingGroupMode
      ? (customTrainingGroups.length > 0 ? customTrainingGroups : await loadCustomTrainingGroups())
      : (trainingScheduleGroups.length > 0 ? trainingScheduleGroups : await loadTrainingScheduleGroups());
    const resolvedGroupId =
      selectedTrainingGroupId && groups.some((group) => group.id === selectedTrainingGroupId)
        ? selectedTrainingGroupId
        : (groups[0]?.id ?? "");
    setSelectedTrainingGroupId(resolvedGroupId);
    if (!resolvedGroupId) {
      if (!isCustomTrainingGroupMode && standaloneTeamGroups.length > 0) {
        const firstYear = String(standaloneTeamGroups[0]);
        setTrainingAttendanceView("teamGroup");
        setTrainingGroupScope(firstYear);
        await fetchTrainingAttendance(undefined, firstYear, undefined, "teamGroup");
        return;
      }
      setTrainingAttendancePlayers([]);
      setTrainingAttendanceStats({ total: 0, attending: 0, optedOut: 0 });
      setTrainingUpcomingDates([]);
      setTrainingAttendanceDate("");
      return;
    }
    await fetchTrainingAttendance(undefined, undefined, resolvedGroupId, "trainingGroups");
  };

  const handleTrainingAttendanceMonthChange = async (delta: number) => {
    const nextMonth = addMonthsToMonthKey(trainingAttendanceMonth, delta);
    setTrainingAttendanceMonth(nextMonth);
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingAttendanceError("");
    setTrainingNoteTargetDates([]);
    await fetchTrainingAttendance(undefined, undefined, undefined, undefined, nextMonth);
  };

  const handleSelectedTrainingGroupChange = async (nextGroupId: string) => {
    setSelectedTrainingGroupId(nextGroupId);
    if (!trainingAttendanceOpen || trainingAttendanceView !== "trainingGroups") {
      return;
    }
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingAttendanceError("");
    setTrainingNoteTargetDates([]);
    await fetchTrainingAttendance(undefined, undefined, nextGroupId, "trainingGroups");
  };

  const handleUnifiedGroupChange = async (value: string) => {
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingAttendanceError("");
    setTrainingNoteTargetDates([]);
    setTrainingAttendanceHideTeamsTab(false);
    if (value.startsWith("year:")) {
      const yearStr = value.slice(5);
      setTrainingAttendanceView("teamGroup");
      setTrainingGroupScope(yearStr);
      if (trainingAttendanceOpen) {
        await fetchTrainingAttendance(undefined, yearStr, undefined, "teamGroup");
      }
    } else {
      setTrainingAttendanceView("trainingGroups");
      setSelectedTrainingGroupId(value);
      if (trainingAttendanceOpen && value) {
        await fetchTrainingAttendance(undefined, undefined, value, "trainingGroups");
      }
    }
  };

  const openTrainingDaysEditorForCurrentScope = async () => {
    if (trainingAttendanceView === "trainingGroups") {
      if (!selectedTrainingGroupId) {
        setTrainingAttendanceError("Изберете група.");
        return;
      }
      await openTrainingDaysEditor(isCustomTrainingGroupMode ? "customGroup" : "trainingGroup");
      return;
    }
    await openTrainingDaysEditor("teamGroup");
  };

  const openSingleTrainingDayEditForCurrentScope = async (date: string) => {
    if (trainingAttendanceView === "trainingGroups") {
      if (!selectedTrainingGroupId) return;
      await openTrainingDaysEditor(isCustomTrainingGroupMode ? "customGroup" : "trainingGroup", date);
      return;
    }
    await openTrainingDaysEditor("teamGroup", date);
  };

  const fetchClubMatches = async () => {
    if (!clubId) return;
    try {
      const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/matches`);
      if (res.ok) {
        const data = await res.json() as { matches: ClubMatch[] };
        setClubMatches(data.matches ?? []);
      }
    } catch {
      // non-critical
    }
  };

  const toggleMatchDate = (date: string) => {
    setMatchSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date].sort(),
    );
  };

  const handleSaveMatch = async () => {
    if (!clubId || matchSelectedDates.length === 0) return;
    setMatchEditorSaving(true);
    setMatchEditorError("");
    const warnings: string[] = [];
    try {
      for (const date of matchSelectedDates) {
        const details = matchDetailsPerDay[date] ?? { opponent: "", location: "", time: "", duration: "90", isHome: null };
        const durationMinutes = Number.parseInt(details.duration || "90", 10);
        const existingId = matchExistingIdByDate[date];
        const url = existingId
          ? `/api/admin/clubs/${encodeURIComponent(clubId)}/matches/${encodeURIComponent(existingId)}`
          : `/api/admin/clubs/${encodeURIComponent(clubId)}/matches`;
        const res = await fetch(url, {
          method: existingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opponent: details.opponent, location: details.location, matchDate: date, matchTime: details.time, durationMinutes, isHome: details.isHome, teamGroups: matchTeamGroups, customGroupId: isCustomTrainingGroupMode ? (selectedCustomGroup?.id ?? (weekColorFilter ? (customTrainingGroups.find((g) => g.color === weekColorFilter)?.id ?? null) : null) ?? (customTrainingGroups.length === 1 ? customTrainingGroups[0].id : null)) : null }),
        });
        const data = await res.json() as { error?: string; warning?: string };
        if (!res.ok) { setMatchEditorError(data.error ?? "Грешка при запазване."); return; }
        if (data.warning) warnings.push(data.warning);
      }
      setScheduleEventModalOpen(false);
      setMatchSelectedDates([]);
      setMatchDetailsPerDay({});
      setMatchTeamGroups([]);
      setMatchExistingIdByDate({});
      await Promise.all([fetchClubMatches(), fetchTrainingWeekSessions()]);
      if (warnings.length > 0) {
        setTrainingDaysSuccessMessage(`Мачът е запазен. Внимание: ${warnings[0]}`);
        setTrainingDaysSuccessOpen(true);
      }
    } catch {
      setMatchEditorError("Грешка при запазване.");
    } finally {
      setMatchEditorSaving(false);
    }
  };

  const handleDayDetailsMatchSave = async () => {
    if (!clubId || !dayDetailsActiveMatch) return;
    setDayDetailsMatchSaving(true);
    setDayDetailsMatchError("");
    try {
      const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/matches/${encodeURIComponent(dayDetailsActiveMatch.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponent: dayDetailsMatchEditForm.opponent,
          location: dayDetailsMatchEditForm.location,
          matchDate: dayDetailsMatchEditForm.matchDate,
          matchTime: dayDetailsMatchEditForm.matchTime,
          durationMinutes: Number.parseInt(dayDetailsMatchEditForm.durationMinutes || "90", 10),
          isHome: dayDetailsMatchEditForm.isHome,
          customGroupId: dayDetailsMatchEditForm.customGroupId,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setDayDetailsMatchError(data.error ?? "Грешка при запазване."); return; }
      setDayDetailsMatchEditOpen(false);
      if (matchEditTarget) {
        setTrainingDayDetailsOpen(false);
        setMatchEditTarget(null);
      }
      await Promise.all([fetchClubMatches(), fetchTrainingWeekSessions()]);
    } catch {
      setDayDetailsMatchError("Грешка при запазване.");
    } finally {
      setDayDetailsMatchSaving(false);
    }
  };

  const handleDayDetailsMatchDelete = async () => {
    if (!clubId || !dayDetailsActiveMatch) return;
    setDayDetailsMatchSaving(true);
    setDayDetailsMatchError("");
    try {
      const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/matches/${encodeURIComponent(dayDetailsActiveMatch.id)}`, { method: "DELETE" });
      if (!res.ok) { setDayDetailsMatchError("Грешка при изтриване."); setDayDetailsMatchSaving(false); return; }
      setTrainingDayDetailsOpen(false);
      setDayDetailsMatchDeleteConfirm(false);
      setDayDetailsMatchEditOpen(false);
      await Promise.all([fetchClubMatches(), fetchTrainingWeekSessions()]);
    } catch {
      setDayDetailsMatchError("Грешка при изтриване.");
    } finally {
      setDayDetailsMatchSaving(false);
    }
  };

  const handlePostTeamGroupSavePromptConfirm = async () => {
    setPostTeamGroupSavePromptOpen(false);
    setTrainingDayDetailsOpen(false);
    setTrainingBulkNoteOpen(false);
    setTrainingDaysEditorOpen(false);
    setTrainingDaysEditorError("");
    setTrainingAttendanceError("");
    setTrainingNoteTargetDates([]);
    setTrainingAttendanceHideTeamsTab(false);
    setTrainingAttendanceView("trainingGroups");
    if (postTeamGroupSavePromptGroupId) {
      setSelectedTrainingGroupId(postTeamGroupSavePromptGroupId);
      await fetchTrainingAttendance(undefined, undefined, postTeamGroupSavePromptGroupId, "trainingGroups");
      openTrainingGroupEditModal(postTeamGroupSavePromptGroupId);
    }
  };

  const handleTeamGroupWarningCancel = () => {
    setTeamGroupWarningModalOpen(false);
    setPendingTeamGroupWarningGroups([]);
  };

  const handleTeamGroupWarningConfirm = async () => {
    const snapshot = [...pendingTeamGroupWarningGroups];
    setTeamGroupWarningModalOpen(false);
    setPendingTeamGroupWarningGroups([]);
    if (snapshot.length === 0) {
      return;
    }

    setTrainingDaysEditorSaving(true);
    setTrainingDaysEditorError("");
    try {
      await executeTeamGroupTrainingDaysSave(snapshot);
    } catch (error) {
      setTrainingDaysEditorError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingDaysEditorSaving(false);
    }
  };

  const fetchLimitedEventForSession = async (date: string, sessionId: string) => {
    if (!clubId) return;
    const scopeKey = getScopeKeyFromSessionId(sessionId);
    if (!scopeKey) {
      setLimitedEvent(null);
      return;
    }
    setLimitedEventLoading(true);
    try {
      const url = `/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events?date=${encodeURIComponent(date)}&scopeKey=${encodeURIComponent(scopeKey)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) { setLimitedEvent(null); return; }
      const data: unknown = await res.json();
      const arr = Array.isArray(data) ? data : [];
      if (arr.length === 0) { setLimitedEvent(null); return; }
      const ev = arr[0] as { id: string; scopeKey: string; scopeId: string | null; teamGroup: number | null; trainingDate: string; maxSpots: number; registeredCount: number };
      // Fetch full event details with registrations
      const detailRes = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events/${encodeURIComponent(ev.id)}`, { cache: "no-store" });
      if (!detailRes.ok) { setLimitedEvent(null); return; }
      const detail = await detailRes.json() as { event: LimitedEventDetail; registrations: LimitedEventDetail["registrations"]; spotsRemaining: number };
      setLimitedEvent({
        ...detail.event,
        registrations: detail.registrations,
        spotsRemaining: detail.spotsRemaining,
      });
    } catch {
      setLimitedEvent(null);
    } finally {
      setLimitedEventLoading(false);
    }
  };

  const openTrainingDayDetails = async (date: string, sessionId?: string) => {
    setMatchEditTarget(null);
    const month = getMonthKeyFromIsoDate(date);
    setTrainingDayDetailsOpening(true);
    setTrainingDayDetailsViewSnapshot(trainingAttendanceView);
    setTrainingAttendanceDate(date);
    setTrainingAttendanceMonth(month);
    const firstSession = trainingWeekSessions.find((s) => s.date === date && s.eventType !== "match");
    const firstSessionId = sessionId ?? (firstSession?.id ?? "training");
    setTrainingDayDetailsTab(firstSessionId);
    setLimitedEvent(null);
    setShowLimitedForm(false);
    setLimitedEventError("");
    setLimitedSpotsInput("10");
    // Resolve scope from session ID so the right group data is fetched
    let _viewOverride: "teamGroup" | "trainingGroups" | undefined;
    let _groupScopeOverride: string | undefined;
    let _trainingGroupIdOverride: string | undefined;
    if (sessionId && !sessionId.startsWith("match-")) {
      const customM = sessionId.match(/^\d{4}-\d{2}-\d{2}-custom-(.+)$/);
      const groupM = sessionId.match(/^\d{4}-\d{2}-\d{2}-group-(.+)$/);
      const teamM = sessionId.match(/^\d{4}-\d{2}-\d{2}-team-(\d+)$/);
      if (customM) { _viewOverride = "trainingGroups"; _trainingGroupIdOverride = customM[1]; setTrainingAttendanceView("trainingGroups"); setSelectedTrainingGroupId(customM[1]); }
      else if (groupM) { _viewOverride = "trainingGroups"; _trainingGroupIdOverride = groupM[1]; setTrainingAttendanceView("trainingGroups"); setSelectedTrainingGroupId(groupM[1]); }
      else if (teamM) { _viewOverride = "teamGroup"; _groupScopeOverride = teamM[1]; setTrainingAttendanceView("teamGroup"); setTrainingGroupScope(teamM[1]); }
    }
    try {
      await Promise.all([
        fetchTrainingAttendance(date, _groupScopeOverride, _trainingGroupIdOverride, _viewOverride, month),
        fetchClubMatches(),
        fetchLimitedEventForSession(date, firstSessionId),
      ]);
      setTrainingDayDetailsOpen(true);
    } finally {
      setTrainingDayDetailsOpening(false);
    }
  };

  const loadDayDetailsSessionAttendance = async (session: TrainingWeekSessionItem, date: string) => {
    const month = getMonthKeyFromIsoDate(date);
    setTrainingDayDetailsTabLoading(true);
    try {
      if (session.scopeType === "teamGroup") {
        const tg = session.teamGroups[0];
        const groupScope = tg !== undefined && Number.isInteger(tg) ? String(tg) : "all";
        setTrainingAttendanceView("teamGroup");
        setTrainingGroupScope(groupScope);
        await fetchTrainingAttendance(date, groupScope, undefined, "teamGroup", month);
      } else {
        const groupPrefix = `${date}-group-`;
        const customPrefix = `${date}-custom-`;
        let groupId: string | null = null;
        if (session.id.startsWith(groupPrefix)) {
          groupId = session.id.slice(groupPrefix.length);
        } else if (session.id.startsWith(customPrefix)) {
          groupId = session.id.slice(customPrefix.length);
        }
        if (groupId) {
          setTrainingAttendanceView("trainingGroups");
          setSelectedTrainingGroupId(groupId);
          await fetchTrainingAttendance(date, undefined, groupId, "trainingGroups", month);
        }
      }
    } finally {
      setTrainingDayDetailsTabLoading(false);
    }
  };

  const handleCancelTrainingDay = async () => {
    if (!clubId || !trainingAttendanceDate || trainingDayCancelLoading) return;
    setTrainingDayCancelConfirmOpen(false);
    setTrainingDayCancelLoading(true);
    try {
      const body: Record<string, unknown> = { date: trainingAttendanceDate, status: "cancelled" };
      if (trainingAttendanceView === "trainingGroups" && selectedTrainingGroupId) {
        body[isCustomTrainingGroupMode ? "customTrainingGroupId" : "trainingGroupId"] = selectedTrainingGroupId;
      } else if (trainingAttendanceView === "teamGroup") {
        const tg = parseSelectedTeamGroup(trainingGroupScope);
        if (tg !== null) body.teamGroup = tg;
      }
      const res = await fetch(
        `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance/session`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Грешка при промяна на статус.");
      }
      setTrainingDayDetailsOpen(false);
      await Promise.all([fetchTrainingWeekSessions(), fetchTrainingAttendance()]);
    } catch (error) {
      setTrainingAttendanceError(error instanceof Error ? error.message : "Грешка при промяна на статус.");
    } finally {
      setTrainingDayCancelLoading(false);
    }
  };

  const saveTrainingNote = async () => {
    if (!clubId || trainingNoteSaving) return;
    setTrainingNoteSaving(true);
    setTrainingAttendanceError("");
    try {
      const targetDates =
        trainingNoteTargetDates.length > 0
          ? trainingNoteTargetDates
          : trainingAttendanceDate
            ? [trainingAttendanceDate]
            : [];
      if (targetDates.length === 0) {
        throw new Error("Select at least one training day for note.");
      }
      const nextNoteNormalized = trainingNote.trim();
      const teamGroupFilter =
        trainingAttendanceView === "teamGroup"
          ? selectedTeamGroup
          : null;
      const existingNotesByDate = await Promise.all(
        targetDates.map(async (targetDate) => {
          const search = new URLSearchParams({ date: targetDate });
          if (trainingAttendanceView === "trainingGroups") {
            if (selectedTrainingGroupId) {
              search.set(isCustomTrainingGroupMode ? "customTrainingGroupId" : "trainingGroupId", selectedTrainingGroupId);
            }
          } else if (teamGroupFilter !== null) {
            search.set("teamGroup", String(teamGroupFilter));
          }
          const response = await fetch(
            `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance?${search.toString()}`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(
              typeof payload?.error === "string" && payload.error.trim()
                ? payload.error.trim()
                : "Неуспешно зареждане на текущото описание.",
            );
          }
          const payload = await response.json().catch(() => ({}));
          return {
            date: targetDate,
            note: typeof payload?.note === "string" ? payload.note.trim() : "",
          };
        }),
      );
      const datesToSave = existingNotesByDate
        .filter((item) => item.note !== nextNoteNormalized)
        .map((item) => item.date);
      if (datesToSave.length === 0) {
        throw new Error("Описанието е същото като предишното за избраната дата.");
      }

      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingDate: datesToSave[0],
          note: trainingNote,
          ...(trainingAttendanceView === "trainingGroups"
            ? isCustomTrainingGroupMode
              ? { customTrainingGroupId: selectedTrainingGroupId || null }
              : { trainingGroupId: selectedTrainingGroupId || null }
            : { teamGroup: selectedTeamGroup }),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Неуспешно запазване на описание.",
        );
      }
      for (const targetDate of datesToSave.slice(1)) {
        const bulkResponse = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trainingDate: targetDate,
            note: trainingNote,
            ...(trainingAttendanceView === "trainingGroups"
              ? isCustomTrainingGroupMode
                ? { customTrainingGroupId: selectedTrainingGroupId || null }
                : { trainingGroupId: selectedTrainingGroupId || null }
              : { teamGroup: selectedTeamGroup }),
          }),
        });
        if (!bulkResponse.ok) {
          const payload = await bulkResponse.json().catch(() => ({}));
          throw new Error(
            typeof payload?.error === "string" && payload.error.trim()
              ? payload.error.trim()
              : `Failed saving note for ${targetDate}.`,
          );
        }
      }
      setTrainingNotesByDate((prev) => {
        const next = { ...prev };
        for (const date of datesToSave) {
          next[`${trainingNoteScopeKey}|${date}`] = trainingNote;
        }
        return next;
      });
      await fetchTrainingAttendance(trainingAttendanceDate || undefined);
      setTrainingBulkNoteOpen(false);
    } catch (error) {
      setTrainingAttendanceError(error instanceof Error ? error.message : "Възникна грешка.");
    } finally {
      setTrainingNoteSaving(false);
    }
  };

  useEffect(() => {
    if (!trainingBulkNoteOpen || !clubId) {
      setTrainingNoteComparisonLoading(false);
      return;
    }
    const missingDates = effectiveTrainingNoteTargetDates.filter(
      (date) => !Object.prototype.hasOwnProperty.call(trainingNotesByDate, `${trainingNoteScopeKey}|${date}`),
    );
    if (missingDates.length === 0) {
      setTrainingNoteComparisonLoading(false);
      return;
    }

    let cancelled = false;
    const loadMissingNotes = async () => {
      setTrainingNoteComparisonLoading(true);
      try {
        const fetched = await Promise.all(
          missingDates.map(async (targetDate) => {
            const search = new URLSearchParams({ date: targetDate });
            if (trainingAttendanceView === "trainingGroups") {
              if (selectedTrainingGroupId) {
                search.set(isCustomTrainingGroupMode ? "customTrainingGroupId" : "trainingGroupId", selectedTrainingGroupId);
              }
            } else if (trainingNoteTeamGroupFilter !== null) {
              search.set("teamGroup", String(trainingNoteTeamGroupFilter));
            }
            const response = await fetch(
              `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance?${search.toString()}`,
              { cache: "no-store" },
            );
            if (!response.ok) {
              const payload = await response.json().catch(() => ({}));
              throw new Error(
                typeof payload?.error === "string" && payload.error.trim()
                  ? payload.error.trim()
                  : "Неуспешно зареждане на текущото описание.",
              );
            }
            const payload = await response.json().catch(() => ({}));
            return [targetDate, typeof payload?.note === "string" ? payload.note : ""] as const;
          }),
        );
        if (cancelled) {
          return;
        }
        setTrainingNotesByDate((prev) => {
          const next = { ...prev };
          for (const [date, note] of fetched) {
            next[`${trainingNoteScopeKey}|${date}`] = note;
          }
          return next;
        });
      } catch (error) {
        if (!cancelled) {
          setTrainingAttendanceError(error instanceof Error ? error.message : "Възникна грешка.");
        }
      } finally {
        if (!cancelled) {
          setTrainingNoteComparisonLoading(false);
        }
      }
    };

    void loadMissingNotes();
    return () => {
      cancelled = true;
    };
  }, [
    trainingBulkNoteOpen,
    clubId,
    trainingAttendanceView,
    selectedTrainingGroupId,
    trainingNoteTeamGroupFilter,
    trainingNoteScopeKey,
    effectiveTrainingNoteTargetDatesKey,
    trainingNotesByDate,
  ]);

  useEffect(() => {
    if (!trainingAttendanceOpen || !clubId || !trainingAttendanceDate || trainingAttendanceView === "today") {
      return;
    }

    const search = new URLSearchParams({ date: trainingAttendanceDate });
    if (trainingAttendanceView === "trainingGroups") {
      if (selectedTrainingGroupId) {
        search.set(isCustomTrainingGroupMode ? "customTrainingGroupId" : "trainingGroupId", selectedTrainingGroupId);
      }
    } else if (selectedTeamGroup !== null) {
      search.set("teamGroup", String(selectedTeamGroup));
    }
    const streamUrl =
      `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance/stream` +
      `?${search.toString()}`;
    const source = new EventSource(streamUrl, { withCredentials: true });

    const handleUpdate = () => {
      void fetchTrainingAttendance(trainingAttendanceDate, undefined, undefined, undefined, trainingAttendanceMonth);
    };

    source.addEventListener("attendance-update", handleUpdate);

    return () => {
      source.removeEventListener("attendance-update", handleUpdate);
      source.close();
    };
  }, [trainingAttendanceOpen, clubId, trainingAttendanceDate, trainingAttendanceMonth, selectedTeamGroup, trainingAttendanceView, selectedTrainingGroupId]);

  // Live updates for the week view — re-fetch week sessions on any club attendance change
  useEffect(() => {
    if (!trainingAttendanceOpen || !clubId || trainingAttendanceView !== "today") {
      return;
    }
    const streamUrl = `/api/admin/clubs/${encodeURIComponent(clubId)}/training-attendance/stream`;
    const source = new EventSource(streamUrl, { withCredentials: true });
    const handleUpdate = () => {
      void fetchTrainingWeekSessions({ silent: true });
    };
    source.addEventListener("attendance-update", handleUpdate);
    return () => {
      source.removeEventListener("attendance-update", handleUpdate);
      source.close();
    };
  }, [trainingAttendanceOpen, clubId, trainingAttendanceView]);

  // Polling fallback — re-fetch every 15s while the Graf modal is open (covers SSE gaps on serverless)
  useEffect(() => {
    if (!trainingAttendanceOpen || !clubId || trainingAttendanceView !== "today") {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchTrainingWeekSessions({ silent: true });
    }, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [trainingAttendanceOpen, clubId, trainingAttendanceView]);

  // Re-fetch when admin tab becomes visible again (SSE drops while tab is backgrounded)
  useEffect(() => {
    if (!trainingAttendanceOpen || !clubId || trainingAttendanceView !== "today") {
      return;
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchTrainingWeekSessions({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [trainingAttendanceOpen, clubId, trainingAttendanceView]);

  return (
    <main className="amp-page">
      <div className="amp-dot-grid" aria-hidden="true" />

      <div className="amp-inner">
        <div style={{ display: "flex", alignItems: "center", marginBottom: "10px" }}>
          {(isAdmin || (isCoach && searchParams.has("coachGroupId"))) && (
            <button
              className="amp-back-btn amp-btn--compact"
              onClick={() => {
                if (searchParams.has("coachGroupId")) {
                  const params = new URLSearchParams(searchParams.toString());
                  params.delete("coachGroupId");
                  const query = params.toString();
                  router.push(`/admin/members${query ? `?${query}` : ""}`);
                  return;
                }
                router.push("/admin/players");
              }}
            >
              <ArrowLeftIcon />
              <span>Назад</span>
            </button>
          )}
          <div style={{ marginLeft: "auto" }}>
            <AdminLogoutButton />
          </div>
        </div>

        {/* ── Page header ── */}
        <div className="amp-header">
          <h1 className="amp-title">Списък състезатели</h1>
          <p className="amp-subtitle">Търсене, филтриране и ръчно отбелязване на плащания</p>
          <div className="amp-title-line" />
        </div>

        <div className="amp-club-info">
          <div className="amp-club-info-left">
            {clubLogoUrl ? (
              <img
                src={clubLogoUrl}
                alt={clubName}
                className="amp-club-logo"
              />
            ) : (
              <div className="amp-club-icon">🏆</div>
            )}
            <h2 className="amp-club-name">
              {clubName}
              {currentCoachGroupName && <span>{` - ${currentCoachGroupName}`}</span>}
              {clubId && clubBillingStatus && (
                <span className={`amp-billing-badge amp-billing-badge--${clubBillingStatus}`}>
                  {clubBillingStatus === "active" ? "Активен" : "Демо"}
                </span>
              )}
            </h2>
          </div>
          {clubId && (
            <div className="amp-modal-title-actions">
              <button
                className="amp-member-bell-btn"
                type="button"
                onClick={() => void handleOpenClubNotificationsPanel()}
                aria-label="All coach notifications"
              >
                <BellIcon />
                {clubNotificationsUnreadCount > 0 ? (
                  <span className="amp-member-bell-dot">
                    {clubNotificationsUnreadCount > 99 ? "99+" : clubNotificationsUnreadCount}
                  </span>
                ) : null}
              </button>
            </div>
          )}
        </div>

        {/* ── Buttons grid ── */}
        <div className="amp-buttons-grid">
          {(isAdmin || (isCoach && coachGroupId)) && (
            <button className="amp-add-btn" onClick={() => router.push(`/admin/members/add?clubId=${encodeURIComponent(clubId)}${coachGroupId ? `&coachGroupId=${encodeURIComponent(coachGroupId)}` : ""}`)}>
              <PlusIcon />
              Добави състезател
            </button>
          )}
          {clubId && coachGroupId && (
            <button
              className="amp-import-sheets-btn amp-btn--compact"
              type="button"
              title="Управление на състезатели в групата"
              onClick={() => openBulkCoachGroupModal(coachGroupId)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Управление на треньорска група</span>
            </button>
          )}
          {isAdmin && clubId && (
            <button className="amp-import-sheets-btn amp-btn--compact" onClick={() => setImportSheetsOpen(true)} type="button">
              <ImportSheetsIcon />
              <span>Импорт</span>
            </button>
          )}
          {isAdmin && clubId && (
            <button className="amp-import-sheets-btn amp-btn--compact" onClick={() => setImportPhotosOpen(true)} type="button">
              <PhotoImportIcon />
              <span>Снимки</span>
            </button>
          )}
          {isAdmin && clubId && (
            <button className="amp-import-sheets-btn amp-btn--compact" onClick={handleDownloadPlayersExcel} type="button">
              <DownloadIcon />
              <span>Excel</span>
            </button>
          )}
          {canViewInactiveMembers && (
            <button
              className="amp-inactive-toggle-btn amp-btn--compact"
              onClick={async () => {
                setInactiveActionError("");
                await refreshMembersList();
                setInactivePlayersOpen(true);
              }}
              type="button"
            >
              <UsersIcon />
              <span>Неактивни</span>
            </button>
          )}
          {isAdmin && clubId && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              onClick={openTrainingGroupModeSettings}
              type="button"
            >
              <UsersIcon />
              <span>Групи</span>
            </button>
          )}
          {(isAdmin || isCoach) && clubId && !coachGroupId && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              onClick={() => { void loadCoachGroups(); setCoachGroupsPanelOpen(true); }}
              type="button"
            >
              <UsersIcon />
              <span>Треньори</span>
            </button>
          )}
          {(isAdmin || (isCoach && coachGroupId)) && clubId && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              onClick={openTrainingGroupCreateModal}
              type="button"
              disabled={isCustomTrainingGroupMode && noFreeCustomTrainingGroupColor}
              title={isCustomTrainingGroupMode && noFreeCustomTrainingGroupColor ? "Всички цветове са заети" : undefined}
            >
              <PlusIcon />
              <span>Създай / редактирай група</span>
            </button>
          )}
          <button className="amp-reports-btn amp-btn--compact" onClick={() => setReportsOpen(true)}>
            <ChartColumnIcon size={16} />
            <span>Отчети</span>
          </button>
          {(isAdmin || isCoach) && clubId && (
            <>
              {isAdmin && (
                <button
                  className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
                  onClick={() => void openSchedulerSettings()}
                  type="button"
                >
                  <CalendarIcon />
                  <span>Напомняния</span>
                </button>
              )}
              <button
                className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
                onClick={() => {
                  if (coachGroupId) {
                    void openTrainingAttendance();
                  } else if (coachGroups.length >= 1) {
                    void openTrainingAttendance({ hideTeamsTab: true });
                  } else {
                    void openTrainingAttendance();
                  }
                }}
                type="button"
              >
                <UsersIcon />
                <span>График</span>
              </button>
              <button
                className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
                onClick={() => setAttendanceDashboardOpen(true)}
                type="button"
              >
                <ClipboardListIcon />
                <span>Присъствия</span>
              </button>
              {isAdmin && (
                <button
                  className="amp-btn amp-btn--ghost amp-btn--compact amp-training-plans-btn"
                  onClick={() => router.push(`/admin/training-plans?clubId=${encodeURIComponent(clubId)}`)}
                  type="button"
                >
                  <ClipboardListIcon />
                  <span>Планове за тренировки</span>
                </button>
              )}
              {isAdmin && (
                <button
                  className="amp-download-links-btn amp-btn--compact"
                  onClick={() => void handleDownloadMemberLinks()}
                  type="button"
                >
                  <DownloadIcon />
                  <span>Линкове</span>
                </button>
              )}
            </>
          )}
          {(isAdmin || isCoach) && clubId && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              onClick={openPaymentAmountModal}
              type="button"
            >
              <ReceiptIcon size={16} />
              <span>Месечна такса</span>
            </button>
          )}
          {(isAdmin || isCoach) && clubId === "0d877238-6f51-4ffe-b04f-d285904f5c8b" && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              onClick={() => void openRulesModal()}
              type="button"
            >
              <FileIcon size={16} />
              <span>Правилник</span>
            </button>
          )}
          {isAdmin && clubId && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              onClick={openPaymentWorkflowModal}
              type="button"
            >
              <ReceiptIcon size={16} />
              <span>Метод плащане</span>
            </button>
          )}
          {isAdmin && clubId && (
            <>
              <button
                className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
                onClick={() => router.push(`/admin/clubs/${encodeURIComponent(clubId)}/billing`)}
                type="button"
              >
                <span>Такси</span>
              </button>
              {canManageMemberActions && !coachGroupId && (
                <>
              <button
                className="amp-edit-team-btn amp-btn--compact"
                onClick={() => router.push(`/admin/teams/${encodeURIComponent(clubId)}/edit`)}
                disabled={isDeletingTeam}
              >
                <PencilIcon size={14} />
                <span>Редактирай</span>
              </button>
              <button
                className="amp-delete-team-btn amp-btn--compact"
                onClick={() => setIsTeamDeleteConfirmOpen(true)}
                disabled={isDeletingTeam}
                type="button"
              >
                <TrashIcon />
                <span>Изтрий</span>
              </button>
                </>
              )}
            </>
          )}
          {(isAdmin || isCoach) && clubId && (
            <button
              className="amp-download-links-btn amp-scheduler-settings-btn amp-btn--compact"
              type="button"
              onClick={() => {
                setNotifyPanelOpen(true);
                setNotifyMessage("");
                setNotifySelectedIds(new Set());
                setNotifySearchTerm(searchTerm);
                setNotifyGroupFilter(selectedGroup);
                setNotifyCoachGroupFilter("");
                setNotifyBusy(false);
                setNotifyError("");
                setNotifySuccess("");
              }}
            >
              <BellIcon />
              <span>Съобщение</span>
            </button>
          )}
          <button
            className="amp-guide-btn amp-btn--compact"
            type="button"
            onClick={() => { setGuideStep(0); setGuideOpen(true); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <circle cx="12" cy="17" r="0.5" fill="currentColor" />
            </svg>
            <span>Наръчник</span>
          </button>
        </div>
        {(isClubPushSupported || (isClubIPhone && !isClubStandalone)) && clubId && (
          <>
            {isClubPushSubscribed && (
              <div className="push-enabled-banner">
                <span className="push-enabled-check" aria-hidden="true">✓</span>
                <span className="push-enabled-text">Известията са активирани</span>
              </div>
            )}
            {(!isClubIPhone || isClubStandalone) && (
              isClubPushSubscribed ? (
                <button
                  className="bell-btn bell-btn--disable"
                  onClick={handleDisableClubNotifications}
                  disabled={clubPushBusy}
                >
                  {clubPushBusy ? <SpinnerIcon /> : <BellOffIcon />}
                  {clubPushBusy ? "Изключване..." : "Изключване на известия"}
                </button>
              ) : (
                <button
                  className="bell-btn"
                  onClick={handleEnableClubNotifications}
                  disabled={clubPushBusy}
                >
                  {clubPushBusy ? <SpinnerIcon /> : <BellIcon />}
                  {clubPushBusy ? "Активиране..." : "Активиране на известия"}
                </button>
              )
            )}
            {isClubIPhone && !isClubStandalone && (
              <>
                <button className="add-btn add-btn--white-text" onClick={() => setShowClubIphoneGuide((v) => !v)}>
                  <ShareIcon size={16} />
                  Добавете към начален екран
                </button>

                <p className="hint-text">
                  За да активирате известията на iPhone, натиснете бутона Share и изберете &ldquo;Добавяне към начален екран&rdquo;.
                </p>

                {showClubIphoneGuide && (
                  <div className="instr-box">
                    <button className="instr-close" onClick={() => setShowClubIphoneGuide(false)} aria-label="Затвори">
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
          </>
        )}

        {/* ── Content ── */}
        {clubPushStatusMessage && (
          <p className="amp-lbl" style={{ marginTop: "8px" }}>
            {clubPushStatusMessage}
          </p>
        )}
        {clubPushErrorMessage && <p className="amp-confirm-error">{clubPushErrorMessage}</p>}

        <div className="amp-content">

          {/* Coach group page links */}
          {!coachGroupId && coachGroups.length > 0 && (
            <div className="amp-coach-group-nav-list">
              {coachGroups.map((group) => (
                <div key={group.id} className="amp-coach-group-nav-row">
                  <button
                    className="amp-coach-group-nav-btn"
                    onClick={() => { window.location.href = `/admin/members?clubId=${encodeURIComponent(clubId)}&coachGroupId=${encodeURIComponent(group.id)}`; }}
                    type="button"
                  >
                    <span>{group.name}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                  <button
                    className="amp-coach-group-assign-btn"
                    type="button"
                    title="Управление на състезатели"
                    onClick={() => openBulkCoachGroupModal(group.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Group filter dropdown */}
          <div className="amp-edit-field" style={{ marginBottom: "10px", padding: "0", position: "relative" }}>
            <div
              className="amp-edit-input amp-edit-input-text-center"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}
              onClick={() => setIsGroupDropdownOpen(!isGroupDropdownOpen)}
            >
              {selectedGroup === "all"
                ? `Всички (${activeMembersCount})`
                : isCustomTrainingGroupMode
                  ? `${customTrainingGroups.find((g) => g.id === selectedGroup)?.name ?? selectedGroup} (${activeMembersByCustomGroup[selectedGroup] ?? 0})`
                  : `${selectedGroup} (${(activeMembersByGroup as Record<string, number>)[selectedGroup] ?? 0})`}
            </div>
            {isGroupDropdownOpen && (
              <>
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setIsGroupDropdownOpen(false)} />
                <div className="amp-custom-dropdown-menu" style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "4px", backgroundColor: "#1e1e1e", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "10px", zIndex: 999, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                  <div className={`amp-custom-dropdown-item ${selectedGroup === "all" ? "active" : ""}`} onClick={() => { setSelectedGroup("all"); setIsGroupDropdownOpen(false); }}>
                    Всички ({activeMembersCount})
                  </div>
                  {isCustomTrainingGroupMode
                    ? customTrainingGroups
                        .filter((g) => (activeMembersByCustomGroup[g.id] ?? 0) > 0)
                        .map((g) => (
                          <div key={g.id} className={`amp-custom-dropdown-item ${selectedGroup === g.id ? "active" : ""}`} onClick={() => { setSelectedGroup(g.id); setIsGroupDropdownOpen(false); }}>
                            {g.name} ({activeMembersByCustomGroup[g.id] ?? 0})
                          </div>
                        ))
                    : groupOptions.map((g) => (
                        <div key={g} className={`amp-custom-dropdown-item ${selectedGroup === String(g) ? "active" : ""}`} onClick={() => { setSelectedGroup(String(g)); setIsGroupDropdownOpen(false); }}>
                          {g} ({(activeMembersByGroup as Record<string, number>)[g] ?? 0})
                        </div>
                      ))}
                </div>
              </>
            )}
          </div>

          {/* Search */}
          <div className="amp-search-wrap">
            <SearchIcon />
            <input
              className="amp-search"
              type="text"
              placeholder="Търси по име или номер..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="amp-search-clear" onClick={() => setSearchTerm("")}>
                <XIcon />
              </button>
            )}
          </div>

          {/* Cards */}
          {loading ? (
            <div className="amp-loading">
              <div className="amp-spinner" />
            </div>
          ) : (
            <div className="amp-cards">
              {filtered.map((m) => (
                <PlayerCard
                  key={m.id}
                  member={m}
                  onClick={() => setSelectedMember(m)}
                  onEdit={openEditMember}
                  coachGroupName={!coachGroupId && m.coachGroupIds.length > 0 ? m.coachGroupIds.map((id) => coachGroups.find((g) => g.id === id)?.name ?? "").filter(Boolean).join(", ") : null}
                  coachGroupId={coachGroupId || null}
                />
              ))}
              {filtered.length === 0 && (
                <p className="amp-empty">Няма намерени състезатели</p>
              )}
            </div>
          )}

        </div>
      </div>

      {clubNotificationsPanelOpen ? (
        <div className="amp-overlay amp-overlay--member-notifications" onClick={() => setClubNotificationsPanelOpen(false)}>
          <div className="amp-modal amp-modal--member-notifications" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">{"\u0418\u0437\u0432\u0435\u0441\u0442\u0438\u044f \u0437\u0430 \u0442\u0440\u0435\u043d\u044c\u043e\u0440\u0438"}</span>
              <button className="amp-modal-close" onClick={() => setClubNotificationsPanelOpen(false)} aria-label={"\u0417\u0430\u0442\u0432\u043e\u0440\u0438"}>
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {clubNotificationsLoading ? (
                <p className="amp-empty amp-empty--modal">{"\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435..."}</p>
              ) : clubNotifications.length === 0 ? (
                <p className="amp-empty amp-empty--modal">{"\u041d\u044f\u043c\u0430 \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f"}</p>
              ) : (
                <>
                  <div className="amp-notification-filters">
                    <label className="amp-notification-filter amp-notification-filter--date">
                      <span>{"\u0414\u0430\u0442\u0430"}</span>
                      <div className="amp-notification-date-row">
                        <button
                          type="button"
                          className={`amp-btn amp-btn--ghost amp-notification-date-all-btn${clubNotificationsDateFilter ? "" : " amp-notification-date-all-btn--active"
                            }`}
                          onClick={() => setClubNotificationsDateFilter("")}
                        >
                          {"\u0412\u0441\u0438\u0447\u043a\u0438"}
                        </button>
                        <input
                          type="date"
                          className="amp-edit-input amp-notification-date-input"
                          value={clubNotificationsDateFilter}
                          max={todayIsoDate}
                          onChange={(event) => setClubNotificationsDateFilter(event.target.value)}
                        />
                      </div>
                    </label>
                    <label className="amp-notification-filter">
                      <span>{"\u0424\u0438\u043b\u0442\u044a\u0440 \u043f\u043e"}</span>
                      <select
                        className="amp-edit-input"
                        value={clubNotificationsScopeType}
                        onChange={(event) => {
                          const val = event.target.value;
                          const nextType = val === "trainingGroup" ? "trainingGroup" : val === "admin" ? "admin" : "team";
                          setClubNotificationsScopeType(nextType);
                          setClubNotificationsScopeValue("all");
                        }}
                      >
                        <option value="team">{"\u041e\u0442\u0431\u043e\u0440"}</option>
                        <option value="trainingGroup">{"\u0421\u0431\u043e\u0440\u0435\u043d \u043e\u0442\u0431\u043e\u0440"}</option>
                        <option value="admin">{"\u0410\u0434\u043c\u0438\u043d"}</option>
                      </select>
                    </label>
                    {clubNotificationsScopeType !== "admin" && (
                      <label className="amp-notification-filter">
                        <span>
                          {clubNotificationsScopeType === "team"
                            ? "\u0418\u0437\u0431\u0435\u0440\u0438 \u043e\u0442\u0431\u043e\u0440"
                            : "\u0418\u0437\u0431\u0435\u0440\u0438 \u0441\u0431\u043e\u0440\u0435\u043d \u043e\u0442\u0431\u043e\u0440"}
                        </span>
                        <select
                          className="amp-edit-input"
                          value={clubNotificationsScopeValue}
                          onChange={(event) => setClubNotificationsScopeValue(event.target.value)}
                        >
                          <option value="all">{"\u0412\u0441\u0438\u0447\u043a\u0438"}</option>
                          {clubNotificationsScopeType === "team"
                            ? clubNotificationTeamGroups.map((group) => (
                              <option key={group} value={String(group)}>
                                {group}
                              </option>
                            ))
                            : clubNotificationTrainingGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {filteredClubNotifications.length === 0 ? (
                    <p className="amp-empty amp-empty--modal">{"\u041d\u044f\u043c\u0430 \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f \u0437\u0430 \u0438\u0437\u0431\u0440\u0430\u043d\u0438\u0442\u0435 \u0444\u0438\u043b\u0442\u0440\u0438"}</p>
                  ) : (
                    <div className="amp-member-notifications-list">
                      {filteredClubNotifications.map((notif) => (
                        <article
                          key={notif.id}
                          className={`amp-member-notification-item${notif.readAt ? "" : " amp-member-notification-item--unread"}`}
                        >
                          <div className="amp-member-notification-head">
                            <h3>{notif.title}</h3>
                            {!notif.readAt ? <span className="amp-member-notification-new" aria-label={"\u041d\u043e\u0432\u043e"} /> : null}
                          </div>
                          {notif.type === "admin_message" || notif.type === "myteam_message" ? (
                            <span style={{ display: "inline-block", fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "9999px", background: "rgba(201,168,76,0.15)", color: "var(--accent-gold-color)", marginBottom: "6px" }}>
                              {notif.type === "myteam_message" ? "MYTEAM7" : "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440"}
                            </span>
                          ) : null}
                          <p style={{ whiteSpace: "pre-wrap" }}>{notif.body}</p>
                          <div className="amp-member-notification-meta">
                            {typeof notif.teamGroup === "number" ? <span>{"\u041e\u0442\u0431\u043e\u0440: "}{notif.teamGroup}</span> : null}
                            {Array.isArray(notif.trainingGroups) && notif.trainingGroups.length > 0 ? (
                              <span>{"\u0421\u0431\u043e\u0440\u0435\u043d \u043e\u0442\u0431\u043e\u0440: "}{notif.trainingGroups.map((group) => group.name).join(", ")}</span>
                            ) : null}
                          </div>
                          <time dateTime={notif.sentAt}>
                            {new Date(notif.sentAt).toLocaleDateString("bg-BG", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Detail modal */}
      {selectedMember && (
        <MemberDetailModal
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          actionMode={selectedMember.isActive ? "active" : "inactive"}
          isCoach={isCoach}
          showManagementActions={canManageMemberActions}
          onRequestEdit={openEditMember}
          onRequestDelete={(member) => {
            setDeleteError("");
            setMemberToDelete(member);
          }}
          onRequestReactivate={handleReactivateMember}
          onRequestPermanentDelete={(member) => {
            if (reactivatingMemberId || deletingPermanentMemberId) return;
            setInactiveActionError("");
            setMemberToPermanentDelete(member);
          }}
          isReactivating={reactivatingMemberId === selectedMember.id}
          isDeletingPermanent={deletingPermanentMemberId === selectedMember.id}
          coachGroups={(isAdmin || isCoach) && coachGroups.length > 0 ? coachGroups : undefined}
          onCoachGroupAssigned={(memberId, newCoachGroupIds) => {
            setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, coachGroupIds: newCoachGroupIds } : m));
            setSelectedMember((prev) => prev?.id === memberId ? { ...prev, coachGroupIds: newCoachGroupIds } : prev);
          }}
        />
      )}
      {memberToEdit && (
        <div className="amp-overlay" onClick={isSavingEdit ? undefined : closeEditModal}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Редактиране на състезател</span>
              <button
                className="amp-modal-close"
                onClick={closeEditModal}
                aria-label="Затвори"
                disabled={isSavingEdit || isAssigningNewCard}
              >
                <XIcon />
              </button>
            </h2>

            <div className={`amp-modal-body${trainingDayDetailsOpening ? " amp-modal-body--loading-only" : ""}`}>
              <div className="amp-edit-grid">
                <label className="amp-edit-field">
                  <span className="amp-lbl">Име и фамилия</span>
                  <input
                    className="amp-edit-input"
                    value={editForm.fullName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  />
                </label>
                {isAdmin && (
                  <label className="amp-edit-field">
                    <span className="amp-lbl">Club</span>
                    <select
                      className="amp-edit-input"
                      value={editForm.clubId}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, clubId: e.target.value }))}
                    >
                      <option value="" disabled>
                        Изберете отбор
                      </option>
                      {clubs.map((club) => (
                        <option key={club.id} value={club.id}>
                          {club.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="amp-edit-field">
                  <span className="amp-lbl">Номер в отбора</span>
                  <input
                    className="amp-edit-input"
                    value={editForm.jerseyNumber}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, jerseyNumber: e.target.value }))}
                  />
                </label>
                <label className="amp-edit-field">
                  <span className="amp-lbl">Телефон на родител</span>
                  <input
                    className="amp-edit-input"
                    type="tel"
                    value={editForm.parentPhone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, parentPhone: e.target.value }))}
                  />
                </label>
                <label className="amp-edit-field">
                  <span className="amp-lbl">Телефон на състезател</span>
                  <input
                    className="amp-edit-input"
                    type="tel"
                    value={editForm.playerPhone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, playerPhone: e.target.value }))}
                  />
                </label>
                <label className="amp-edit-field">
                  <span className="amp-lbl">Набор</span>
                  <input
                    className="amp-edit-input"
                    inputMode="numeric"
                    value={editForm.teamGroup}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        teamGroup: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                  />
                </label>
                <label className="amp-edit-field">
                  <span className="amp-lbl">Дата на раждане</span>
                  <input
                    className="amp-edit-input"
                    type="date"
                    value={editForm.birthDate}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, birthDate: e.target.value }))}
                  />
                </label>
                {!coachGroupId && (
                  <label className="amp-edit-field">
                    <span className="amp-lbl">Месечна такса</span>
                    <input
                      className="amp-edit-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.paymentAmount}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, paymentAmount: e.target.value }))}
                    />
                  </label>
                )}
                <label className="amp-edit-field amp-edit-field--full">
                  <span className="amp-lbl">Текуща снимка</span>
                  {editAvatarPreviewUrl || editForm.avatarUrl ? (
                    <img
                      src={editAvatarPreviewUrl || editForm.avatarUrl}
                      alt={editForm.fullName || "Player avatar"}
                      className="amp-edit-avatar-preview"
                    />
                  ) : (
                    <p className="amp-edit-image-empty">Няма качена снимка.</p>
                  )}
                </label>
                <label className="amp-edit-field amp-edit-field--full">
                  <span className="amp-lbl">Качи нова снимка</span>
                  <input
                    className="amp-edit-input amp-edit-input--file"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) {
                        const err = validateImageFile(file);
                        if (err) { setEditError(err); e.target.value = ""; return; }
                      }
                      setEditAvatarFile(file);
                    }}
                    disabled={isSavingEdit || isAssigningNewCard}
                  />
                </label>
                <div className="amp-edit-field amp-edit-field--full">
                  <span className="amp-lbl">Активна карта</span>
                  <div className="amp-modal-actions amp-modal-actions--end">
                    <p className="amp-val" style={{ marginRight: "auto" }}>
                      {memberToEdit.cards.find((card) => card.isActive)?.cardCode ||
                        memberToEdit.cards[0]?.cardCode ||
                        "Няма активна карта"}
                    </p>
                    {isAdmin && (
                      <button
                        className="amp-btn amp-btn--ghost"
                        onClick={() => setIsNewCardConfirmOpen(true)}
                        disabled={isSavingEdit || isAssigningNewCard}
                        type="button"
                      >
                        {isAssigningNewCard ? "Генериране..." : "Нова карта"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {editError && <p className="amp-confirm-error">{editError}</p>}

              <div className="amp-modal-actions">
                <button
                  className="amp-btn amp-btn--ghost"
                  onClick={closeEditModal}
                  disabled={isSavingEdit || isAssigningNewCard}
                >
                  Отказ
                </button>
                <button
                  className="amp-btn amp-btn--primary"
                  onClick={handleSaveMemberEdit}
                  disabled={isSavingEdit || isAssigningNewCard}
                >
                  {isSavingEdit ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {memberToEdit && isNewCardConfirmOpen && (
        <ConfirmNewCardModal
          member={memberToEdit}
          onCancel={() => {
            if (!isAssigningNewCard) {
              setIsNewCardConfirmOpen(false);
            }
          }}
          onConfirm={handleConfirmAssignNewCard}
          isAssigning={isAssigningNewCard}
        />
      )}
      {paymentWorkflowModalOpen && isAdmin && clubId && (
        <div className="amp-overlay" onClick={closePaymentWorkflowModal}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Метод на плащане</span>
              <button
                className="amp-modal-close"
                onClick={closePaymentWorkflowModal}
                aria-label="Затвори"
                disabled={paymentWorkflowSaving}
              >
                <XIcon />
              </button>
            </h2>

            <div className="amp-modal-body">
              <div className="amp-payment-workflow-picker" role="radiogroup" aria-label="Метод за плащане">
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentWorkflowDraft === "calendar_month"}
                  className={`amp-payment-workflow-option${paymentWorkflowDraft === "calendar_month" ? " is-selected" : ""}`}
                  onClick={() => {
                    setPaymentWorkflowDraft("calendar_month");
                    setPaymentWorkflowError("");
                    setPaymentWorkflowSuccess("");
                  }}
                  disabled={paymentWorkflowSaving}
                >
                  <span className="amp-payment-workflow-check" aria-hidden="true" />
                  <span className="amp-payment-workflow-copy">
                    <span className="amp-payment-workflow-title">Календарен месец</span>
                    <span className="amp-payment-workflow-desc">
                      Плащанията се отчитат по месеци. Състезателят е платен за избрания календарен месец, а статусът се изчислява спрямо текущия и предходния месец.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentWorkflowDraft === "rolling_30_days"}
                  className={`amp-payment-workflow-option${paymentWorkflowDraft === "rolling_30_days" ? " is-selected" : ""}`}
                  onClick={() => {
                    setPaymentWorkflowDraft("rolling_30_days");
                    setPaymentWorkflowError("");
                    setPaymentWorkflowSuccess("");
                  }}
                  disabled={paymentWorkflowSaving}
                >
                  <span className="amp-payment-workflow-check" aria-hidden="true" />
                  <span className="amp-payment-workflow-copy">
                    <span className="amp-payment-workflow-title">30 дни от датата на плащане</span>
                    <span className="amp-payment-workflow-desc">
                      Всяко плащане важи 30 дни от деня, в който е отчетено. Ако остават активни дни, треньорът вижда колко дни остават и не може да отчете ново плащане.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentWorkflowDraft === "training_credits"}
                  className={`amp-payment-workflow-option${paymentWorkflowDraft === "training_credits" ? " is-selected" : ""}`}
                  onClick={() => {
                    setPaymentWorkflowDraft("training_credits");
                    setPaymentWorkflowError("");
                    setPaymentWorkflowSuccess("");
                  }}
                  disabled={paymentWorkflowSaving}
                >
                  <span className="amp-payment-workflow-check" aria-hidden="true" />
                  <span className="amp-payment-workflow-copy">
                    <span className="amp-payment-workflow-title">Брой тренировки</span>
                    <span className="amp-payment-workflow-desc">
                      Треньорът задава колко тренировки остават при плащане. Всяко чекиране намалява броя с 1.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentWorkflowDraft === "training_credits_30_days"}
                  className={`amp-payment-workflow-option${paymentWorkflowDraft === "training_credits_30_days" ? " is-selected" : ""}`}
                  onClick={() => {
                    setPaymentWorkflowDraft("training_credits_30_days");
                    setPaymentWorkflowError("");
                    setPaymentWorkflowSuccess("");
                  }}
                  disabled={paymentWorkflowSaving}
                >
                  <span className="amp-payment-workflow-check" aria-hidden="true" />
                  <span className="amp-payment-workflow-copy">
                    <span className="amp-payment-workflow-title">Брой тренировки за 30 дни</span>
                    <span className="amp-payment-workflow-desc">
                      Плащането задава брой тренировки и 30-дневен срок. Играчът е просрочен, когато изтече срокът или тренировките станат 0.
                    </span>
                  </span>
                </button>
              </div>

              <p className="amp-payment-workflow-note">
                Избраният метод се прилага за всички състезатели в клуба.
              </p>

              {paymentWorkflowError && <p className="amp-confirm-error">{paymentWorkflowError}</p>}
              {paymentWorkflowSuccess && <p className="amp-confirm-success">{paymentWorkflowSuccess}</p>}

              <div className="amp-modal-actions">
                <button
                  className="amp-btn amp-btn--ghost"
                  type="button"
                  onClick={closePaymentWorkflowModal}
                  disabled={paymentWorkflowSaving}
                >
                  Отказ
                </button>
                <button
                  className="amp-btn amp-btn--primary"
                  type="button"
                  onClick={handleSavePaymentWorkflow}
                  disabled={paymentWorkflowSaving}
                >
                  {paymentWorkflowSaving ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {paymentAmountModalOpen && (isAdmin || isCoach) && clubId && (
        <div className="amp-overlay" onClick={closePaymentAmountModal}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Месечна такса</span>
              <button
                className="amp-modal-close"
                onClick={closePaymentAmountModal}
                aria-label="Затвори"
                disabled={paymentAmountSaving}
              >
                <XIcon />
              </button>
            </h2>

            <div className="amp-modal-body">
              <label className="amp-edit-field amp-edit-field--full">
                <span className="amp-lbl">Сума за клуба</span>
                <div className="amp-money-input-wrap">
                  <span className="amp-money-input-icon">€</span>
                  <input
                    className="amp-edit-input amp-money-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentAmountForm}
                    onChange={(e) => {
                      setPaymentAmountForm(e.target.value);
                      setPaymentAmountError("");
                      setPaymentAmountSuccess("");
                    }}
                    disabled={paymentAmountSaving}
                  />
                </div>
              </label>
              <p className="amp-confirm-text">
                Тази сума ще бъде зададена като стандартна за клуба и ще се приложи за всички състезатели.
              </p>

              {paymentAmountError && <p className="amp-confirm-error">{paymentAmountError}</p>}
              {paymentAmountSuccess && <p className="amp-confirm-success">{paymentAmountSuccess}</p>}

              <div className="amp-modal-actions">
                <button
                  className="amp-btn amp-btn--ghost"
                  type="button"
                  onClick={closePaymentAmountModal}
                  disabled={paymentAmountSaving}
                >
                  Отказ
                </button>
                <button
                  className="amp-btn amp-btn--primary"
                  type="button"
                  onClick={handleSavePaymentAmount}
                  disabled={paymentAmountSaving}
                >
                  {paymentAmountSaving ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {rulesModalOpen && (isAdmin || isCoach) && clubId && (
        <div className="amp-overlay" onClick={() => { if (!rulesUploading && !rulesDeletingId) setRulesModalOpen(false); }}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Правилник</span>
              <button
                className="amp-modal-close"
                onClick={() => setRulesModalOpen(false)}
                aria-label="Затвори"
                disabled={rulesUploading || !!rulesDeletingId}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {rulesLoading ? (
                <p className="amp-payment-workflow-note">Зареждане...</p>
              ) : (
                <>
                  {rulesDocs.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                      {rulesDocs.map((doc) => (
                        <div key={doc.id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <a
                            href={`/api/admin/clubs/${encodeURIComponent(clubId)}/rules/${encodeURIComponent(doc.id)}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="amp-btn amp-btn--primary"
                            style={{ flex: 1, textAlign: "center", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {doc.name}
                          </a>
                          <button
                            className="amp-btn amp-btn--danger"
                            type="button"
                            onClick={() => void handleRulesDelete(doc.id)}
                            disabled={!!rulesDeletingId || rulesUploading}
                            style={{ flexShrink: 0 }}
                          >
                            {rulesDeletingId === doc.id ? "..." : "Изтрий"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {rulesDocs.length === 0 && !rulesUploading && (
                    <p className="amp-payment-workflow-note" style={{ marginBottom: "8px" }}>Няма качени документи.</p>
                  )}
                  <label className={`amp-btn amp-btn--ghost`} style={{ display: "block", textAlign: "center", cursor: rulesUploading ? "default" : "pointer" }}>
                    {rulesUploading ? "Качване..." : "Качи PDF"}
                    <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => void handleRulesUpload(e)} disabled={rulesUploading || !!rulesDeletingId} />
                  </label>
                </>
              )}
              {rulesError && <p className="amp-confirm-error" style={{ marginTop: "8px" }}>{rulesError}</p>}
            </div>
          </div>
        </div>
      )}
      {memberToDelete && (
        <ConfirmDeleteModal
          member={memberToDelete}
          onCancel={() => {
            if (!isDeletingMember) {
              setDeleteError("");
              setMemberToDelete(null);
            }
          }}
          onConfirm={handleDeleteMember}
          isDeleting={isDeletingMember}
          error={deleteError}
        />
      )}
      {isTeamDeleteConfirmOpen && isAdmin && clubId && canManageMemberActions && (
        <ConfirmDeleteTeamModal
          teamName={clubName?.trim() || "този отбор"}
          isDeleting={isDeletingTeam}
          onCancel={() => {
            if (!isDeletingTeam) {
              setIsTeamDeleteConfirmOpen(false);
            }
          }}
          onConfirm={handleDeleteTeam}
        />
      )}
      {trainingGroupModeSettingsOpen && isAdmin && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => {
            if (!trainingGroupModeSaving) {
              setTrainingGroupModeSettingsOpen(false);
              setTrainingGroupModeError("");
            }
          }}
        >
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Настройки на групите</span>
              <button
                className="amp-modal-close"
                onClick={() => {
                  setTrainingGroupModeSettingsOpen(false);
                  setTrainingGroupModeError("");
                }}
                aria-label="Затвори"
                disabled={trainingGroupModeSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              <div className="amp-training-view-switch" style={{ marginBottom: "14px" }}>
                <button
                  type="button"
                  className={`amp-btn amp-btn--ghost amp-training-view-btn${trainingGroupModeDraft === "team_group" ? " is-active" : ""}`}
                  onClick={() => setTrainingGroupModeDraft("team_group")}
                  disabled={trainingGroupModeSaving}
                >
                  По набори
                </button>
                <button
                  type="button"
                  className={`amp-btn amp-btn--ghost amp-training-view-btn${trainingGroupModeDraft === "custom_group" ? " is-active" : ""}`}
                  onClick={() => setTrainingGroupModeDraft("custom_group")}
                  disabled={trainingGroupModeSaving}
                >
                  По избрани групи
                </button>
              </div>
              <p className="amp-lbl" style={{ whiteSpace: "normal", textAlign: "center" }}>
                Избраният начин ще определи как треньорите виждат групите и създават тренировъчни графици.
              </p>
              {trainingGroupModeError && <p className="amp-confirm-error">{trainingGroupModeError}</p>}
              <div className="amp-modal-actions amp-modal-actions--end">
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => {
                    setTrainingGroupModeSettingsOpen(false);
                    setTrainingGroupModeDraft(trainingGroupMode);
                    setTrainingGroupModeError("");
                  }}
                  disabled={trainingGroupModeSaving}
                >
                  Отказ
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--primary"
                  onClick={() => void saveTrainingGroupMode(trainingGroupModeDraft)}
                  disabled={trainingGroupModeSaving}
                >
                  {trainingGroupModeSaving ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {coachGroupsPanelOpen && (isAdmin || isCoach) && (
        <div className="amp-overlay amp-overlay--confirm" onClick={() => { setCoachGroupsPanelOpen(false); setCoachGroupCreateName(""); setCoachGroupCreateError(""); setCoachGroupDeleteId(null); setCoachGroupEditId(null); setCoachGroupEditName(""); setCoachGroupEditError(""); }}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Групи за треньори</span>
              <button className="amp-modal-close" onClick={() => { setCoachGroupsPanelOpen(false); setCoachGroupCreateName(""); setCoachGroupCreateError(""); setCoachGroupDeleteId(null); setCoachGroupEditId(null); setCoachGroupEditName(""); setCoachGroupEditError(""); }} aria-label="Затвори">
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {/* Create form */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                <input
                  className="amp-edit-input"
                  placeholder="Ново име на група"
                  value={coachGroupCreateName}
                  onChange={(e) => { setCoachGroupCreateName(e.target.value); setCoachGroupCreateError(""); }}
                  disabled={coachGroupCreateSaving}
                  maxLength={100}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="amp-btn amp-btn--primary amp-btn--compact"
                  disabled={coachGroupCreateSaving || !coachGroupCreateName.trim()}
                  onClick={async () => {
                    const name = coachGroupCreateName.trim();
                    if (!name || !clubId) return;
                    setCoachGroupCreateSaving(true);
                    setCoachGroupCreateError("");
                    try {
                      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/coach-groups`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      if (!response.ok) {
                        const payload = await response.json().catch(() => ({}));
                        throw new Error(String((payload as { error?: unknown }).error ?? "Грешка"));
                      }
                      setCoachGroupCreateName("");
                      void loadCoachGroups();
                    } catch (err) {
                      setCoachGroupCreateError(err instanceof Error ? err.message : "Грешка");
                    } finally {
                      setCoachGroupCreateSaving(false);
                    }
                  }}
                >
                  {coachGroupCreateSaving ? "..." : "Създай"}
                </button>
              </div>
              {coachGroupCreateError && <p className="amp-confirm-error" style={{ marginBottom: "8px" }}>{coachGroupCreateError}</p>}

              {/* Group list */}
              {coachGroups.length === 0 ? (
                <p className="amp-empty amp-empty--modal">Няма групи за треньори.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {coachGroups.map((group) => (
                    <div key={group.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {coachGroupEditId === group.id ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <input
                              className="amp-edit-input"
                              value={coachGroupEditName}
                              onChange={(e) => { setCoachGroupEditName(e.target.value); setCoachGroupEditError(""); }}
                              disabled={coachGroupEditSaving}
                              maxLength={100}
                              style={{ flex: 1 }}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="amp-btn amp-btn--primary amp-btn--compact"
                              disabled={coachGroupEditSaving || !coachGroupEditName.trim() || coachGroupEditName.trim() === group.name}
                              onClick={async () => {
                                const name = coachGroupEditName.trim();
                                if (!name || !clubId) return;
                                setCoachGroupEditSaving(true);
                                setCoachGroupEditError("");
                                try {
                                  const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/coach-groups/${encodeURIComponent(group.id)}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ name }),
                                  });
                                  if (!response.ok) {
                                    const payload = await response.json().catch(() => ({}));
                                    throw new Error(String((payload as { error?: unknown }).error ?? "Грешка"));
                                  }
                                  setCoachGroupEditId(null);
                                  setCoachGroupEditName("");
                                  void loadCoachGroups();
                                } catch (err) {
                                  setCoachGroupEditError(err instanceof Error ? err.message : "Грешка");
                                } finally {
                                  setCoachGroupEditSaving(false);
                                }
                              }}
                            >
                              {coachGroupEditSaving ? "..." : "Запиши"}
                            </button>
                            <button
                              type="button"
                              className="amp-btn amp-btn--ghost amp-btn--compact"
                              disabled={coachGroupEditSaving}
                              onClick={() => { setCoachGroupEditId(null); setCoachGroupEditName(""); setCoachGroupEditError(""); }}
                            >
                              Отказ
                            </button>
                          </div>
                          {coachGroupEditError && <p className="amp-confirm-error" style={{ margin: 0 }}>{coachGroupEditError}</p>}
                        </div>
                      ) : (
                        <>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 500 }}>{group.name}</span>
                            <span style={{ marginLeft: "8px", fontSize: "0.8rem", opacity: 0.6 }}>{group.playerCount} Състезатели</span>
                          </div>
                          {coachGroupDeleteId !== group.id && (
                            <button
                              type="button"
                              className="amp-btn amp-btn--ghost amp-btn--compact"
                              onClick={async () => {
                                const url = `${window.location.origin}/admin/members?clubId=${encodeURIComponent(clubId)}&coachGroupId=${encodeURIComponent(group.id)}`;
                                try {
                                  await navigator.clipboard.writeText(url);
                                  setCoachGroupCopiedId(group.id);
                                  setTimeout(() => setCoachGroupCopiedId(null), 2000);
                                } catch {
                                  const tmp = document.createElement("input");
                                  tmp.value = url;
                                  document.body.appendChild(tmp);
                                  tmp.select();
                                  document.execCommand("copy");
                                  document.body.removeChild(tmp);
                                  setCoachGroupCopiedId(group.id);
                                  setTimeout(() => setCoachGroupCopiedId(null), 2000);
                                }
                              }}
                              style={{ minWidth: "90px" }}
                            >
                              {coachGroupCopiedId === group.id ? "Копирано!" : "Копирай линк"}
                            </button>
                          )}
                          {coachGroupDeleteId === group.id ? (
                            <>
                              <button
                                type="button"
                                className="amp-btn amp-btn--danger amp-btn--compact"
                                disabled={coachGroupDeleteSaving}
                                onClick={async () => {
                                  if (!clubId) return;
                                  setCoachGroupDeleteSaving(true);
                                  try {
                                    const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/coach-groups/${encodeURIComponent(group.id)}`, { method: "DELETE" });
                                    if (!response.ok) throw new Error("Грешка при изтриване");
                                    setCoachGroupDeleteId(null);
                                    void loadCoachGroups();
                                    void refreshMembersList();
                                  } catch {
                                    // ignore
                                  } finally {
                                    setCoachGroupDeleteSaving(false);
                                  }
                                }}
                              >
                                {coachGroupDeleteSaving ? "..." : "Потвърди"}
                              </button>
                              <button type="button" className="amp-btn amp-btn--ghost amp-btn--compact" disabled={coachGroupDeleteSaving} onClick={() => setCoachGroupDeleteId(null)}>
                                Отказ
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="amp-btn amp-btn--ghost amp-btn--icon-only"
                                title="Редактирай"
                                onClick={() => { setCoachGroupEditId(group.id); setCoachGroupEditName(group.name); setCoachGroupEditError(""); setCoachGroupDeleteId(null); }}
                              >
                                <PencilIcon size={14} />
                              </button>
                              <button type="button" className="amp-btn amp-btn--ghost amp-btn--compact" onClick={() => setCoachGroupDeleteId(group.id)}>
                                Изтрий
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {trainingGroupDeleteConfirmOpen && (
        <ConfirmDeleteTrainingGroupModal
          groupName={
            (isCustomTrainingGroupMode
              ? customTrainingGroups.find((group) => group.id === selectedTrainingGroupId)?.name?.trim()
              : trainingScheduleGroups.find((group) => group.id === selectedTrainingGroupId)?.name?.trim()) ||
            (isCustomTrainingGroupMode ? "тази група" : "този сборен отбор")
          }
          isCustomGroup={isCustomTrainingGroupMode}
          isDeleting={trainingGroupDeleteSaving}
          onCancel={() => {
            if (!trainingGroupDeleteSaving) {
              setTrainingGroupDeleteConfirmOpen(false);
            }
          }}
          onConfirm={() => void deleteSelectedTrainingGroup()}
        />
      )}
      {reportsOpen && (
        <ReportsDialog
          onClose={() => setReportsOpen(false)}
          clubId={clubId}
          coachGroupId={coachGroupId}
          coachGroupName={currentCoachGroupName}
        />
      )}
      {attendanceDashboardOpen && clubId && (
        <AttendanceDashboard
          onClose={() => setAttendanceDashboardOpen(false)}
          clubId={clubId}
          coachGroupId={coachGroupId}
          coachGroupName={currentCoachGroupName}
        />
      )}

      {matchViewPopupOpen && matchViewMatch && (
        <div className="amp-overlay amp-overlay--confirm" onClick={() => setMatchViewPopupOpen(false)}>
          <div className="amp-modal amp-modal--match-view" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient amp-modal-title-gradient--match">Мач</span>
              <button className="amp-modal-close" onClick={() => setMatchViewPopupOpen(false)} aria-label="Затвори">
                <XIcon />
              </button>
            </h2>
            <p className="amp-match-view-date">
              {new Date(`${matchViewMatch.matchDate}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
            <div className="amp-match-view-body">
              <div className="amp-match-view-row">
                <span className="amp-match-view-label">Противник</span>
                <span className="amp-match-view-value">{matchViewMatch.opponent}</span>
              </div>
              <div className="amp-match-view-row">
                <span className="amp-match-view-label">Час</span>
                <span className="amp-match-view-value">{matchViewMatch.matchTime}</span>
              </div>
              <div className="amp-match-view-row">
                <span className="amp-match-view-label">Място</span>
                <span className="amp-match-view-value">{matchViewMatch.location}</span>
              </div>
              <div className="amp-match-view-row">
                <span className="amp-match-view-label">Домакин/Гост</span>
                <span className={`amp-match-view-badge${matchViewMatch.isHome ? " amp-match-view-badge--home" : " amp-match-view-badge--away"}`}>
                  {matchViewMatch.isHome ? "Домакин" : "Гост"}
                </span>
              </div>
              {matchViewMatch.durationMinutes > 0 && (
                <div className="amp-match-view-row">
                  <span className="amp-match-view-label">Продължителност</span>
                  <span className="amp-match-view-value">{matchViewMatch.durationMinutes} мин</span>
                </div>
              )}
            </div>
            <div className="amp-modal-actions amp-modal-actions--end" style={{ marginTop: "8px" }}>
              <button
                type="button"
                className="amp-btn amp-btn--ghost"
                onClick={() => {
                  setDayDetailsMatchEditForm({
                    opponent: matchViewMatch.opponent,
                    location: matchViewMatch.location,
                    matchDate: matchViewMatch.matchDate,
                    matchTime: matchViewMatch.matchTime,
                    durationMinutes: String(matchViewMatch.durationMinutes),
                    isHome: matchViewMatch.isHome,
                    customGroupId: matchViewMatch.customGroupId,
                  });
                  setDayDetailsMatchError("");
                  setDayDetailsMatchDeleteConfirm(false);
                  setDayDetailsMatchEditOpen(true);
                  setMatchViewPopupOpen(false);
                  setMatchEditTarget(matchViewMatch);
                  setTrainingDayDetailsViewSnapshot(trainingAttendanceView);
                  setTrainingAttendanceDate(matchViewMatch.matchDate);
                  setTrainingDayDetailsTab(`match-${matchViewMatch.id}`);
                  setTrainingDayDetailsOpening(false);
                  setTrainingDayDetailsOpen(true);
                }}
              >
                Редактирай
              </button>
            </div>
          </div>
        </div>
      )}
      {trainingAttendanceOpen && (
        <div
          className="amp-overlay"
          onClick={() => {
            if (!trainingNoteSaving) {
              setTrainingAttendanceOpen(false);
              setTrainingAttendanceHideTeamsTab(false);
              setTrainingDayDetailsOpen(false);
              setTrainingDaysEditorOpen(false);
            }
          }}
        >
          <div
            className={`amp-modal amp-modal--confirm amp-modal--training-attendance${trainingAttendanceView === "today" ? " amp-modal--week-view" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Текущ график</span>
              <button
                className="amp-modal-close"
                onClick={() => {
                  setTrainingAttendanceOpen(false);
                  setTrainingAttendanceHideTeamsTab(false);
                  setTrainingDayDetailsOpen(false);
                  setTrainingDaysEditorOpen(false);
                }}
                aria-label="Затвори"
                disabled={trainingNoteSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {trainingAttendanceHideTeamsTab ? (
                <div className="amp-training-view-switch amp-training-view-switch--single" role="presentation">
                  <span className="amp-training-view-single-label">Тази седмица</span>
                </div>
              ) : (
                <div className="amp-training-view-switch">
                  <button
                    type="button"
                    className={`amp-btn amp-btn--ghost amp-training-view-btn${trainingAttendanceView === "today" ? " is-active" : ""}`}
                    onClick={() => void handleTrainingAttendanceViewChange("today")}
                    disabled={trainingAttendanceLoading || trainingWeekLoading || trainingNoteSaving || trainingDaysEditorSaving}
                  >
                    Тази седмица
                  </button>
                  <button
                    type="button"
                    className={`amp-btn amp-btn--ghost amp-training-view-btn${trainingAttendanceView !== "today" ? " is-active" : ""}`}
                    onClick={() => void handleTrainingAttendanceViewChange("trainingGroups")}
                    disabled={trainingAttendanceLoading || trainingNoteSaving || trainingDaysEditorSaving}
                  >
                    Създай график
                  </button>
                </div>
              )}
              {trainingAttendanceView === "today" ? (
                <div className="amp-training-week-panel">
                  {trainingWeekLoading ? (
                    <p className="amp-empty amp-empty--modal">Зареждане...</p>
                  ) : trainingWeekSessions.length === 0 ? (
                    <p className="amp-empty amp-empty--modal">Няма насрочени събития за следващите 7 дни.</p>
                  ) : (
                    <>
                      {weekSessionColorOptions.length > 0 && (
                        <div
                          role="group"
                          aria-label="Филтър по група"
                          style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px", justifyContent: "center" }}
                        >
                          {weekSessionColorOptions.map(({ color, label }) => (
                            <button
                              key={color}
                              type="button"
                              aria-pressed={weekColorFilter === color}
                              aria-label={label || color}
                              title={label || undefined}
                              onClick={() => setWeekColorFilter(weekColorFilter === color ? null : color)}
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "50%",
                                backgroundColor: color,
                                border: weekColorFilter === color ? "3px solid #fff" : "2px solid rgba(255,255,255,0.18)",
                                boxShadow: weekColorFilter === color ? `0 0 0 2px ${color}` : "none",
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "box-shadow 0.15s, border-color 0.15s",
                                padding: 0,
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <WeeklyGrid
                        dates={trainingWeekDates}
                        sessions={(() => {
                          const singleGroupColor = isCustomTrainingGroupMode && customTrainingGroups.length === 1 ? customTrainingGroups[0].color : null;
                          const matchColor = isCustomTrainingGroupMode
                            ? (weekColorFilter ?? selectedCustomGroup?.color ?? singleGroupColor ?? null)
                            : null;
                          const base = weekColorFilter
                            ? trainingWeekSessions.filter((s) => s.color === weekColorFilter || s.eventType === "match")
                            : trainingWeekSessions;
                          return matchColor
                            ? base.map((s) => s.eventType === "match" && !s.color ? { ...s, color: matchColor } : s)
                            : base;
                        })()}
                        todayIso={todayIsoDate}
                        onDateClick={(date, sid) => void openTrainingDayDetails(date, sid)}
                      />
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: "12px" }}>
                    {trainingScheduleGroupsLoading ? (
                      <p className="amp-empty amp-empty--modal">Зареждане...</p>
                    ) : (isCustomTrainingGroupMode ? customTrainingGroups.length === 0 : (trainingScheduleGroups.length === 0 && standaloneTeamGroups.length === 0)) ? (
                      <p className="amp-empty amp-empty--modal">Няма създадени групи. Използвайте бутона „Създай / редактирай група” в треньорския панел.</p>
                    ) : (
                      <>
                        <label className="amp-edit-field" style={{ marginBottom: "12px", textAlign: "center" }}>
                          <span className="amp-lbl" style={{ textAlign: "center" }}>Група</span>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "10px",
                            }}
                          >
                            {selectedCustomTrainingGroupDotColor && (
                              <span
                                className="amp-custom-group-select-swatch"
                                style={{ backgroundColor: selectedCustomTrainingGroupDotColor }}
                                aria-hidden
                              />
                            )}
                            <select
                            className="amp-edit-input"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              textAlign: "center",
                              textAlignLast: "center",
                              paddingLeft: "12px",
                            }}
                            value={unifiedGroupScopeValue}
                            onChange={(e) => void handleUnifiedGroupChange(e.target.value)}
                            disabled={trainingAttendanceLoading || trainingNoteSaving || trainingDaysEditorSaving || trainingScheduleGroupsLoading}
                          >
                            {isCustomTrainingGroupMode ? customTrainingGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            )) : trainingScheduleGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                            {!isCustomTrainingGroupMode && standaloneTeamGroups.map((g) => (
                              <option key={g} value={`year:${g}`}>
                                Набор {g}
                              </option>
                            ))}
                          </select>
                          </div>
                        </label>
                      </>
                    )}
                  </div>
                  {!(isCustomTrainingGroupMode ? customTrainingGroups.length === 0 : (trainingScheduleGroups.length === 0 && standaloneTeamGroups.length === 0)) && !trainingScheduleGroupsLoading && (
                    <>
                    {trainingDayDetailsOpening && (
                      <div className="amp-modal-loading-overlay">
                        <div className="amp-loading" style={{ minHeight: 120 }}>
                          <div className="amp-spinner" />
                        </div>
                      </div>
                    )}
                    <label className="amp-edit-field" style={{ position: "relative" }}>
                      {trainingAttendanceLoading && (
                        <div className="amp-modal-loading-overlay" style={{ position: "absolute", inset: 0, zIndex: 10 }}>
                          <div className="amp-loading" style={{ minHeight: 200 }}>
                            <div className="amp-spinner" />
                            <p style={{ marginTop: 16, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>Зареждане...</p>
                          </div>
                        </div>
                      )}
                      <div className="amp-training-calendar amp-training-calendar--attendance">
                        <div className="amp-training-month-nav">
                          <button
                            type="button"
                            className="amp-training-month-nav-btn"
                            onClick={() => void handleTrainingAttendanceMonthChange(-1)}
                            disabled={trainingAttendanceLoading || trainingNoteSaving || trainingDayDetailsOpening || trainingAttendanceMonth <= todayIsoDate.slice(0, 7)}
                            aria-label="Предишен месец"
                          >
                            ‹
                          </button>
                          <span className="amp-training-month-nav-title">
                            {trainingAttendanceCalendarMonths[0]?.label ?? trainingAttendanceMonth}
                          </span>
                          <button
                            type="button"
                            className="amp-training-month-nav-btn"
                            onClick={() => void handleTrainingAttendanceMonthChange(1)}
                            disabled={trainingAttendanceLoading || trainingNoteSaving || trainingDayDetailsOpening}
                            aria-label="Следващ месец"
                          >
                            ›
                          </button>
                        </div>
                        {trainingAttendanceCalendarMonthsTrimmed.map((month) => (
                          <div key={month.key} className="amp-training-month">
                            <div className="amp-training-month-title">{month.label}</div>
                            <div className="amp-training-weekdays-row">
                              {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                                <span key={`${month.key}-${weekday}`} className="amp-training-weekday-cell">
                                  {weekday}
                                </span>
                              ))}
                            </div>
                            <div className="amp-training-month-grid">
                              {month.cells.map((date, index) => {
                                if (!date) {
                                  return (
                                    <span
                                      key={`${month.key}-empty-${index}`}
                                      className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                      aria-hidden="true"
                                    />
                                  );
                                }
                                if (date < todayIsoDate) {
                                  return (
                                    <span
                                      key={date}
                                      className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                      aria-hidden="true"
                                    />
                                  );
                                }
                                const dayNumber = Number.parseInt(date.slice(8, 10), 10);
                                const dateData = trainingUpcomingByDate.get(date);
                                const matchesForDate = trainingAttendanceMatchesByDate.get(date) ?? [];
                                const hasMatch = matchesForDate.length > 0;
                                if ((!dateData || !trainingUpcomingDateSet.has(date)) && !hasMatch) {
                                  return (
                                    <span
                                      key={date}
                                      className="amp-training-calendar-cell amp-training-calendar-cell--disabled"
                                      aria-hidden="true"
                                    >
                                      <span className="amp-training-day-number">{dayNumber}</span>
                                    </span>
                                  );
                                }
                                if (!dateData && hasMatch) {
                                  return (
                                    <button
                                      key={date}
                                      type="button"
                                      className="amp-training-date-btn amp-training-date-btn--calendar-match-only"
                                      aria-label={`Мач на ${formatIsoDateForDisplay(date)}`}
                                      onClick={() => { setMatchViewMatch(matchesForDate[0]!); setMatchViewPopupOpen(true); }}
                                    >
                                      <span className="amp-training-day-number">{dayNumber}</span>
                                      {matchesForDate[0]?.matchTime && (
                                        <span className="amp-training-day-match">{matchesForDate[0].matchTime}</span>
                                      )}
                                      <span className="amp-training-day-match amp-training-day-match--location">{matchesForDate[0]?.isHome ? "Д" : "Г"}</span>
                                    </button>
                                  );
                                }
  
                                const isActive = trainingAttendanceDate === date;
                                const isToday = todayIsoDate === date;
                                const trainingTimeLabel = dateData!.trainingTime?.trim() ?? "";
                                const hasTrainingAndMatch = hasMatch;
                                return (
                                  <button
                                    key={date}
                                    type="button"
                                    className={`amp-training-date-btn amp-training-date-btn--training${hasTrainingAndMatch ? " amp-training-date-btn--training-match" : ""}${isActive ? " amp-training-date-btn--active" : ""}${isToday ? " amp-training-date-btn--today" : ""}`}
                                    onClick={() => void openTrainingDayDetails(date)}
                                    disabled={trainingAttendanceLoading || trainingNoteSaving || trainingDayDetailsOpening}
                                  >
                                    <span className="amp-training-day-number">{dayNumber}</span>
                                    {hasTrainingAndMatch && matchesForDate[0]?.matchTime && (
                                      <span className="amp-training-day-match">{matchesForDate[0].matchTime}</span>
                                    )}
                                    {hasTrainingAndMatch && (
                                      <span className="amp-training-day-match amp-training-day-match--location">{matchesForDate[0]?.isHome ? "Д" : "Г"}</span>
                                    )}
                                    {!hasTrainingAndMatch && trainingTimeLabel && (
                                      <span className="amp-training-day-time">{trainingTimeLabel}</span>
                                    )}
                                    {!hasTrainingAndMatch && (
                                      <span className="amp-training-day-meta">
                                        {dateData!.stats.attending}/{dateData!.stats.total}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      {false && trainingDaysEditorOpen && (
                        <div className="amp-training-days-editor">
                          <div className="amp-training-days-editor-header">
                            <span className="amp-lbl">Избери тренировъчни дни (следващи 30 дни)</span>
                            <span className="amp-lbl">Избрани: {schedulerForm.trainingDates.length}</span>
                          </div>
                          <div className="amp-training-calendar">
                            {schedulerCalendarMonths.map((month) => (
                              <div key={month.key} className="amp-training-month">
                                <div className="amp-training-month-title">{month.label}</div>
                                <div className="amp-training-weekdays-row">
                                  {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                                    <span key={`${month.key}-${weekday}`} className="amp-training-weekday-cell">
                                      {weekday}
                                    </span>
                                  ))}
                                </div>
                                <div className="amp-training-month-grid">
                                  {month.cells.map((date, index) => {
                                    if (!date) {
                                      return (
                                        <span
                                          key={`${month.key}-empty-${index}`}
                                          className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                          aria-hidden="true"
                                        />
                                      );
                                    }
                                    const dayNumber = Number.parseInt(date.slice(8, 10), 10);
                                    const isSelectable = schedulerCalendarDateSet.has(date);
                                    if (!isSelectable) {
                                      return (
                                        <span
                                          key={date}
                                          className="amp-training-calendar-cell amp-training-calendar-cell--disabled"
                                          aria-hidden="true"
                                        >
                                          <span className="amp-training-day-number">{dayNumber}</span>
                                        </span>
                                      );
                                    }
  
                                    const isSelected = schedulerForm.trainingDates.includes(date);
                                    const isToday = todayIsoDate === date;
                                    return (
                                      <button
                                        key={date}
                                        type="button"
                                        className={`amp-training-date-btn${isSelected ? " amp-training-date-btn--active" : ""}${isToday ? " amp-training-date-btn--today" : ""}`}
                                        onClick={() => toggleTrainingDate(date)}
                                        disabled={trainingDaysEditorSaving}
                                      >
                                        <span className="amp-training-day-number">{dayNumber}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                          {trainingDaysEditorError && <p className="amp-confirm-error">{trainingDaysEditorError}</p>}
                          <div className="amp-modal-actions amp-modal-actions--end">
                            <button
                              type="button"
                              className="amp-btn amp-btn--ghost"
                              onClick={() => setTrainingDaysEditorOpen(false)}
                              disabled={trainingDaysEditorSaving}
                            >
                              Отказ
                            </button>
                            <button
                              type="button"
                              className="amp-btn amp-btn--primary"
                              onClick={() => void saveTrainingDaysForSelectedGroups()}
                              disabled={trainingDaysEditorSaving || trainingDaysEditorLoading}
                            >
                              {trainingDaysEditorSaving ? "Запазване..." : "Запази дни"}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="amp-training-note-targets">
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => toggleTrainingNoteTargetDate(trainingAttendanceDate)}
                          disabled={trainingNoteSaving || trainingAttendanceLoading || !trainingAttendanceDate}
                        >
                          {trainingNoteTargetDates.includes(trainingAttendanceDate)
                            ? "Премахни ден от избора"
                            : "Добави ден към избора"}
                        </button>
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => setTrainingNoteTargetDates(trainingAttendanceDate ? [trainingAttendanceDate] : [])}
                          disabled={trainingNoteSaving || trainingAttendanceLoading}
                        >
                          Остави само текущия ден
                        </button>
                        <span className="amp-lbl">
                          Избрани дни за добавяне на описание: {trainingNoteTargetDates.length}
                        </span>
                      </div>
                      <textarea
                        className="amp-edit-input amp-training-note"
                        value={trainingNote}
                        onChange={(e) => setTrainingNote(e.target.value)}
                        rows={3}
                        maxLength={1000}
                        placeholder="Добавете инструкции, сборен час, локация..."
                        disabled={trainingNoteSaving || trainingAttendanceLoading}
                      />
                    </label>
                      </>
                  )}
                  {(!isCustomTrainingGroupMode || customTrainingGroups.length > 0) && (
                  <div className="amp-modal-actions amp-modal-actions--end">
                    <button
                      className="amp-btn amp-btn--ghost"
                      onClick={() => {
                        setScheduleEventModalOpen(true);
                        setScheduleEventStep("type");
                        setMatchSelectedDates([]);
                        setMatchDetailsPerDay({});
                        setMatchExistingIdByDate({});
                        setMatchEditorError("");
                        setMatchCalendarVisibleMonthIdx(0);
                        void fetchClubMatches();
                      }}
                      disabled={trainingNoteSaving || trainingDaysEditorSaving}
                    >
                      Насрочи график
                    </button>
                  </div>
                  )}
                  {trainingAttendanceError && <p className="amp-confirm-error">{trainingAttendanceError}</p>}
                  <div className="amp-training-table-wrap">
                    {trainingAttendanceLoading ? (
                      <p className="amp-empty amp-empty--modal">Зареждане...</p>
                    ) : trainingAttendancePlayers.length === 0 ? (
                      <p className="amp-empty amp-empty--modal">Няма състезатели за този отбор.</p>
                    ) : (
                      <table className="amp-training-table">
                        <thead>
                          <tr>
                            <th>Име</th>
                            <th>Набор</th>
                            <th>Статус</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trainingAttendancePlayers.map((player) => (
                            <tr key={player.id}>
                              <td>{player.fullName}</td>
                              <td>{player.teamGroup ?? "-"}</td>
                              <td>
                                <span className={player.optedOut ? "amp-training-tag amp-training-tag--out" : "amp-training-tag amp-training-tag--in"}>
                                  {player.optedOut ? "Няма да присъства" : "Ще присъства"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {teamGroupWarningModalOpen && (
        <div className="amp-overlay amp-overlay--confirm" style={{ zIndex: 20000 }} onClick={handleTeamGroupWarningCancel}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Внимание</span>
              <button
                className="amp-modal-close"
                onClick={handleTeamGroupWarningCancel}
                aria-label="Затвори"
                disabled={trainingDaysEditorSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              <p className="amp-lbl" style={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {`Набор ${selectedTeamGroup} е в сборни отбори: ${pendingTeamGroupWarningGroups.map((group) => group.name).join(", ")}. Продължаването ще го премахне от тези групи и може да се наложи да промените имената им.`}
              </p>
              <div className="amp-modal-actions amp-modal-actions--end">
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={handleTeamGroupWarningCancel}
                  disabled={trainingDaysEditorSaving}
                >
                  Отказ
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--primary"
                  onClick={() => void handleTeamGroupWarningConfirm()}
                  disabled={trainingDaysEditorSaving}
                >
                  Продължи
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {postTeamGroupSavePromptOpen && (
        <div
          className="amp-overlay amp-overlay--confirm"
          style={{ zIndex: 20000 }}
          onClick={() => setPostTeamGroupSavePromptOpen(false)}
        >
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Потвърждение</span>
              <button
                className="amp-modal-close"
                onClick={() => setPostTeamGroupSavePromptOpen(false)}
                aria-label="Затвори"
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              <p className="amp-lbl" style={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {`скате ли да направите промени по сборен отбор ${postTeamGroupSavePromptGroupName}?`}
              </p>
              <div className="amp-modal-actions amp-modal-actions--end">
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setPostTeamGroupSavePromptOpen(false)}
                >
                  Не
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--primary"
                  onClick={() => void handlePostTeamGroupSavePromptConfirm()}
                >
                  Да
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {trainingGroupEditOpen && (
        <div
          className="amp-overlay amp-overlay--confirm"
          style={{ zIndex: 20000 }}
          onClick={() => {
            if (!trainingGroupEditSaving) {
              setTrainingGroupEditOpen(false);
              setTrainingGroupEditError("");
            }
          }}
        >
          <div className="amp-modal amp-modal--confirm amp-modal--training-days-editor" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">{isCustomTrainingGroupMode ? "Редакция на група" : "Редакция на сборен отбор"}</span>
              <button
                className="amp-modal-close"
                onClick={() => {
                  setTrainingGroupEditOpen(false);
                  setTrainingGroupEditError("");
                }}
                aria-label="Затвори"
                disabled={trainingGroupEditSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {isCustomTrainingGroupMode && (
                <>
                  <label className="amp-edit-field">
                    <span className="amp-lbl">Име на групата</span>
                    <input
                      className="amp-edit-input"
                      value={trainingGroupEditName}
                      onChange={(e) => setTrainingGroupEditName(e.target.value)}
                      disabled={trainingGroupEditSaving}
                    />
                  </label>
                  <CustomTrainingGroupColorPicker
                    value={trainingGroupEditColor}
                    onChange={setTrainingGroupEditColor}
                    disabled={trainingGroupEditSaving}
                    coachScopeKey={customTrainingGroupCoachScope}
                    groups={customTrainingGroups}
                    excludeGroupId={trainingGroupEditId}
                  />
                  <div className="amp-training-days-editor-header amp-training-days-editor-header--stack" style={{ marginTop: "10px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "10px",
                        flexWrap: "wrap",
                        marginBottom: "4px",
                      }}
                    >
                      <span className="amp-lbl" style={{ margin: 0 }}>Състезателите в групата</span>
                      {availablePlayersForCustomGroupEdit.length > 0 ? (
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost amp-btn--compact"
                          disabled={trainingGroupEditSaving}
                          onClick={() => {
                            const ids = availablePlayersForCustomGroupEdit.map((m) => m.id);
                            const allSelected =
                              ids.length > 0 && ids.every((id) => trainingGroupEditPlayerIds.includes(id));
                            if (allSelected) {
                              setTrainingGroupEditPlayerIds((prev) => prev.filter((id) => !ids.includes(id)));
                            } else {
                              setTrainingGroupEditPlayerIds((prev) => [...new Set([...prev, ...ids])]);
                            }
                          }}
                        >
                          {availablePlayersForCustomGroupEdit.every((m) =>
                            trainingGroupEditPlayerIds.includes(m.id),
                          )
                            ? "Премахни всички"
                            : "Избери всички"}
                        </button>
                      ) : null}
                    </div>
                    <input
                      className="amp-edit-input"
                      type="search"
                      placeholder="Търси състезател..."
                      value={customGroupEditSearch}
                      onChange={(e) => setCustomGroupEditSearch(e.target.value)}
                      disabled={trainingGroupEditSaving}
                      style={{ marginBottom: "8px" }}
                    />
                    <div className="amp-group-check-grid">
                      {filteredPlayersForCustomGroupEdit.map((member) => {
                        const isChecked = trainingGroupEditPlayerIds.includes(member.id);
                        return (
                          <label key={`custom-training-group-edit-${member.id}`} className={`amp-group-check-chip${isChecked ? " is-selected" : ""}${trainingGroupEditSaving ? " is-disabled" : ""}`}>
                            <input
                              className="amp-group-check-input"
                              type="checkbox"
                              checked={isChecked}
                              disabled={trainingGroupEditSaving}
                              onChange={(e) => {
                                setTrainingGroupEditPlayerIds((prev) => e.target.checked
                                  ? [...new Set([...prev, member.id])]
                                  : prev.filter((item) => item !== member.id));
                              }}
                            />
                            <span className="amp-group-check-box" aria-hidden="true" />
                            <span className="amp-lbl amp-group-check-label">{member.fullName}</span>
                          </label>
                        );
                      })}
                    </div>
                    {availablePlayersForCustomGroupEdit.length === 0 && (
                      <p className="amp-empty amp-empty--modal">Няма свободни състезатели за добавяне.</p>
                    )}
                    {availablePlayersForCustomGroupEdit.length > 0 && filteredPlayersForCustomGroupEdit.length === 0 && (
                      <p className="amp-empty amp-empty--modal">Няма състезатели, отговарящи на търсенето.</p>
                    )}
                  </div>
                </>
              )}
              {!isCustomTrainingGroupMode && (
                <>
              <label className="amp-edit-field">
                <span className="amp-lbl">Име на група</span>
                <input
                  className="amp-edit-input"
                  value={trainingGroupEditName}
                  placeholder={trainingGroupEditGroups.length > 0 ? trainingGroupEditGroups.join("/") : "2012/2013"}
                  onChange={(e) => setTrainingGroupEditName(e.target.value)}
                  disabled={trainingGroupEditSaving}
                />
              </label>
              <div className="amp-training-days-editor-header amp-training-days-editor-header--stack" style={{ marginTop: "10px" }}>
                <span className="amp-lbl">Набори за групата (минимум 2):</span>
                <div className="amp-group-check-grid">
                  {groupOptions.map((group) => {
                    const value = String(group);
                    const isChecked = trainingGroupEditGroups.includes(value);
                    return (
                      <label
                        key={`training-group-edit-${group}`}
                        className={`amp-group-check-chip${isChecked ? " is-selected" : ""}${trainingGroupEditSaving ? " is-disabled" : ""}`}
                      >
                        <input
                          className="amp-group-check-input"
                          type="checkbox"
                          checked={isChecked}
                          disabled={trainingGroupEditSaving}
                          onChange={(e) => {
                            setTrainingGroupEditGroups((prev) => {
                              if (e.target.checked) {
                                return [...new Set([...prev, value])].sort((a, b) => Number(a) - Number(b));
                              }
                              return prev.filter((item) => item !== value);
                            });
                          }}
                        />
                        <span className="amp-group-check-box" aria-hidden="true" />
                        <span className="amp-lbl amp-group-check-label">Набор {group}</span>
                      </label>
                    );
                  })}
                </div>
                <span className="amp-lbl amp-group-check-hint">
                  {trainingGroupEditGroups.length === 0
                    ? "Изберете поне 2 набора."
                    : `Избрани набори: ${trainingGroupEditGroups.join(", ")}`}
                </span>
              </div>
                </>
              )}
              {trainingGroupEditError && <p className="amp-confirm-error">{trainingGroupEditError}</p>}
              <div className="amp-modal-actions amp-modal-actions--end">
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => {
                    setTrainingGroupEditOpen(false);
                    setTrainingGroupEditError("");
                  }}
                  disabled={trainingGroupEditSaving}
                >
                  Отказ
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--primary"
                  onClick={() => void saveTrainingGroupEditFromModal()}
                  disabled={trainingGroupEditSaving}
                >
                  {trainingGroupEditSaving ? "Запазване..." : "Запази промените"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {trainingGroupCreateOpen && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => {
            if (!trainingGroupCreateSaving) {
              setTrainingGroupCreateOpen(false);
              setTrainingGroupCreateError("");
              setTrainingGroupCreateStep("picker");
            }
          }}
        >
          <div className="amp-modal amp-modal--confirm amp-modal--training-days-editor" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">
                {trainingGroupCreateStep === "create"
                  ? (isCustomTrainingGroupMode ? "Нова група" : "Нов сборен отбор")
                  : trainingGroupCreateStep === "edit-pick"
                    ? (isCustomTrainingGroupMode ? "Редактирай група" : "Редактирай сборен отбор")
                    : (isCustomTrainingGroupMode ? "Създай / редактирай група" : "Управление на сборни отбори")}
              </span>
              <button
                className="amp-modal-close"
                onClick={() => {
                  setTrainingGroupCreateOpen(false);
                  setTrainingGroupCreateError("");
                  setTrainingGroupCreateStep("picker");
                }}
                aria-label="Затвори"
                disabled={trainingGroupCreateSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {trainingGroupCreateStep === "picker" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <button
                    type="button"
                    className="amp-btn amp-btn--primary"
                    style={{ width: "100%", justifyContent: "center", padding: "14px 20px", fontSize: "15px" }}
                    disabled={isCustomTrainingGroupMode && noFreeCustomTrainingGroupColor}
                    onClick={() => setTrainingGroupCreateStep("create")}
                  >
                    Създай група
                  </button>
                  <button
                    type="button"
                    className="amp-btn amp-btn--ghost"
                    style={{ width: "100%", justifyContent: "center", padding: "14px 20px", fontSize: "15px" }}
                    disabled={isCustomTrainingGroupMode ? customTrainingGroups.length === 0 : trainingScheduleGroups.length === 0}
                    onClick={() => setTrainingGroupCreateStep("edit-pick")}
                  >
                    Редактирай група
                  </button>
                </div>
              )}
              {trainingGroupCreateStep === "edit-pick" && (
                <>
                  <label className="amp-edit-field" style={{ marginBottom: "16px" }}>
                    <span className="amp-lbl">Избери група</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {isCustomTrainingGroupMode && (() => {
                        const color = customTrainingGroups.find((g) => g.id === trainingGroupEditPickId)?.color;
                        return color ? <span className="amp-custom-group-select-swatch" style={{ backgroundColor: color }} aria-hidden /> : null;
                      })()}
                      <select
                        className="amp-edit-input"
                        style={{ flex: 1, textAlign: "center", textAlignLast: "center" }}
                        value={trainingGroupEditPickId}
                        onChange={(e) => setTrainingGroupEditPickId(e.target.value)}
                      >
                        {isCustomTrainingGroupMode
                          ? customTrainingGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)
                          : trainingScheduleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)
                        }
                      </select>
                    </div>
                  </label>
                  <div className="amp-modal-actions" style={{ justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        className="amp-btn amp-btn--ghost"
                        onClick={() => setTrainingGroupCreateStep("picker")}
                      >
                        Назад
                      </button>
                      <button
                        type="button"
                        className="amp-btn amp-btn--danger"
                        disabled={!trainingGroupEditPickId}
                        onClick={() => {
                          setSelectedTrainingGroupId(trainingGroupEditPickId);
                          setTrainingGroupCreateOpen(false);
                          setTrainingGroupCreateError("");
                          setTrainingGroupCreateStep("picker");
                          setTrainingGroupDeleteConfirmOpen(true);
                        }}
                      >
                        Изтрий
                      </button>
                    </div>
                    <button
                      type="button"
                      className="amp-btn amp-btn--primary"
                      disabled={!trainingGroupEditPickId}
                      onClick={() => {
                        setTrainingGroupCreateOpen(false);
                        setTrainingGroupCreateError("");
                        setTrainingGroupCreateStep("picker");
                        openTrainingGroupEditModal(trainingGroupEditPickId);
                      }}
                    >
                      Редактирай
                    </button>
                  </div>
                </>
              )}
              {trainingGroupCreateStep === "create" && (
                <>
                  {isCustomTrainingGroupMode && (
                    <>
                      <label className="amp-edit-field">
                        <span className="amp-lbl">Име на групата</span>
                        <input
                          className="amp-edit-input"
                          value={trainingGroupCreateName}
                          onChange={(e) => setTrainingGroupCreateName(e.target.value)}
                          placeholder="Например: Сутрешна група"
                          disabled={trainingGroupCreateSaving}
                        />
                      </label>
                      <CustomTrainingGroupColorPicker
                        value={trainingGroupCreateColor}
                        onChange={setTrainingGroupCreateColor}
                        disabled={trainingGroupCreateSaving || noFreeCustomTrainingGroupColor}
                        coachScopeKey={customTrainingGroupCoachScope}
                        groups={customTrainingGroups}
                      />
                      {noFreeCustomTrainingGroupColor && (
                        <p className="amp-empty amp-empty--modal" style={{ marginTop: 8 }}>
                          Всички цветове са заети за тази треньорска група.
                        </p>
                      )}
                      <div className="amp-training-days-editor-header amp-training-days-editor-header--stack" style={{ marginTop: "10px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                            flexWrap: "wrap",
                            marginBottom: "4px",
                          }}
                        >
                          <span className="amp-lbl" style={{ margin: 0 }}>Състезателите в групата</span>
                          {availablePlayersForCustomGroupCreate.length > 0 ? (
                            <button
                              type="button"
                              className="amp-btn amp-btn--ghost amp-btn--compact"
                              disabled={trainingGroupCreateSaving}
                              onClick={() => {
                                const ids = availablePlayersForCustomGroupCreate.map((m) => m.id);
                                const allSelected =
                                  ids.length > 0 && ids.every((id) => trainingGroupCreatePlayerIds.includes(id));
                                if (allSelected) {
                                  setTrainingGroupCreatePlayerIds((prev) => prev.filter((id) => !ids.includes(id)));
                                } else {
                                  setTrainingGroupCreatePlayerIds((prev) => [...new Set([...prev, ...ids])]);
                                }
                              }}
                            >
                              {availablePlayersForCustomGroupCreate.every((m) =>
                                trainingGroupCreatePlayerIds.includes(m.id),
                              )
                                ? "Премахни всички"
                                : "Избери всички"}
                            </button>
                          ) : null}
                        </div>
                        <input
                          className="amp-edit-input"
                          type="search"
                          placeholder="Търси състезател..."
                          value={customGroupCreateSearch}
                          onChange={(e) => setCustomGroupCreateSearch(e.target.value)}
                          disabled={trainingGroupCreateSaving}
                          style={{ marginBottom: "8px" }}
                        />
                        <div className="amp-group-check-grid">
                          {filteredPlayersForCustomGroupCreate.map((member) => {
                            const isChecked = trainingGroupCreatePlayerIds.includes(member.id);
                            return (
                              <label key={`custom-training-group-create-${member.id}`} className={`amp-group-check-chip${isChecked ? " is-selected" : ""}${trainingGroupCreateSaving ? " is-disabled" : ""}`}>
                                <input
                                  className="amp-group-check-input"
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={trainingGroupCreateSaving}
                                  onChange={(e) => {
                                    setTrainingGroupCreatePlayerIds((prev) => e.target.checked
                                      ? [...new Set([...prev, member.id])]
                                      : prev.filter((item) => item !== member.id));
                                  }}
                                />
                                <span className="amp-group-check-box" aria-hidden="true" />
                                <span className="amp-lbl amp-group-check-label">{member.fullName}</span>
                              </label>
                            );
                          })}
                        </div>
                        {availablePlayersForCustomGroupCreate.length === 0 && (
                          <p className="amp-empty amp-empty--modal">Няма свободни състезатели за добавяне.</p>
                        )}
                        {availablePlayersForCustomGroupCreate.length > 0 && filteredPlayersForCustomGroupCreate.length === 0 && (
                          <p className="amp-empty amp-empty--modal">Няма състезатели, отговарящи на търсенето.</p>
                        )}
                      </div>
                    </>
                  )}
                  {!isCustomTrainingGroupMode && (
                    <div className="amp-training-days-editor-header amp-training-days-editor-header--stack">
                      <span className="amp-lbl">Набори за групата (минимум 2):</span>
                      <div className="amp-group-check-grid">
                        {groupOptions.map((group) => {
                          const value = String(group);
                          const isChecked = trainingGroupCreateGroups.includes(value);
                          return (
                            <label
                              key={`training-group-create-${group}`}
                              className={`amp-group-check-chip${isChecked ? " is-selected" : ""}${trainingGroupCreateSaving ? " is-disabled" : ""}`}
                            >
                              <input
                                className="amp-group-check-input"
                                type="checkbox"
                                checked={isChecked}
                                disabled={trainingGroupCreateSaving}
                                onChange={(e) => {
                                  setTrainingGroupCreateGroups((prev) => {
                                    if (e.target.checked) {
                                      return [...new Set([...prev, value])].sort((a, b) => Number(a) - Number(b));
                                    }
                                    return prev.filter((item) => item !== value);
                                  });
                                }}
                              />
                              <span className="amp-group-check-box" aria-hidden="true" />
                              <span className="amp-lbl amp-group-check-label">Набор {group}</span>
                            </label>
                          );
                        })}
                      </div>
                      <span className="amp-lbl amp-group-check-hint">
                        {trainingGroupCreateGroups.length === 0
                          ? "Изберете поне 2 набора."
                          : `Избрани набори: ${trainingGroupCreateGroups.join(", ")} — Името ще бъде: ${trainingGroupCreateGroups.join("/")}`}
                      </span>
                    </div>
                  )}
                  {trainingGroupCreateError && <p className="amp-confirm-error">{trainingGroupCreateError}</p>}
                  <div className="amp-modal-actions" style={{ justifyContent: "space-between" }}>
                    <button
                      type="button"
                      className="amp-btn amp-btn--ghost"
                      onClick={() => {
                        setTrainingGroupCreateStep("picker");
                        setTrainingGroupCreateError("");
                      }}
                      disabled={trainingGroupCreateSaving}
                    >
                      Назад
                    </button>
                    <button
                      type="button"
                      className="amp-btn amp-btn--primary"
                      onClick={() => void saveTrainingGroupFromModal()}
                      disabled={
                        trainingGroupCreateSaving ||
                        (isCustomTrainingGroupMode && noFreeCustomTrainingGroupColor)
                      }
                    >
                      {trainingGroupCreateSaving
                        ? "Създаване..."
                        : isCustomTrainingGroupMode
                          ? "Създай група"
                          : "Създай сборен отбор"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {scheduleEventModalOpen && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => { if (!matchEditorSaving) { setScheduleEventModalOpen(false); setScheduleEventStep("type"); } }}
        >
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">
                {scheduleEventStep === "type" ? "Насрочи събитие" : "Мач / Двубой / Състезание / Участие"}
              </span>
              <button
                className="amp-modal-close"
                onClick={() => { setScheduleEventModalOpen(false); setScheduleEventStep("type"); }}
                aria-label="Затвори"
                disabled={matchEditorSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {scheduleEventStep === "type" ? (
                <div className="amp-schedule-event-type-picker">
                  <button
                    type="button"
                    className="amp-btn amp-schedule-event-type-btn"
                    onClick={() => {
                      setScheduleEventModalOpen(false);
                      void openTrainingDaysEditorForCurrentScope();
                    }}
                  >
                    <span className="amp-schedule-event-type-icon amp-schedule-event-type-icon--training" aria-hidden="true" />
                    Тренировка
                  </button>
                  <button
                    type="button"
                    className="amp-btn amp-schedule-event-type-btn amp-schedule-event-type-btn--match"
                    onClick={() => {
                      const scopeTeamGroups =
                        trainingAttendanceView === "trainingGroups" && !isCustomTrainingGroupMode
                          ? (selectedTrainingGroup?.teamGroups ?? [])
                          : selectedTeamGroup !== null
                            ? [selectedTeamGroup]
                            : [];
                      setMatchTeamGroups(scopeTeamGroups);
                      setMatchSelectedDates([]);
                      setMatchDetailsPerDay({});
                      setMatchExistingIdByDate({});
                      setScheduleEventStep("match-days");
                    }}
                  >
                    <span className="amp-schedule-event-type-icon amp-schedule-event-type-icon--match" aria-hidden="true" />
                    Мач / Двубой / Състезание / Участие
                  </button>
                </div>
              ) : (
                <>
                  <div className="amp-training-days-editor-header" style={{ flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>
                      {trainingAttendanceView === "trainingGroups" && !isCustomTrainingGroupMode
                        ? "Добави мач за сборен отбор"
                        : trainingAttendanceView === "trainingGroups" && isCustomTrainingGroupMode
                          ? "Добави мач за персонализирана група"
                          : "Добави мач"}
                    </span>
                    {scheduleEventStep === "match-days" && (
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Избрани: {matchSelectedDates.length}</span>
                    )}
                  </div>
                  <div className="amp-training-days-editor-header" style={{ marginTop: "8px", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
                    <span
                      className="amp-lbl"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid rgba(50,205,50,0.45)",
                        background: "rgba(50,205,50,0.16)",
                        color: "#d7ffd7",
                        fontWeight: 700,
                        textAlign: "center",
                        width: "100%",
                      }}
                    >
                      {trainingAttendanceView === "trainingGroups" && !isCustomTrainingGroupMode
                        ? `Сборен отбор: ${selectedTrainingGroup?.name ?? "-"}`
                        : trainingAttendanceView === "trainingGroups" && isCustomTrainingGroupMode
                          ? `Персонализирана група: ${selectedCustomGroup?.name ?? "-"}`
                          : selectedTeamGroup === null
                            ? "Набор: Всички"
                            : `Набор: ${selectedTeamGroup}`}
                    </span>
                    <span style={{ textAlign: "center" }}>
                      {trainingAttendanceView === "trainingGroups" && !isCustomTrainingGroupMode
                        ? `Този мач ще се вижда от сборен отбор ${selectedTrainingGroup?.name ?? "-"}.`
                        : trainingAttendanceView === "trainingGroups" && isCustomTrainingGroupMode
                          ? `Този мач ще се вижда от персонализирана група ${selectedCustomGroup?.name ?? "-"}.`
                          : selectedTeamGroup === null
                            ? "Този мач ще се вижда от всички набори."
                            : `Този мач ще се вижда от набор ${selectedTeamGroup}.`}
                    </span>
                  </div>
                  <div className="amp-training-stepper" aria-label="Стъпки за мач">
                    <button
                      type="button"
                      className={`amp-training-step${scheduleEventStep === "match-days" ? " is-active" : " is-complete"}`}
                      onClick={() => { setScheduleEventStep("match-days"); setMatchEditorError(""); }}
                      disabled={matchEditorSaving}
                    >
                      <span className="amp-training-step-index">1</span>
                      Дни
                    </button>
                    <button
                      type="button"
                      className={`amp-training-step${scheduleEventStep === "match-details" ? " is-active" : ""}`}
                      onClick={() => { if (matchSelectedDates.length > 0) { setScheduleEventStep("match-details"); setMatchEditorError(""); } }}
                      disabled={matchEditorSaving || matchSelectedDates.length === 0}
                    >
                      <span className="amp-training-step-index">2</span>
                      Детайли
                    </button>
                  </div>
                  {scheduleEventStep === "match-days" && (
                    <>
                      <div className="amp-training-calendar" style={{ order: 1 }}>
                        {matchCalendarMonthsTrimmed.length > 1 && (
                          <div className="amp-training-month-nav">
                            <button type="button" className="amp-training-month-nav-btn" onClick={() => setMatchCalendarVisibleMonthIdx((i) => Math.max(0, i - 1))} disabled={matchCalendarVisibleMonthIdx === 0} aria-label="Предишен месец">‹</button>
                            <button type="button" className="amp-training-month-nav-btn" onClick={() => setMatchCalendarVisibleMonthIdx((i) => Math.min(matchCalendarMonthsTrimmed.length - 1, i + 1))} disabled={matchCalendarVisibleMonthIdx === matchCalendarMonths.length - 1} aria-label="Следващ месец">›</button>
                          </div>
                        )}
                        {matchCalendarMonthsTrimmed.slice(matchCalendarVisibleMonthIdx, matchCalendarVisibleMonthIdx + 1).map((month) => (
                          <div key={month.key} className="amp-training-month">
                            <div className="amp-training-month-title">{month.label}</div>
                            <div className="amp-training-weekdays-row">
                              {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                                <span key={`${month.key}-${weekday}`} className="amp-training-weekday-cell">{weekday}</span>
                              ))}
                            </div>
                            <div className="amp-training-month-grid">
                              {month.cells.map((date, index) => {
                                if (!date) {
                                  return (
                                    <span
                                      key={`${month.key}-empty-${index}`}
                                      className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                      aria-hidden="true"
                                    />
                                  );
                                }
                                const dayNumber = Number.parseInt(date.slice(8, 10), 10);
                                if (!matchCalendarDateSet.has(date)) {
                                  return (
                                    <span
                                      key={date}
                                      className="amp-training-calendar-cell amp-training-calendar-cell--disabled"
                                      aria-hidden="true"
                                    >
                                      <span className="amp-training-day-number">{dayNumber}</span>
                                    </span>
                                  );
                                }
                                const isSelected = matchSelectedDates.includes(date);
                                const matchesForDate = (matchCalendarMatchesByDate.get(date) ?? []).filter((m) => {
                                  if (m.customGroupId !== null) {
                                    return isCustomTrainingGroupMode && m.customGroupId === selectedCustomGroup?.id;
                                  }
                                  return matchTeamGroups.length === 0 || m.teamGroups.length === 0 || m.teamGroups.some((tg) => matchTeamGroups.includes(tg));
                                });
                                return (
                                  <button
                                    key={date}
                                    type="button"
                                    className={`amp-training-date-btn amp-training-date-btn--match${matchesForDate.length > 0 ? " amp-training-date-btn--has-match" : ""}${isSelected ? " amp-training-date-btn--active" : ""}`}
                                    onClick={() => toggleMatchDate(date)}
                                    disabled={matchEditorSaving}
                                  >
                                    <span className="amp-training-day-number">{dayNumber}</span>
                                    {matchesForDate.slice(0, 2).map((match) => (
                                      <span key={match.id} className="amp-training-day-match">
                                        {match.matchTime} {match.opponent}
                                      </span>
                                    ))}
                                    {matchesForDate.length > 2 && (
                                      <span className="amp-training-day-match">+{matchesForDate.length - 2}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="amp-modal-actions amp-modal-actions--end" style={{ order: 2 }}>
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => { setScheduleEventStep("type"); setMatchEditorError(""); }}
                          disabled={matchEditorSaving}
                        >
                          Назад
                        </button>
                        <button
                          type="button"
                          className="amp-btn amp-btn--primary amp-btn--match"
                          onClick={() => { setScheduleEventStep("match-details"); setMatchEditorError(""); }}
                          disabled={matchEditorSaving || matchSelectedDates.length === 0}
                        >
                          Напред
                        </button>
                      </div>
                    </>
                  )}
                  {scheduleEventStep === "match-details" && (
                    <>
                      <div className="amp-training-step-summary">
                        <span className="amp-training-step-summary-label">Избрани дни</span>
                        <span className="amp-training-step-summary-value">{matchSelectedDates.map((d) => formatIsoDateForDisplay(d)).join(", ")}</span>
                      </div>
                      <div className="amp-match-details-per-day">
                        {matchSelectedDates.map((date) => {
                          const details = matchDetailsPerDay[date] ?? { opponent: "", location: "", time: "", duration: "90", isHome: null };
                          return (
                            <div key={date} className="amp-match-day-section">
                              <span className="amp-lbl amp-match-day-label">{formatIsoDateForDisplay(date)}</span>
                              <label className="amp-edit-field">
                                <span className="amp-lbl">Час</span>
                                <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                                  <input
                                    className="amp-inner-time-input"
                                    type="time"
                                    step={60}
                                    value={details.time}
                                    onChange={(e) => setMatchDetailsPerDay((prev) => ({ ...prev, [date]: { ...details, time: e.target.value } }))}
                                    disabled={matchEditorSaving}
                                  />
                                </div>
                              </label>
                              <label className="amp-edit-field">
                                <span className="amp-lbl">Продължителност (мин.)</span>
                                <input
                                  className="amp-edit-input"
                                  type="number"
                                  min={1}
                                  max={1440}
                                  value={details.duration}
                                  onChange={(e) => setMatchDetailsPerDay((prev) => ({ ...prev, [date]: { ...details, duration: e.target.value } }))}
                                  disabled={matchEditorSaving}
                                />
                              </label>
                              <div className="amp-edit-field">
                                <span className="amp-lbl">Домакин / Гост</span>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    type="button"
                                    className={`amp-btn${details.isHome === true ? " amp-btn--primary" : " amp-btn--ghost"}`}
                                    onClick={() => setMatchDetailsPerDay((prev) => ({ ...prev, [date]: { ...details, isHome: details.isHome === true ? null : true } }))}
                                    disabled={matchEditorSaving}
                                  >
                                    Домакин
                                  </button>
                                  <button
                                    type="button"
                                    className={`amp-btn${details.isHome === false ? " amp-btn--primary" : " amp-btn--ghost"}`}
                                    onClick={() => setMatchDetailsPerDay((prev) => ({ ...prev, [date]: { ...details, isHome: details.isHome === false ? null : false } }))}
                                    disabled={matchEditorSaving}
                                  >
                                    Гост
                                  </button>
                                </div>
                              </div>
                              <label className="amp-edit-field">
                                <span className="amp-lbl">Съперник</span>
                                <input
                                  className="amp-edit-input"
                                  type="text"
                                  value={details.opponent}
                                  onChange={(e) => setMatchDetailsPerDay((prev) => ({ ...prev, [date]: { ...details, opponent: e.target.value } }))}
                                  placeholder="Съперник"
                                  maxLength={200}
                                  disabled={matchEditorSaving}
                                />
                              </label>
                              <label className="amp-edit-field">
                                <span className="amp-lbl">Място</span>
                                <input
                                  className="amp-edit-input"
                                  type="text"
                                  value={details.location}
                                  onChange={(e) => setMatchDetailsPerDay((prev) => ({ ...prev, [date]: { ...details, location: e.target.value } }))}
                                  placeholder="Стадион / адрес"
                                  maxLength={200}
                                  disabled={matchEditorSaving}
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      {matchEditorError && <p className="amp-confirm-error">{matchEditorError}</p>}
                      <div className="amp-modal-actions amp-modal-actions--end">
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => { setScheduleEventStep("match-days"); setMatchEditorError(""); }}
                          disabled={matchEditorSaving}
                        >
                          Назад
                        </button>
                        <button
                          type="button"
                          className="amp-btn amp-btn--primary amp-btn--match"
                          onClick={() => void handleSaveMatch()}
                          disabled={matchEditorSaving || !matchSelectedDates.every((d) => {
                            const det = matchDetailsPerDay[d];
                            return det?.location?.trim() && det?.time;
                          })}
                        >
                          {matchEditorSaving ? "Запазване..." : matchSelectedDates.length > 1 ? `Запази ${matchSelectedDates.length} събития` : "Запази събитие"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {trainingDaysEditorOpen && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => {
            if (!trainingDaysEditorSaving) {
              setTrainingDaysEditorOpen(false);
            }
          }}
        >
          <div className="amp-modal amp-modal--confirm amp-modal--training-days-editor" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Задай тренировъчни дни</span>
              <button
                className="amp-modal-close"
                onClick={() => setTrainingDaysEditorOpen(false)}
                aria-label="Затвори"
                disabled={trainingDaysEditorSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body" style={{ position: "relative", display: "flex", flexDirection: "column" }}>
              {trainingDaysEditorSaving && (
                <div className="amp-modal-loading-overlay" style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(16,16,20,0.9)" }}>
                  <div className="amp-loading" style={{ minHeight: 200 }}>
                    <div className="amp-spinner" />
                    <p style={{ marginTop: 16, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>Запазване...</p>
                  </div>
                </div>
              )}
              {false && !trainingDaysEditorCreateOpen && (
                <>
                  <div className="amp-training-days-editor-header" style={{ alignItems: "flex-start", flexDirection: "column", gap: "8px" }}>
                    <span className="amp-lbl">Създадени сборни отбори</span>
                    {trainingScheduleGroupsLoading ? (
                      <p className="amp-empty amp-empty--modal">Зареждане...</p>
                    ) : trainingScheduleGroups.length === 0 ? (
                      <p className="amp-empty amp-empty--modal">Няма създадени сборни отбори</p>
                    ) : (
                      <div style={{ display: "grid", gap: "8px", width: "100%" }}>
                        {trainingScheduleGroups.map((group) => (
                          <div key={group.id} className="amp-card-row" style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 700 }}>{group.name}</div>
                            <div style={{ opacity: 0.8 }}>Набори: {group.teamGroups.join(", ")}</div>
                            <div style={{ opacity: 0.8 }}>Дати: {group.trainingDates.length}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="amp-modal-actions amp-modal-actions--end">
                    <button
                      type="button"
                      className="amp-btn amp-btn--ghost"
                      onClick={() => setTrainingDaysEditorOpen(false)}
                      disabled={trainingDaysEditorSaving}
                    >
                      Затвори
                    </button>
                    <button
                      type="button"
                      className="amp-btn amp-btn--primary"
                      onClick={() => {
                        setTrainingDaysEditorCreateOpen(true);
                        setTrainingDaysEditorError("");
                      }}
                      disabled={trainingDaysEditorSaving || trainingDaysEditorLoading}
                    >
                      Създай сборен отбор
                    </button>
                  </div>
                </>
              )}
              {trainingDaysEditorCreateOpen && (
                <>
                  <div className="amp-training-days-editor-header" style={{ flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>
                      {trainingDaysEditorMode === "createGroup"
                        ? "Създай сборен отбор"
                        : trainingDaysEditorMode === "trainingGroup"
                          ? "Задай тренировъчни дни за сборен отбор"
                          : trainingDaysEditorMode === "coachGroup"
                            ? "Тренировъчен график"
                            : "Избери тренировъчни дни (следващи 30 дни)"}
                    </span>
                    {trainingDaysEditorMode !== "createGroup" && trainingDaysSingleEditDate === null && (
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Избрани: {schedulerForm.trainingDates.length}</span>
                    )}
                    {trainingDaysEditorMode !== "createGroup" && trainingDaysSingleEditDate !== null && (
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Редактирате: {formatIsoDateForDisplay(trainingDaysSingleEditDate)}</span>
                    )}
                  </div>
                  <div className="amp-training-days-editor-header" style={{ marginTop: "8px", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
                    <span
                      className="amp-lbl"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid rgba(50,205,50,0.45)",
                        background: "rgba(50,205,50,0.16)",
                        color: "#d7ffd7",
                        fontWeight: 700,
                        textAlign: "center",
                        width: "100%"
                      }}
                    >
                      {trainingDaysEditorMode === "trainingGroup"
                        ? `Сборен отбор: ${selectedTrainingGroup?.name ?? "-"}`
                        : trainingDaysEditorMode === "customGroup"
                          ? `Персонализирана група: ${selectedCustomGroup?.name ?? "-"}`
                          : trainingDaysEditorMode === "coachGroup"
                            ? `Треньорска група: ${coachGroups.find((g) => g.id === coachGroupId)?.name ?? ""}`
                            : selectedTeamGroup === null
                              ? "Набор: Всички"
                              : `Набор: ${selectedTeamGroup}`}
                    </span>
                    <span style={{ textAlign: "center" }}>
                      {trainingDaysEditorMode === "trainingGroup"
                        ? `Тези промени ще се запазят за сборен отбор ${selectedTrainingGroup?.name ?? "-"}.`
                        : trainingDaysEditorMode === "customGroup"
                          ? `Тези промени ще се запазят за персонализирана група ${selectedCustomGroup?.name ?? "-"}.`
                          : trainingDaysEditorMode === "coachGroup"
                            ? `Тези промени ще се запазят за треньорска група ${coachGroups.find((g) => g.id === coachGroupId)?.name ?? ""}.`
                            : selectedTeamGroup === null
                              ? "Тези промени ще се запазят за всички набори."
                              : `Тези промени ще се запазят за набор ${selectedTeamGroup}.`}
                    </span>
                  </div>
                  {trainingDaysEditorMode !== "createGroup" && (
                    <div className="amp-training-stepper" aria-label="Стъпки за тренировъчен график" style={{ order: 0 }}>
                      <button
                        type="button"
                        className={`amp-training-step${effectiveTrainingDaysActiveStep === "days" ? " is-active" : " is-complete"}`}
                        onClick={() => setTrainingDaysActiveStep("days")}
                        disabled={trainingDaysEditorSaving}
                      >
                        <span className="amp-training-step-index">1</span>
                        Дни
                      </button>
                      <button
                        type="button"
                        className={`amp-training-step${effectiveTrainingDaysActiveStep === "time" ? " is-active" : ""}${currentStepOrder > stepSequence.indexOf("time") ? " is-complete" : ""}`}
                        onClick={() => setTrainingDaysActiveStep("time")}
                        disabled={trainingDaysEditorSaving || !canShowTrainingDaysTimeStep || stepSequence.indexOf("time") > currentStepOrder}
                      >
                        <span className="amp-training-step-index">2</span>
                        Час
                      </button>
                      {spotsStepSupportedByMode && (
                        <button
                          type="button"
                          className={`amp-training-step${effectiveTrainingDaysActiveStep === "spots" ? " is-active" : ""}${currentStepOrder > stepSequence.indexOf("spots") ? " is-complete" : ""}`}
                          onClick={() => setTrainingDaysActiveStep("spots")}
                          disabled={trainingDaysEditorSaving || !canShowTrainingDaysSpotsStep || stepSequence.indexOf("spots") > currentStepOrder}
                        >
                          <span className="amp-training-step-index">3</span>
                          Места
                        </button>
                      )}
                      <button
                        type="button"
                        className={`amp-training-step${effectiveTrainingDaysActiveStep === "field" ? " is-active" : ""}${currentStepOrder > stepSequence.indexOf("field") ? " is-complete" : ""}`}
                        onClick={() => setTrainingDaysActiveStep("field")}
                        disabled={trainingDaysEditorSaving || !canShowTrainingDaysFieldStep || stepSequence.indexOf("field") > currentStepOrder}
                      >
                        <span className="amp-training-step-index">{spotsStepSupportedByMode ? 4 : 3}</span>
                        Терен
                      </button>
                      <button
                        type="button"
                        className={`amp-training-step${effectiveTrainingDaysActiveStep === "notes" ? " is-active" : ""}`}
                        onClick={() => setTrainingDaysActiveStep("notes")}
                        disabled={trainingDaysEditorSaving || !canShowTrainingDaysNotesStep || stepSequence.indexOf("notes") > currentStepOrder}
                      >
                        <span className="amp-training-step-index">{spotsStepSupportedByMode ? 5 : 4}</span>
                        Описание
                      </button>
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && (
                    <label className="amp-edit-field" style={{ marginTop: "8px", display: "none", textAlign: "center" }}>
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Час на тренировка (HH:mm)</span>
                      <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                        <input
                          className="amp-inner-time-input"
                          type="time"
                          step={60}
                          value={schedulerForm.trainingTime}
                          onChange={(e) => handleTrainingAllTimeChange(e.target.value)}
                          required
                          disabled={trainingDaysEditorSaving}
                        />
                      </div>
                    </label>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && effectiveTrainingDaysActiveStep === "time" && (
                    <div className="amp-training-step-summary" style={{ order: 1 }}>
                      <span className="amp-training-step-summary-label">Избрани дни</span>
                      <span className="amp-training-step-summary-value">{trainingDaysSummaryText}</span>
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && (effectiveTrainingDaysActiveStep === "spots" || effectiveTrainingDaysActiveStep === "field") && (
                    <div className="amp-training-step-summary" style={{ order: 1 }}>
                      <div>
                        <span className="amp-training-step-summary-label">Избрани дни</span>
                        <span className="amp-training-step-summary-value">{trainingDaysSummaryText}</span>
                      </div>
                      <div>
                        <span className="amp-training-step-summary-label">Час и продължителност</span>
                        <span className="amp-training-step-summary-value">{trainingTimeSummaryText} · {trainingDurationSummaryText}</span>
                      </div>
                      {spotsStepSupportedByMode && effectiveTrainingDaysActiveStep === "field" && (
                        <div>
                          <span className="amp-training-step-summary-label">Участие</span>
                          <span className="amp-training-step-summary-value">
                            {schedulerPerDayLimited
                              ? (() => {
                                  const limitedDays = normalizedTrainingDaysSelection.filter(d => schedulerPerDayConfig[d]?.limited);
                                  return limitedDays.length === 0
                                    ? "Всички участват"
                                    : `${limitedDays.length} ${limitedDays.length === 1 ? "ден" : "дни"} с ограничени места`;
                                })()
                              : schedulerLimitedMode && isSchedulerLimitedSpotsValid
                                ? `Ограничено — ${schedulerLimitedSpotsValue} места`
                                : "Всички участват"}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysTimeStep && effectiveTrainingDaysActiveStep === "time" && (
                    <div className="amp-training-time-panel" style={{ marginTop: "8px", textAlign: "center", order: 2 }}>
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Задай час за:</span>
                      <select
                        className="amp-edit-input"
                        style={{ textAlign: "center" }}
                        value={trainingTimeMode}
                        onChange={(e) => void handleTrainingTimeModeChange(e.target.value as "all" | "perDay" | "byWeekday")}
                        disabled={trainingDaysEditorSaving}
                      >
                        <option value="all">Всички тренировки</option>
                        <option value="perDay">Различни тренировки</option>
                        <option value="byWeekday">Всяка седмица</option>
                      </select>
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysTimeStep && effectiveTrainingDaysActiveStep === "time" && trainingTimeMode === "all" && (
                    <label className="amp-edit-field" style={{ marginTop: "8px", textAlign: "center", order: 2 }}>
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Час на тренировка</span>
                      <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                        <input
                          className="amp-inner-time-input"
                          type="time"
                          step={60}
                          value={schedulerForm.trainingTime}
                          onChange={(e) => handleTrainingAllTimeChange(e.target.value)}
                          required
                          disabled={trainingDaysEditorSaving}
                        />
                      </div>
                    </label>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysTimeStep && effectiveTrainingDaysActiveStep === "time" && (
                      <label className="amp-edit-field" style={{ marginTop: "8px", textAlign: "center", order: 2 }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Продължителност на тренировката (минути)</span>
                        <input
                            style={{ textAlign: "center" }}
                            className="amp-edit-input"
                            type="number"
                            min={1}
                            max={1440}
                            step={5}
                            value={schedulerForm.trainingDurationMinutes}
                            onChange={(e) => setSchedulerForm((prev) => ({ ...prev, trainingDurationMinutes: e.target.value }))}
                            required
                            disabled={trainingDaysEditorSaving}
                        />
                      </label>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysTimeStep && effectiveTrainingDaysActiveStep === "time" && trainingTimeMode === "perDay" && (
                    <div className="amp-training-time-list" style={{ marginTop: "8px", order: 2 }}>
                      {normalizedTrainingDaysSelection.length === 0 ? (
                        <span className="amp-lbl" style={{ opacity: 0.78, textAlign: "center", display: "block" }}>
                          {"\u041f\u044a\u0440\u0432\u043e \u0438\u0437\u0431\u0435\u0440\u0435\u0442\u0435 \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u044a\u0447\u043d\u0438 \u0434\u0430\u0442\u0438."}
                        </span>
                      ) : (
                        normalizedTrainingDaysSelection.map((date) => (
                          <label key={`per-day-time-${date}`} className="amp-edit-field" style={{ textAlign: "center" }}>
                            <span className="amp-lbl" style={{ textAlign: "center" }}>{formatIsoDateForDisplay(date)}</span>
                            <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                              <input
                                className="amp-inner-time-input"
                                type="time"
                                step={60}
                                value={trainingDateTimes[date] ?? ""}
                                onChange={(e) => handleTrainingDateTimeChange(date, e.target.value)}
                                required
                                disabled={trainingDaysEditorSaving}
                              />
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysTimeStep && effectiveTrainingDaysActiveStep === "time" && trainingTimeMode === "byWeekday" && (
                    <div className="amp-training-time-list" style={{ marginTop: "8px", order: 2 }}>
                      {trainingWeekdayBuckets.length === 0 ? (
                        <span className="amp-lbl" style={{ opacity: 0.78, textAlign: "center", display: "block" }}>
                          {"\u041f\u044a\u0440\u0432\u043e \u0438\u0437\u0431\u0435\u0440\u0435\u0442\u0435 \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u044a\u0447\u043d\u0438 \u0434\u0430\u0442\u0438."}
                        </span>
                      ) : (
                        trainingWeekdayBuckets.map((weekdayIndex) => {
                          const weekdayDate = normalizedTrainingDaysSelection.find(
                            (date) => getWeekdayMondayFirstIndex(date) === weekdayIndex,
                          );
                          const weekdayTime =
                            (weekdayDate ? trainingDateTimes[weekdayDate] : "") ??
                            schedulerForm.trainingTime;
                          return (
                            <label key={`weekday-time-${weekdayIndex}`} className="amp-edit-field" style={{ textAlign: "center" }}>
                              <span className="amp-lbl" style={{ textAlign: "center" }}>{TRAINING_WEEKDAY_LONG_BG[weekdayIndex] ?? `#${weekdayIndex + 1}`}</span>
                                <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                                <input
                                  className="amp-inner-time-input"
                                  type="time"
                                  step={60}
                                  value={weekdayTime ?? ""}
                                  onChange={(e) => handleTrainingWeekdayTimeChange(weekdayIndex, e.target.value)}
                                  required
                                  disabled={trainingDaysEditorSaving}
                                />
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                  {trainingDaysEditorMode === "teamGroup" && selectedTeamGroupLinkedTrainingGroups.length > 0 && (
                    <p className="amp-confirm-error" style={{ marginTop: "8px", textAlign: "center", order: 3 }}>
                      {`Внимание: набор ${selectedTeamGroup} участва в сборни отбори (${selectedTeamGroupLinkedTrainingGroups.map((group) => group.name).join(", ")}). При запазване ще бъде премахнат от тях и може да се наложи преименуване на групите.`}
                    </p>
                  )}
                  {trainingDaysEditorMode === "createGroup" && (
                    <>
                      <label className="amp-edit-field" style={{ marginTop: "8px", textAlign: "center" }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Име на група (по избор)</span>
                        <input
                          style={{ textAlign: "center" }}
                          className="amp-edit-input"
                          value={trainingDaysEditorGroupName}
                          onChange={(e) => setTrainingDaysEditorGroupName(e.target.value)}
                          placeholder={trainingDaysEditorGroups.length > 0 ? trainingDaysEditorGroups.map((group) => String(group)).join("/") : "2012/2013"}
                          disabled={trainingDaysEditorSaving}
                        />
                      </label>
                      <div className="amp-training-days-editor-header" style={{ marginTop: "8px", alignItems: "center", flexDirection: "column", gap: "8px", textAlign: "center" }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Набори за прилагане (може повече от един):</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                          {groupOptions.map((group) => {
                            const value = String(group);
                            const isChecked = trainingDaysEditorGroups.includes(value);
                            return (
                              <label
                                key={`training-days-group-${group}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "6px",
                                  padding: "6px 10px",
                                  borderRadius: "999px",
                                  border: "1px solid rgba(255,255,255,0.22)",
                                  background: isChecked ? "rgba(50,205,50,0.16)" : "rgba(255,255,255,0.06)",
                                  cursor: trainingDaysEditorSaving ? "default" : "pointer",
                                  textAlign: "center"
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={trainingDaysEditorSaving}
                                  onChange={(e) => {
                                    setTrainingDaysEditorGroups((prev) => {
                                      if (e.target.checked) {
                                        return [...new Set([...prev, value])].sort((a, b) => Number(a) - Number(b));
                                      }
                                      return prev.filter((item) => item !== value);
                                    });
                                  }}
                                />
                                <span className="amp-lbl">Набор {group}</span>
                              </label>
                            );
                          })}
                        </div>
                        <span className="amp-lbl" style={{ opacity: 0.8, textAlign: "center" }}>
                          {trainingDaysEditorGroups.length === 0
                            ? "Изберете поне 2 набора."
                            : `Избрани набори: ${trainingDaysEditorGroups.join(", ")}`}
                        </span>
                      </div>
                    </>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && effectiveTrainingDaysActiveStep === "days" && (
                    <div className="amp-training-calendar" style={{ order: 1 }}>
                      {schedulerCalendarMonthsTrimmed.length > 1 && (
                        <div className="amp-training-month-nav">
                          <button type="button" className="amp-training-month-nav-btn" onClick={() => setSchedulerCalendarVisibleMonthIdx((i) => Math.max(0, i - 1))} disabled={schedulerCalendarVisibleMonthIdx === 0} aria-label="Предишен месец">‹</button>
                          <button type="button" className="amp-training-month-nav-btn" onClick={() => setSchedulerCalendarVisibleMonthIdx((i) => Math.min(schedulerCalendarMonthsTrimmed.length - 1, i + 1))} disabled={schedulerCalendarVisibleMonthIdx === schedulerCalendarMonths.length - 1} aria-label="Следващ месец">›</button>
                        </div>
                      )}
                      {schedulerCalendarMonthsTrimmed.slice(schedulerCalendarVisibleMonthIdx, schedulerCalendarVisibleMonthIdx + 1).map((month) => (
                        <div key={month.key} className="amp-training-month">
                          <div className="amp-training-month-title">{month.label}</div>
                          <div className="amp-training-weekdays-row">
                            {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                              <span key={`${month.key}-${weekday}`} className="amp-training-weekday-cell">
                                {weekday}
                              </span>
                            ))}
                          </div>
                          <div className="amp-training-month-grid">
                            {month.cells.map((date, index) => {
                              if (!date) {
                                return (
                                  <span
                                    key={`${month.key}-empty-${index}`}
                                    className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                    aria-hidden="true"
                                  />
                                );
                              }
                              if (date < todayIsoDate) {
                                return (
                                  <span
                                    key={date}
                                    className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                    aria-hidden="true"
                                  />
                                );
                              }
                              const dayNumber = Number.parseInt(date.slice(8, 10), 10);
                              const isSelectable = schedulerCalendarDateSet.has(date);
                              if (!isSelectable) {
                                return (
                                  <span
                                    key={date}
                                    className="amp-training-calendar-cell amp-training-calendar-cell--disabled"
                                    aria-hidden="true"
                                  >
                                    <span className="amp-training-day-number">{dayNumber}</span>
                                  </span>
                                );
                              }

                              const isSelected = schedulerForm.trainingDates.includes(date);
                              const isPreExisting = trainingDaysPreExistingDates.includes(date) && !isSelected;
                              if (isPreExisting) {
                                return (
                                  <span
                                    key={date}
                                    className="amp-training-calendar-cell amp-training-calendar-cell--existing"
                                    title="Вече насрочена"
                                  >
                                    <span className="amp-training-day-number">{dayNumber}</span>
                                  </span>
                                );
                              }
                              return (
                                <button
                                  key={date}
                                  type="button"
                                  className={`amp-training-date-btn${isSelected ? " amp-training-date-btn--active" : ""}`}
                                  onClick={() => toggleTrainingDate(date)}
                                  disabled={trainingDaysEditorSaving}
                                >
                                  <span className="amp-training-day-number">{dayNumber}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysSpotsStep && effectiveTrainingDaysActiveStep === "spots" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8, order: 2 }}>
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Режим на присъствие</span>
                      {!schedulerPerDayLimited && (
                        <>
                          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              style={{
                                flex: "1 1 160px", maxWidth: 220, padding: "14px 16px", borderRadius: 10, border: `2px solid ${!schedulerLimitedMode ? "rgba(102,187,106,0.8)" : "rgba(255,255,255,0.15)"}`,
                                background: !schedulerLimitedMode ? "rgba(102,187,106,0.12)" : "rgba(255,255,255,0.04)",
                                color: "#fff", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                              }}
                              onClick={() => setSchedulerLimitedMode(false)}
                              disabled={trainingDaysEditorSaving}
                            >
                              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Всички участват</div>
                              <div style={{ fontSize: 12, opacity: 0.65, lineHeight: 1.4 }}>Всеки активен състезател е маркиран като присъстващ по подразбиране.</div>
                            </button>
                            <button
                              type="button"
                              style={{
                                flex: "1 1 160px", maxWidth: 220, padding: "14px 16px", borderRadius: 10, border: `2px solid ${schedulerLimitedMode ? "rgba(240,160,48,0.8)" : "rgba(255,255,255,0.15)"}`,
                                background: schedulerLimitedMode ? "rgba(240,160,48,0.10)" : "rgba(255,255,255,0.04)",
                                color: "#fff", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                              }}
                              onClick={() => setSchedulerLimitedMode(true)}
                              disabled={trainingDaysEditorSaving}
                            >
                              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Ограничен брой места</div>
                              <div style={{ fontSize: 12, opacity: 0.65, lineHeight: 1.4 }}>Състезателите се записват сами. Само записаните участват.</div>
                            </button>
                          </div>
                          {schedulerLimitedMode && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginTop: 4 }}>
                              <label style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Брой места:</label>
                              <input
                                type="number"
                                min={1}
                                max={200}
                                value={schedulerLimitedSpots}
                                onChange={(e) => setSchedulerLimitedSpots(e.target.value)}
                                style={{ width: 80, padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 14 }}
                                disabled={trainingDaysEditorSaving}
                              />
                            </div>
                          )}
                        </>
                      )}
                      {schedulerPerDayLimited && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {normalizedTrainingDaysSelection.map((date) => {
                            const cfg = schedulerPerDayConfig[date] ?? { limited: false, spots: schedulerLimitedSpots };
                            const spotsNum = parseInt(cfg.spots, 10);
                            const spotsInvalid = cfg.limited && (!Number.isInteger(spotsNum) || spotsNum < 1 || spotsNum > 200);
                            return (
                              <div key={date} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                                <span style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.8)" }}>{formatIsoDateForDisplay(date)}</span>
                                <button
                                  type="button"
                                  disabled={trainingDaysEditorSaving}
                                  style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${!cfg.limited ? "rgba(102,187,106,0.8)" : "rgba(255,255,255,0.15)"}`, background: !cfg.limited ? "rgba(102,187,106,0.15)" : "rgba(255,255,255,0.05)", color: "#fff" }}
                                  onClick={() => setSchedulerPerDayConfig((prev) => ({ ...prev, [date]: { limited: false, spots: prev[date]?.spots ?? schedulerLimitedSpots } }))}
                                >Всички</button>
                                <button
                                  type="button"
                                  disabled={trainingDaysEditorSaving}
                                  style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${cfg.limited ? "rgba(240,160,48,0.8)" : "rgba(255,255,255,0.15)"}`, background: cfg.limited ? "rgba(240,160,48,0.12)" : "rgba(255,255,255,0.05)", color: "#fff" }}
                                  onClick={() => setSchedulerPerDayConfig((prev) => ({ ...prev, [date]: { limited: true, spots: prev[date]?.spots ?? schedulerLimitedSpots } }))}
                                >Ограничено</button>
                                {cfg.limited && (
                                  <input
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={cfg.spots}
                                    disabled={trainingDaysEditorSaving}
                                    onChange={(e) => setSchedulerPerDayConfig((prev) => ({ ...prev, [date]: { limited: true, spots: e.target.value } }))}
                                    style={{ width: 60, padding: "4px 8px", borderRadius: 6, border: `1px solid ${spotsInvalid ? "rgba(229,57,53,0.7)" : "rgba(255,255,255,0.2)"}`, background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 13 }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {normalizedTrainingDaysSelection.length > 1 && (
                        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
                          <label className={`amp-group-check-chip${schedulerPerDayLimited ? " is-selected" : ""}${trainingDaysEditorSaving ? " is-disabled" : ""}`} style={{ fontSize: 13 }}>
                            <input
                              className="amp-group-check-input"
                              type="checkbox"
                              checked={schedulerPerDayLimited}
                              disabled={trainingDaysEditorSaving}
                              onChange={(e) => {
                                const on = e.target.checked;
                                setSchedulerPerDayLimited(on);
                                if (on) {
                                  const init: Record<string, { limited: boolean; spots: string }> = {};
                                  for (const d of normalizedTrainingDaysSelection) {
                                    init[d] = { limited: schedulerLimitedMode, spots: schedulerLimitedSpots };
                                  }
                                  setSchedulerPerDayConfig(init);
                                }
                              }}
                            />
                            <span className="amp-group-check-box" aria-hidden="true" />
                            Различна настройка за всеки ден
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysFieldStep && effectiveTrainingDaysActiveStep === "field" && trainingFields.length > 0 && (
                      <div style={{ display: "grid", gap: "12px", marginTop: "8px", width: "min(100%, 620px)", marginInline: "auto", order: 3 }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Терен по дни{fieldConflictsLoading ? " …" : ""}</span>
                        <div className="amp-pills" style={{ justifyContent: "center" }}>
                          {normalizedTrainingDaysSelection.map((date) => (
                            <button
                              key={`field-date-${date}`}
                              type="button"
                              className={`amp-pill${trainingFieldActiveDate === date ? " amp-pill--active" : ""}`}
                              onClick={() => setTrainingFieldActiveDate(date)}
                              disabled={trainingDaysEditorSaving}
                            >
                              {formatIsoDateForDisplay(date)}
                            </button>
                          ))}
                        </div>
                        <span className="amp-lbl" style={{ textAlign: "center", opacity: 0.82 }}>
                          Избран ден: {trainingFieldActiveDate ? formatIsoDateForDisplay(trainingFieldActiveDate) : "-"}
                        </span>
                        <div style={{ display: "grid", gap: "12px" }}>
                          {trainingFields.map((field) => {
                            const isFieldSelected = activeTrainingFieldSelection.trainingFieldId === field.id;
                            const isWholeFieldSelected = isFieldSelected && activeTrainingFieldSelection.trainingFieldPieceIds.length === 0;
                            const anyFieldSelected = !!activeTrainingFieldSelection.trainingFieldId;
                            const fieldConflict = fieldConflictsMap[field.id];
                            const isWholeFieldConflicted = Boolean(fieldConflict?.wholeFieldBlocked);
                            const pieces = field.pieces.length > 0
                                ? field.pieces
                                : [{ id: "", name: "Цял терен", sortOrder: 0 }];
                            return (
                                <div key={field.id} style={{ display: "grid", gap: "6px", opacity: anyFieldSelected && !isFieldSelected ? 0.38 : 1, transition: "opacity 0.15s ease" }}>
                                  <button
                                      type="button"
                                      onClick={() => {
                                        if (isWholeFieldConflicted) return;
                                        setTrainingFieldSelections((prev) => ({
                                          ...prev,
                                          [trainingFieldActiveDate]: { trainingFieldId: field.id, trainingFieldPieceIds: [] },
                                        }));
                                      }}
                                      disabled={trainingDaysEditorSaving || trainingFieldsLoading}
                                      title={isWholeFieldConflicted ? "Целият терен е зает в избрания час" : undefined}
                                      style={{
                                        border: 0,
                                        background: "transparent",
                                        color: isWholeFieldSelected ? "#32cd32" : isWholeFieldConflicted ? "rgba(255,120,120,0.75)" : "rgba(255,255,255,0.88)",
                                        fontWeight: 800,
                                        fontSize: "14px",
                                        textAlign: "center",
                                        cursor: trainingDaysEditorSaving || trainingFieldsLoading || isWholeFieldConflicted ? "default" : "pointer",
                                        padding: 0,
                                        textDecoration: isWholeFieldSelected ? "underline" : isWholeFieldConflicted ? "line-through" : "none",
                                        textUnderlineOffset: "3px",
                                        opacity: isFieldSelected && activeTrainingFieldSelection.trainingFieldPieceIds.length > 0 ? 0.38 : 1,
                                        transition: "opacity 0.15s ease, color 0.15s ease",
                                      }}
                                  >
                                    {field.name}
                                  </button>
                                  <div
                                      role="group"
                                      aria-label={`Терен ${field.name}`}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: `repeat(${pieces.length}, minmax(0, 1fr))`,
                                        minHeight: ["boxing", "karate"].includes(field.fieldType || "football") ? undefined : "96px",
                                        width: ["boxing", "karate"].includes(field.fieldType || "football") ? "55%" : "100%",
                                        margin: ["boxing", "karate"].includes(field.fieldType || "football") ? "0 auto" : undefined,
                                        aspectRatio: ["boxing", "karate"].includes(field.fieldType || "football") ? "1 / 1" : "2.2 / 1",
                                        border: isFieldSelected
                                            ? "2px solid rgba(50,205,50,0.8)"
                                            : "1px solid rgba(255,255,255,0.38)",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        background: getFieldBackground(field.fieldType || "football"),
                                        boxShadow: isFieldSelected ? "0 0 0 1px rgba(50,205,50,0.6), 0 0 22px rgba(50,205,50,0.28)" : "none",
                                        position: "relative",
                                      }}
                                  >
                                    {renderFieldMarkings(field.fieldType || "football")}
                                    {pieces.map((piece, index) => {
                                      const isPieceConflicted = field.pieces.length === 0
                                          ? isWholeFieldConflicted
                                          : Boolean(fieldConflict?.blockedPieceIds.includes(piece.id));
                                      const isPieceSelected =
                                          field.pieces.length === 0
                                              ? isWholeFieldSelected
                                              : isFieldSelected && (
                                              activeTrainingFieldSelection.trainingFieldPieceIds.length === 0 ||
                                              activeTrainingFieldSelection.trainingFieldPieceIds.includes(piece.id)
                                          );
                                      return (
                                          <button
                                              key={piece.id || `${field.id}-whole`}
                                              type="button"
                                              title={isPieceConflicted ? "Тази позиция е заета в избрания час" : undefined}
                                              onClick={() => {
                                                if (isPieceConflicted) return;
                                                if (field.pieces.length === 0) {
                                                  setTrainingFieldSelections((prev) => ({
                                                    ...prev,
                                                    [trainingFieldActiveDate]: { trainingFieldId: field.id, trainingFieldPieceIds: [] },
                                                  }));
                                                  return;
                                                }
                                                setTrainingFieldSelections((prev) => {
                                                  const current = prev[trainingFieldActiveDate];
                                                  const prevIds = current?.trainingFieldId === field.id && current.trainingFieldPieceIds.length > 0
                                                      ? current.trainingFieldPieceIds
                                                      : [];
                                                  let nextIds: string[];
                                                  if (prevIds.includes(piece.id)) {
                                                    nextIds = prevIds.filter((id) => id !== piece.id);
                                                    if (nextIds.length === 0) nextIds = [];
                                                  } else {
                                                    nextIds = [...prevIds, piece.id];
                                                    if (nextIds.length === field.pieces.length) nextIds = [];
                                                  }
                                                  return { ...prev, [trainingFieldActiveDate]: { trainingFieldId: field.id, trainingFieldPieceIds: nextIds } };
                                                });
                                              }}
                                              disabled={trainingDaysEditorSaving || trainingFieldsLoading}
                                              style={{
                                                minWidth: 0,
                                                border: 0,
                                                borderLeft: index === 0 ? 0 : "1px dashed rgba(255,255,255,0.68)",
                                                background: isPieceConflicted
                                                    ? "rgba(180,0,0,0.32)"
                                                    : isPieceSelected
                                                        ? "rgba(50,205,50,0.18)"
                                                        : isFieldSelected && activeTrainingFieldSelection.trainingFieldPieceIds.length > 0 && !isPieceSelected
                                                            ? "rgba(0,0,0,0.52)"
                                                            : "transparent",
                                                boxShadow: isPieceSelected && !isPieceConflicted ? "inset 0 0 0 2px #32cd32" : "none",
                                                color: isPieceConflicted
                                                    ? "rgba(255,120,120,0.85)"
                                                    : isPieceSelected
                                                        ? "#32cd32"
                                                        : isFieldSelected && activeTrainingFieldSelection.trainingFieldPieceIds.length > 0 && !isPieceSelected
                                                            ? "rgba(255,255,255,0.42)"
                                                            : "rgba(255,255,255,0.86)",
                                                fontWeight: 800,
                                                fontSize: "13px",
                                                textAlign: "center",
                                                padding: "8px",
                                                cursor: trainingDaysEditorSaving || trainingFieldsLoading || isPieceConflicted ? "not-allowed" : "pointer",
                                                position: "relative",
                                                zIndex: 1,
                                                textShadow: "0 1px 2px rgba(0,0,0,0.55)",
                                                textDecoration: isPieceConflicted ? "line-through" : "none",
                                                transition: "background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
                                              }}
                                          >
                                            {piece.id ? piece.name : null}
                                          </button>
                                      );
                                    })}
                                  </div>
                                </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                          <button
                              type="button"
                              className="amp-btn amp-btn--ghost"
                              onClick={() => openTrainingFieldModal()}
                              disabled={trainingDaysEditorSaving}
                          >
                            Добави терен
                          </button>
                          {selectedActiveTrainingField && (
                              <button
                                  type="button"
                                  className="amp-btn amp-btn--ghost"
                                  onClick={() => openTrainingFieldModal(selectedActiveTrainingField)}
                                  disabled={trainingDaysEditorSaving}
                              >
                                Редактирай терен
                              </button>
                          )}
                        </div>
                      </div>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysFieldStep && effectiveTrainingDaysActiveStep === "field" && trainingFields.length === 0 && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginTop: "8px", order: 3 }}>
                        <p style={{ margin: 0, textAlign: "center", opacity: 0.6, fontSize: "0.9em" }}>Изборът на терен не е задължителен.</p>
                        <button
                            type="button"
                            className="amp-btn amp-btn--ghost"
                            onClick={() => openTrainingFieldModal()}
                            disabled={trainingDaysEditorSaving}
                        >
                          Добави терен
                        </button>
                      </div>
                  )}
                  {canShowTrainingDaysFieldStep && effectiveTrainingDaysActiveStep === "field" && hasMissingTrainingField && (
                      <p className="amp-confirm-error" style={{ textAlign: "center", order: 4 }}>{missingTrainingFieldMessage}</p>
                  )}
                  {trainingDaysEditorMode !== "createGroup" && canShowTrainingDaysNotesStep && effectiveTrainingDaysActiveStep === "notes" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px", order: 3 }}>
                      <p style={{ margin: 0, textAlign: "center", opacity: 0.65, fontSize: "0.85em" }}>
                        Описанието е по избор. Можете да зададете различен текст за всяка тренировка.
                      </p>
                      {normalizedTrainingDaysSelection.map((date) => (
                        <label key={`note-${date}`} className="amp-edit-field" style={{ textAlign: "center" }}>
                          <span className="amp-lbl" style={{ textAlign: "center" }}>{formatIsoDateForDisplay(date)}</span>
                          <textarea
                            className="amp-edit-input amp-training-note"
                            value={trainingDayScheduleNotes[date] ?? ""}
                            onChange={(e) => setTrainingDayScheduleNotes((prev) => ({ ...prev, [date]: e.target.value }))}
                            rows={2}
                            maxLength={1000}
                            placeholder="Инструкции, сборен час, локация..."
                            disabled={trainingDaysEditorSaving}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {trainingDaysEditorError && <p className="amp-confirm-error" style={{ textAlign: "center", order: 4 }}>{trainingDaysEditorError}</p>}
                  {isTrainingDaysScheduleUnchanged && !trainingDaysEditorError && (
                    <p className="amp-confirm-error" style={{ textAlign: "center", order: 4 }}>Графикът е същият като предишния.</p>
                  )}
                  {(showTrainingStepBack || showTrainingStepNext) && (
                    <div className="amp-training-step-nav" style={{ order: 4 }}>
                      {showTrainingStepBack && (
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => {
                            if (effectiveTrainingDaysActiveStep === "notes") {
                              setTrainingDaysActiveStep("field");
                            } else if (effectiveTrainingDaysActiveStep === "field") {
                              setTrainingDaysActiveStep(canShowTrainingDaysSpotsStep ? "spots" : "time");
                            } else if (effectiveTrainingDaysActiveStep === "spots") {
                              setTrainingDaysActiveStep("time");
                            } else {
                              setTrainingDaysActiveStep("days");
                            }
                          }}
                          disabled={trainingDaysEditorSaving}
                        >
                          Назад
                        </button>
                      )}
                      {showTrainingStepNext && (
                        <button
                          type="button"
                          className="amp-btn amp-btn--primary"
                          onClick={() => {
                            if (effectiveTrainingDaysActiveStep === "days") {
                              setTrainingDaysActiveStep("time");
                            } else if (effectiveTrainingDaysActiveStep === "time") {
                              setTrainingDaysActiveStep(canShowTrainingDaysSpotsStep ? "spots" : "field");
                            } else if (effectiveTrainingDaysActiveStep === "spots") {
                              setTrainingDaysActiveStep("field");
                            } else {
                              setTrainingDaysActiveStep("notes");
                            }
                          }}
                          disabled={isTrainingStepNextDisabled}
                        >
                          Напред
                        </button>
                      )}
                    </div>
                  )}
                  <div className="amp-modal-actions" style={{ justifyContent: "center", order: 4 }}>
                    <button
                      type="button"
                      className="amp-btn amp-btn--ghost"
                      onClick={() => {
                        setTrainingDaysEditorOpen(false);
                        setTrainingDaysEditorCreateOpen(false);
                        setTrainingDaysEditorError("");
                      }}
                      disabled={trainingDaysEditorSaving}
                    >
                      Отказ
                    </button>
                    {(trainingDaysEditorMode === "createGroup" || effectiveTrainingDaysActiveStep === "notes") && (
                      <button
                        type="button"
                        className="amp-btn amp-btn--primary"
                        onClick={() => void (trainingDaysEditorMode === "createGroup" ? saveTrainingDaysForSelectedGroups() : saveTrainingDaysFromTrainingModal())}
                        disabled={
                          trainingDaysEditorSaving ||
                          trainingDaysEditorLoading ||
                          (trainingDaysEditorMode !== "createGroup" && isTrainingDaysScheduleUnchanged) ||
                          (trainingDaysEditorMode !== "createGroup" &&
                            hasMissingTrainingTime) ||
                          hasMissingTrainingField ||
                          hasInvalidTrainingDuration
                        }
                      >
                        {trainingDaysEditorSaving
                          ? "Запазване..."
                          : trainingDaysEditorMode === "createGroup"
                            ? "Създай сборен отбор"
                            : "Запази дни"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {trainingFieldModalOpen && (
        <div className="amp-overlay amp-overlay--confirm" onClick={() => !trainingFieldSaving && setTrainingFieldModalOpen(false)}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">{trainingFieldEditId ? "Редактирай терен" : "Добави терен"}</span>
              <button
                className="amp-modal-close"
                onClick={() => setTrainingFieldModalOpen(false)}
                aria-label="Затвори"
                disabled={trainingFieldSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              <label className="amp-edit-field" style={{ textAlign: "center" }}>
                <span className="amp-lbl" style={{ textAlign: "center" }}>Вид терен</span>
                <select
                  className="amp-edit-input"
                  value={trainingFieldType}
                  onChange={(e) => setTrainingFieldType(e.target.value)}
                  disabled={trainingFieldSaving}
                  style={{ textAlign: "center" }}
                >
                  <option value="football">Футбол</option>
                  <option value="basketball">Баскетбол</option>
                  <option value="tennis">Тенис</option>
                  <option value="volleyball">Волейбол</option>
                  <option value="boxing">Бокс</option>
                  <option value="karate">Карате / Таекуондо</option>
                  <option value="swimming">Плувен басейн</option>
                </select>
              </label>
              <label className="amp-edit-field" style={{ textAlign: "center" }}>
                <span className="amp-lbl" style={{ textAlign: "center" }}>Име на терена</span>
                <input
                  className="amp-edit-input"
                  style={{ textAlign: "center" }}
                  value={trainingFieldName}
                  onChange={(e) => setTrainingFieldName(e.target.value)}
                  disabled={trainingFieldSaving}
                />
              </label>

              <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
                <span className="amp-lbl" style={{ textAlign: "center" }}>Полета на терена</span>
                {trainingFieldPieces.length === 0 ? (
                  <p className="amp-empty amp-empty--modal" style={{ margin: 0 }}>Теренът ще се използва като цял.</p>
                ) : (
                  trainingFieldPieces.map((piece, index) => (
                    <label key={`${piece.id ?? "new"}-${index}`} className="amp-edit-field" style={{ textAlign: "center" }}>
                      <span className="amp-lbl" style={{ textAlign: "center" }}>{`Поле ${index + 1}`}</span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          className="amp-edit-input"
                          style={{ textAlign: "center" }}
                          value={piece.name}
                          onChange={(e) => {
                            const nextName = e.target.value;
                            setTrainingFieldPieces((prev) => prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, name: nextName } : item,
                            ));
                          }}
                          disabled={trainingFieldSaving}
                        />
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => setTrainingFieldPieces((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                          disabled={trainingFieldSaving}
                        >
                          Премахни
                        </button>
                      </div>
                    </label>
                  ))
                )}
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setTrainingFieldPieces((prev) =>
                    prev.length === 0
                      ? [{ id: null, name: "Поле 1" }, { id: null, name: "Поле 2" }]
                      : [...prev, { id: null, name: `Поле ${prev.length + 1}` }],
                  )}
                  disabled={trainingFieldSaving}
                >
                  Раздели на полета
                </button>
              </div>

              {trainingFieldError && <p className="amp-confirm-error" style={{ textAlign: "center" }}>{trainingFieldError}</p>}

              <div className="amp-modal-actions amp-modal-actions--end">
                {trainingFieldEditId && (
                  <button
                    type="button"
                    className="amp-btn amp-btn--danger"
                    onClick={() => void deleteTrainingField(trainingFieldEditId)}
                    disabled={trainingFieldSaving}
                  >
                    Изтрий
                  </button>
                )}
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setTrainingFieldModalOpen(false)}
                  disabled={trainingFieldSaving}
                >
                  Отказ
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--primary"
                  onClick={() => void saveTrainingField()}
                  disabled={trainingFieldSaving}
                >
                  {trainingFieldSaving ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {trainingDaysSuccessOpen && (
        <div className="amp-overlay amp-overlay--confirm" onClick={() => setTrainingDaysSuccessOpen(false)}>
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Изпратено</span>
              <button
                className="amp-modal-close"
                onClick={() => setTrainingDaysSuccessOpen(false)}
                aria-label="Затвори"
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              <p className="amp-confirm-text">{trainingDaysSuccessMessage}</p>
              <div className="amp-modal-actions amp-modal-actions--end">
                <button className="amp-btn amp-btn--primary" onClick={() => setTrainingDaysSuccessOpen(false)}>
                  Добре
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {(trainingDayDetailsOpen || trainingDayDetailsOpening) && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => {
            if (!trainingNoteSaving && !trainingDayDetailsTabLoading && !trainingDayDetailsOpening) {
              setTrainingDayDetailsOpen(false);
              setTrainingAttendanceView(trainingDayDetailsViewSnapshot);
            }
          }}
        >
          <div className="amp-modal amp-modal--confirm amp-modal--training-day-details" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className={`amp-modal-title-gradient${dayDetailsIsMatchTab ? " amp-modal-title-gradient--match" : ""}`}>
                {dayDetailsIsMatchTab ? "Детайли за мач" : "Детайли за тренировка"}
              </span>
              <button
                className="amp-modal-close"
                onClick={() => { setTrainingDayDetailsOpen(false); setDayDetailsMatchEditOpen(false); setDayDetailsMatchDeleteConfirm(false); setDayDetailsMatchError(""); setTrainingAttendanceView(trainingDayDetailsViewSnapshot); }}
                aria-label="Затвори"
                disabled={trainingNoteSaving || trainingDayDetailsTabLoading || dayDetailsMatchSaving || trainingDayDetailsOpening}
              >
                <XIcon />
              </button>
            </h2>
            {trainingDayDetailsOpening ? (
              <div className="amp-modal-body">
                <div className="amp-loading">
                  <div className="amp-spinner" />
                </div>
              </div>
            ) : !matchEditTarget && dayDetailsHasTabs && (
              <div className="amp-day-details-tabs">
                {dayDetailsSessions.length > 0 ? (
                  dayDetailsSessions.map((session) => {
                    const isActive = !dayDetailsIsMatchTab && (dayDetailsSessions.length === 1 || trainingDayDetailsTab === session.id);
                    const accent = session.color && isCustomTrainingGroupPaletteColor(session.color) ? session.color : null;
                    const tabStyle: CSSProperties | undefined = accent ? {
                      borderColor: customTrainingGroupAccentRgba(accent, isActive ? 0.6 : 0.25),
                      color: customTrainingGroupReadableOnAccent(accent) === "#fafafa" ? `rgba(255,255,255,${isActive ? 0.9 : 0.75})` : accent,
                      background: isActive ? customTrainingGroupAccentRgba(accent, 0.14) : undefined,
                    } : undefined;
                    return (
                      <button
                        key={session.id}
                        type="button"
                        className={`amp-day-details-tab${accent ? " amp-day-details-tab--custom" : " amp-day-details-tab--training"}${isActive ? " amp-day-details-tab--active" : ""}`}
                        style={tabStyle}
                        onClick={() => {
                          setTrainingDayDetailsTab(session.id);
                          if ((dayDetailsSessions.length > 1 || dayDetailsIsMatchTab) && trainingAttendanceDate) {
                            void loadDayDetailsSessionAttendance(session, trainingAttendanceDate);
                          }
                        }}
                        disabled={trainingDayDetailsTabLoading || trainingNoteSaving}
                      >
                        <span className="amp-day-details-tab-type">Тренировка</span>
                        <span className="amp-day-details-tab-time">{session.trainingTime ?? "—"}</span>
                        <span className="amp-day-details-tab-label">{session.label}</span>
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    className={`amp-day-details-tab amp-day-details-tab--training${!dayDetailsIsMatchTab ? " amp-day-details-tab--active" : ""}`}
                    onClick={() => setTrainingDayDetailsTab("training")}
                    disabled={trainingDayDetailsTabLoading || trainingNoteSaving}
                  >
                    <span className="amp-day-details-tab-type">Тренировка</span>
                    <span className="amp-day-details-tab-time">—</span>
                  </button>
                )}
                {dayDetailsMatchesAll.map((match) => {
                  const isActive = trainingDayDetailsTab === `match-${match.id}`;
                  const matchGroup = customTrainingGroups.find((g) => g.id === match.customGroupId) ?? null;
                  const matchGroupName = matchGroup?.name ?? null;
                  const matchAccent = matchGroup?.color && isCustomTrainingGroupPaletteColor(matchGroup.color) ? matchGroup.color : null;
                  const matchTabStyle: CSSProperties | undefined = matchAccent ? {
                    borderColor: customTrainingGroupAccentRgba(matchAccent, isActive ? 0.6 : 0.25),
                    color: customTrainingGroupReadableOnAccent(matchAccent) === "#fafafa" ? `rgba(255,255,255,${isActive ? 0.9 : 0.75})` : matchAccent,
                    background: isActive ? customTrainingGroupAccentRgba(matchAccent, 0.14) : undefined,
                  } : undefined;
                  return (
                    <button
                      key={match.id}
                      type="button"
                      className={`amp-day-details-tab${matchAccent ? " amp-day-details-tab--custom" : " amp-day-details-tab--match"}${isActive ? " amp-day-details-tab--active" : ""}`}
                      style={matchTabStyle}
                      onClick={() => { setTrainingDayDetailsTab(`match-${match.id}`); setDayDetailsMatchEditOpen(false); setDayDetailsMatchDeleteConfirm(false); setDayDetailsMatchError(""); }}
                      disabled={trainingDayDetailsTabLoading || trainingNoteSaving}
                    >
                      <span className="amp-day-details-tab-type">Мач</span>
                      <span className="amp-day-details-tab-time">{match.matchTime}</span>
                      {matchGroupName && <span className="amp-day-details-tab-label">{matchGroupName}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {!trainingDayDetailsOpening && <div className="amp-modal-body">
              {dayDetailsIsMatchTab && dayDetailsActiveMatch ? (
                (() => {
                  const matchGroup = customTrainingGroups.find((g) => g.id === dayDetailsActiveMatch.customGroupId) ?? null;
                  const matchGroupColor = matchGroup?.color && isCustomTrainingGroupPaletteColor(matchGroup.color) ? matchGroup.color : null;
                  return dayDetailsMatchEditOpen ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Дата</span>
                        <input type="date" className="amp-edit-input" value={dayDetailsMatchEditForm.matchDate} onChange={(e) => setDayDetailsMatchEditForm((f) => ({ ...f, matchDate: e.target.value }))} disabled={dayDetailsMatchSaving} />
                      </div>
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Час</span>
                        <input type="time" className="amp-edit-input" value={dayDetailsMatchEditForm.matchTime} onChange={(e) => setDayDetailsMatchEditForm((f) => ({ ...f, matchTime: e.target.value }))} disabled={dayDetailsMatchSaving} />
                      </div>
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Продължителност (мин.)</span>
                        <input type="number" className="amp-edit-input" min={1} max={1440} value={dayDetailsMatchEditForm.durationMinutes} onChange={(e) => setDayDetailsMatchEditForm((f) => ({ ...f, durationMinutes: e.target.value }))} disabled={dayDetailsMatchSaving} />
                      </div>
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Домакин / Гост</span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button type="button" className={`amp-btn${dayDetailsMatchEditForm.isHome ? " amp-btn--primary" : " amp-btn--ghost"}`} onClick={() => setDayDetailsMatchEditForm((f) => ({ ...f, isHome: true }))} disabled={dayDetailsMatchSaving}>Домакин</button>
                          <button type="button" className={`amp-btn${!dayDetailsMatchEditForm.isHome ? " amp-btn--primary" : " amp-btn--ghost"}`} onClick={() => setDayDetailsMatchEditForm((f) => ({ ...f, isHome: false }))} disabled={dayDetailsMatchSaving}>Гост</button>
                        </div>
                      </div>
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Съперник</span>
                        <input type="text" className="amp-edit-input" value={dayDetailsMatchEditForm.opponent} onChange={(e) => setDayDetailsMatchEditForm((f) => ({ ...f, opponent: e.target.value }))} placeholder="Съперник" disabled={dayDetailsMatchSaving} />
                      </div>
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Място</span>
                        <input type="text" className="amp-edit-input" value={dayDetailsMatchEditForm.location} onChange={(e) => setDayDetailsMatchEditForm((f) => ({ ...f, location: e.target.value }))} placeholder="Стадион / адрес" disabled={dayDetailsMatchSaving} />
                      </div>
                      {isCustomTrainingGroupMode && customTrainingGroups.length > 0 && (
                        <div className="amp-edit-field">
                          <span className="amp-lbl">Група</span>
                          <select className="amp-edit-input" value={dayDetailsMatchEditForm.customGroupId ?? ""} onChange={(e) => setDayDetailsMatchEditForm((f) => ({ ...f, customGroupId: e.target.value || null }))} disabled={dayDetailsMatchSaving}>
                            <option value="">— без група —</option>
                            {customTrainingGroups.map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {dayDetailsMatchError && <p style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>{dayDetailsMatchError}</p>}
                      <div className="amp-modal-actions amp-modal-actions--end">
                        <button type="button" className="amp-btn amp-btn--ghost" onClick={() => {
                          setDayDetailsMatchEditOpen(false);
                          setDayDetailsMatchError("");
                          if (matchEditTarget) {
                            setTrainingDayDetailsOpen(false);
                            setMatchEditTarget(null);
                            setMatchViewPopupOpen(true);
                          }
                        }} disabled={dayDetailsMatchSaving}>Назад</button>
                        <button type="button" className="amp-btn amp-btn--primary" onClick={() => void handleDayDetailsMatchSave()} disabled={dayDetailsMatchSaving}>{dayDetailsMatchSaving ? "Запазване..." : "Запази"}</button>
                      </div>
                    </div>
                  ) : dayDetailsMatchDeleteConfirm ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", textAlign: "center", padding: "8px 0" }}>
                      <p style={{ color: "rgba(255,255,255,0.88)", margin: 0 }}>Сигурни ли сте, че искате да изтриете този мач?</p>
                      {dayDetailsMatchError && <p style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>{dayDetailsMatchError}</p>}
                      <div className="amp-modal-actions amp-modal-actions--end">
                        <button type="button" className="amp-btn amp-btn--ghost" onClick={() => { setDayDetailsMatchDeleteConfirm(false); setDayDetailsMatchError(""); }} disabled={dayDetailsMatchSaving}>Отказ</button>
                        <button type="button" className="amp-btn amp-btn--danger" onClick={() => void handleDayDetailsMatchDelete()} disabled={dayDetailsMatchSaving}>{dayDetailsMatchSaving ? "Изтриване..." : "Изтрий мача"}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="amp-match-view-date">
                        {new Date(`${dayDetailsActiveMatch.matchDate}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
                          weekday: "long", day: "2-digit", month: "long", year: "numeric",
                        })}
                      </p>
                      <div className="amp-match-view-body">
                        {matchGroup && (
                          <div className="amp-match-view-row">
                            <span className="amp-match-view-label">Група</span>
                            <span className="amp-match-view-value" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {matchGroupColor && <span style={{ width: 10, height: 10, borderRadius: "50%", background: matchGroupColor, flexShrink: 0 }} />}
                              {matchGroup.name}
                            </span>
                          </div>
                        )}
                        <div className="amp-match-view-row">
                          <span className="amp-match-view-label">Съперник</span>
                          <span className="amp-match-view-value">{dayDetailsActiveMatch.opponent || "—"}</span>
                        </div>
                        <div className="amp-match-view-row">
                          <span className="amp-match-view-label">Домакин/Гост</span>
                          <span className={`amp-match-view-badge${dayDetailsActiveMatch.isHome ? " amp-match-view-badge--home" : " amp-match-view-badge--away"}`}>
                            {dayDetailsActiveMatch.isHome ? "Домакин" : "Гост"}
                          </span>
                        </div>
                        <div className="amp-match-view-row">
                          <span className="amp-match-view-label">Час</span>
                          <span className="amp-match-view-value">{dayDetailsActiveMatch.matchTime || "—"}</span>
                        </div>
                        <div className="amp-match-view-row">
                          <span className="amp-match-view-label">Място</span>
                          <span className="amp-match-view-value">{dayDetailsActiveMatch.location || "—"}</span>
                        </div>
                        {dayDetailsActiveMatch.durationMinutes > 0 && (
                          <div className="amp-match-view-row">
                            <span className="amp-match-view-label">Продължителност</span>
                            <span className="amp-match-view-value">{dayDetailsActiveMatch.durationMinutes} мин</span>
                          </div>
                        )}
                      </div>
                      <div className="amp-modal-actions amp-modal-actions--end" style={{ marginTop: "8px" }}>
                        <button
                          type="button"
                          className="amp-btn amp-btn--danger"
                          onClick={() => { setDayDetailsMatchDeleteConfirm(true); setDayDetailsMatchError(""); }}
                        >
                          Изтрий мача
                        </button>
                        <button
                          type="button"
                          className="amp-btn amp-btn--ghost"
                          onClick={() => {
                            setDayDetailsMatchEditForm({
                              opponent: dayDetailsActiveMatch.opponent,
                              location: dayDetailsActiveMatch.location,
                              matchDate: dayDetailsActiveMatch.matchDate,
                              matchTime: dayDetailsActiveMatch.matchTime,
                              durationMinutes: String(dayDetailsActiveMatch.durationMinutes),
                              isHome: dayDetailsActiveMatch.isHome,
                              customGroupId: dayDetailsActiveMatch.customGroupId,
                            });
                            setDayDetailsMatchError("");
                            setDayDetailsMatchEditOpen(true);
                          }}
                        >
                          Редактирай
                        </button>
                      </div>
                    </>
                  );
                })()
              ) : (
                <>
                  <div className="amp-training-stats">
                    <span>Дата: {trainingAttendanceDate ? formatIsoDateForDisplay(trainingAttendanceDate) : "-"}</span>
                    {trainingDayTime && <span>Час: {trainingDayTime}</span>}
                    <span>Общо: {trainingAttendanceStats.total}</span>
                    <span>Присъстващи: {trainingAttendanceStats.attending}</span>
                    <span>Отсъстващи: {trainingAttendanceStats.optedOut}</span>
                    <span>Продължителност: {trainingDayDurationMinutes} мин.</span>
                    {trainingDaySessionCancelled && (
                      <span style={{ color: "#ff6b6b", fontWeight: 700, background: "rgba(255,107,107,0.12)", border: "1px solid rgba(255,107,107,0.35)", borderRadius: 6, padding: "2px 8px" }}>ОТМЕНЕНА</span>
                    )}
                  </div>
                  {(trainingAttendanceLoading || trainingDayDetailsTabLoading) && !trainingDayField && (
                    <div className="amp-edit-field">
                      <span className="amp-lbl">Терен</span>
                      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div className="amp-spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
                      </div>
                    </div>
                  )}
                  {trainingDayField && (() => {
                    const isWholeFieldSelected = trainingDayFieldPieceIds.length === 0;
                    const pieces = trainingDayField.pieces.length > 0
                      ? trainingDayField.pieces
                      : [{ id: "", name: "Цял терен" }];
                    return (
                      <div className="amp-edit-field">
                        <span className="amp-lbl">Терен</span>
                        <div style={{ display: "grid", gap: "6px" }}>
                          <div style={{
                            color: isWholeFieldSelected ? "#32cd32" : "rgba(255,255,255,0.88)",
                            fontWeight: 800,
                            fontSize: "14px",
                            textAlign: "center",
                            textDecoration: isWholeFieldSelected ? "underline" : "none",
                            textUnderlineOffset: "3px",
                            opacity: !isWholeFieldSelected && trainingDayFieldPieceIds.length > 0 ? 0.38 : 1,
                            transition: "opacity 0.15s ease, color 0.15s ease",
                          }}>
                            {trainingDayField.name}
                          </div>
                          <div
                            aria-label={`Терен ${trainingDayField.name}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: `repeat(${pieces.length}, minmax(0, 1fr))`,
                              minHeight: ["boxing", "karate"].includes(trainingDayField.fieldType || "football") ? undefined : "96px",
                              width: ["boxing", "karate"].includes(trainingDayField.fieldType || "football") ? "55%" : "100%",
                              margin: ["boxing", "karate"].includes(trainingDayField.fieldType || "football") ? "0 auto" : undefined,
                              aspectRatio: ["boxing", "karate"].includes(trainingDayField.fieldType || "football") ? "1 / 1" : "2.2 / 1",
                              border: "2px solid rgba(50,205,50,0.8)",
                              borderRadius: "8px",
                              overflow: "hidden",
                              background: getFieldBackground(trainingDayField.fieldType || "football"),
                              boxShadow: "0 0 0 1px rgba(50,205,50,0.6), 0 0 22px rgba(50,205,50,0.28)",
                              position: "relative",
                            }}
                          >
                            {renderFieldMarkings(trainingDayField.fieldType || "football")}
                            {pieces.map((piece, index) => {
                              const isPieceSelected = trainingDayField.pieces.length === 0
                                ? true
                                : trainingDayFieldPieceIds.length === 0 || trainingDayFieldPieceIds.includes(piece.id);
                              return (
                                <div
                                  key={piece.id || `${trainingDayField.id}-whole`}
                                  style={{
                                    minWidth: 0,
                                    borderLeft: index === 0 ? 0 : "1px dashed rgba(255,255,255,0.68)",
                                    background: isPieceSelected ? "rgba(50,205,50,0.18)" : "rgba(0,0,0,0.52)",
                                    boxShadow: isPieceSelected ? "inset 0 0 0 2px #32cd32" : "none",
                                    color: isPieceSelected ? "#32cd32" : "rgba(255,255,255,0.42)",
                                    fontWeight: 800,
                                    fontSize: "13px",
                                    textAlign: "center",
                                    padding: "8px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    position: "relative",
                                    zIndex: 1,
                                    textShadow: "0 1px 2px rgba(0,0,0,0.55)",
                                  }}
                                >
                                  {piece.id ? piece.name : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="amp-edit-field">
                    <span className="amp-lbl">Описание за деня</span>
                    {trainingNote.trim() ? (
                      <p className="amp-val">{trainingNote}</p>
                    ) : (
                      <p className="amp-val" style={{ color: "rgba(255,255,255,0.55)" }}>Няма описание.</p>
                    )}
                  </div>
                  <div className="amp-modal-actions amp-modal-actions--end">
                    <button
                      className="amp-btn amp-btn--ghost"
                      onClick={() => {
                        if (!trainingAttendanceDate) return;
                        setTrainingDayDetailsOpen(false);
                        void openSingleTrainingDayEditForCurrentScope(trainingAttendanceDate);
                      }}
                      disabled={trainingAttendanceLoading || trainingNoteSaving || !trainingAttendanceDate || trainingDayDetailsTabLoading || trainingDayCancelLoading}
                    >
                      Редактирай тренировка
                    </button>
                    {!trainingDaySessionCancelled && (
                      <button
                        className="amp-btn amp-btn--danger"
                        onClick={() => setTrainingDayCancelConfirmOpen(true)}
                        disabled={trainingAttendanceLoading || trainingNoteSaving || !trainingAttendanceDate || trainingDayDetailsTabLoading || trainingDayCancelLoading}
                      >
                        {trainingDayCancelLoading ? "..." : "Отмени тренировка"}
                      </button>
                    )}
                  </div>
                  {trainingDayCancelConfirmOpen && (
                    <div style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.35)", borderRadius: 8, padding: "12px 16px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#ff6b6b" }}>
                        Сигурни ли сте, че искате да отмените тренировката на {trainingAttendanceDate ? formatIsoDateForDisplay(trainingAttendanceDate) : "тази дата"}?
                      </p>
                      <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                        Тренировката ще бъде премахната от графика и не може да бъде възстановена.
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="amp-btn amp-btn--danger"
                          onClick={() => void handleCancelTrainingDay()}
                          disabled={trainingDayCancelLoading}
                        >
                          {trainingDayCancelLoading ? "..." : "Да, отмени"}
                        </button>
                        <button
                          className="amp-btn amp-btn--ghost"
                          onClick={() => setTrainingDayCancelConfirmOpen(false)}
                          disabled={trainingDayCancelLoading}
                        >
                          Назад
                        </button>
                      </div>
                    </div>
                  )}
                  {limitedEvent && !limitedEventLoading && (
                    <p style={{ fontSize: 12, color: "rgba(240,160,48,0.9)", background: "rgba(240,160,48,0.08)", border: "1px solid rgba(240,160,48,0.25)", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>
                      Ограничен режим — всички маркирани като отсъстващи. Маркирайте ръчно кой е присъствал.
                    </p>
                  )}
                  <div className="amp-training-table-wrap">
                    <button
                      type="button"
                      className="amp-training-players-toggle"
                      onClick={() => setTrainingPlayersExpanded((prev) => !prev)}
                      disabled={trainingAttendanceLoading || trainingDayDetailsTabLoading}
                    >
                      <span>Играчи ({trainingAttendanceStats.total})</span>
                      <span className={`amp-training-players-toggle-arrow${trainingPlayersExpanded ? " amp-training-players-toggle-arrow--open" : ""}`}>▾</span>
                    </button>
                    <div className={`amp-training-players-body${trainingPlayersExpanded ? " amp-training-players-body--open" : ""}`}>
                      {trainingAttendanceLoading || trainingDayDetailsTabLoading ? (
                        <p className="amp-empty amp-empty--modal">Зареждане...</p>
                      ) : trainingAttendancePlayers.length === 0 ? (
                        <p className="amp-empty amp-empty--modal">Няма състезатели за този отбор.</p>
                      ) : (
                        <table className="amp-training-table">
                          <thead>
                            <tr>
                              <th>Име</th>
                              <th>Набор</th>
                              <th>Статус</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trainingAttendancePlayers.map((player) => (
                              <tr key={player.id}>
                                <td>{player.fullName}</td>
                                <td>{player.teamGroup ?? "-"}</td>
                                <td>
                                  <span className={player.optedOut ? "amp-training-tag amp-training-tag--out" : "amp-training-tag amp-training-tag--in"}>
                                    {player.optedOut ? "Няма да присъства" : "Ще присъства"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                  {/* ── Limited spots section ── */}
                  {(() => {
                    const activeScopeKey = getScopeKeyFromSessionId(trainingDayDetailsTab);
                    if (!activeScopeKey) return null;
                    return (
                      <div style={{ marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "rgba(255,255,255,0.88)" }}>Ограничени места</span>
                          {!limitedEvent && !limitedEventLoading && !showLimitedForm && (
                            <button
                              type="button"
                              className="amp-btn amp-btn--sm amp-btn--ghost"
                              onClick={() => setShowLimitedForm(true)}
                              disabled={limitedEventSaving}
                            >
                              + Ограничи броя места
                            </button>
                          )}
                        </div>
                        {limitedEventLoading && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Зареждане...</p>}
                        {limitedEventError && <p style={{ fontSize: 13, color: "#ff6b6b", marginBottom: 8 }}>{limitedEventError}</p>}
                        {!limitedEventLoading && limitedEvent && (
                          <div>
                            {(() => {
                              const confirmed = limitedEvent.registrations.filter((r) => r.isConfirmed);
                              const waitlisted = limitedEvent.registrations.filter((r) => !r.isConfirmed);
                              return (
                                <>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "#32cd32", background: "rgba(50,205,50,0.12)", border: "1px solid rgba(50,205,50,0.35)", borderRadius: 6, padding: "3px 10px" }}>
                                      {confirmed.length}/{limitedEvent.maxSpots} записани
                                    </span>
                                    {waitlisted.length > 0 && (
                                      <span style={{ fontSize: 13, fontWeight: 600, color: "#f0a030", background: "rgba(240,160,48,0.12)", border: "1px solid rgba(240,160,48,0.35)", borderRadius: 6, padding: "3px 10px" }}>
                                        {waitlisted.length} в чакалня
                                      </span>
                                    )}
                                    {limitedEvent.spotsRemaining > 0 && (
                                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                                        {limitedEvent.spotsRemaining} свободни
                                      </span>
                                    )}
                                  </div>
                                  {confirmed.length > 0 && (
                                    <ol style={{ margin: "0 0 8px 0", padding: "0 0 0 18px", fontSize: 13, color: "rgba(255,255,255,0.78)" }}>
                                      {confirmed.map((r) => (
                                        <li key={r.playerId} style={{ marginBottom: 3 }}>
                                          {r.fullName} <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                                            {new Date(r.registeredAt).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" })}
                                          </span>
                                        </li>
                                      ))}
                                    </ol>
                                  )}
                                  {waitlisted.length > 0 && (
                                    <>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: "#f0a030", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Чакалня</div>
                                      <ol start={limitedEvent.maxSpots + 1} style={{ margin: "0 0 12px 0", padding: "0 0 0 18px", fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                                        {waitlisted.map((r) => (
                                          <li key={r.playerId} style={{ marginBottom: 3 }}>
                                            {r.fullName} <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>
                                              {new Date(r.registeredAt).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                          </li>
                                        ))}
                                      </ol>
                                    </>
                                  )}
                                </>
                              );
                            })()}
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="number"
                                min={1}
                                max={200}
                                value={limitedSpotsInput}
                                onChange={(e) => setLimitedSpotsInput(e.target.value)}
                                style={{ width: 70, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 13 }}
                                disabled={limitedEventSaving}
                              />
                              <button
                                type="button"
                                className="amp-btn amp-btn--sm amp-btn--primary"
                                disabled={limitedEventSaving}
                                onClick={async () => {
                                  if (!clubId || !limitedEvent) return;
                                  const maxSpots = parseInt(limitedSpotsInput, 10);
                                  if (!Number.isInteger(maxSpots) || maxSpots < 1 || maxSpots > 200) {
                                    setLimitedEventError("Броят места трябва да е между 1 и 200.");
                                    return;
                                  }
                                  setLimitedEventSaving(true);
                                  setLimitedEventError("");
                                  try {
                                    const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events/${encodeURIComponent(limitedEvent.id)}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ maxSpots }),
                                    });
                                    if (!res.ok) {
                                      const d = await res.json().catch(() => ({})) as { error?: string };
                                      setLimitedEventError(typeof d.error === "string" ? d.error : "Грешка при запазване.");
                                      return;
                                    }
                                    await fetchLimitedEventForSession(trainingAttendanceDate ?? "", trainingDayDetailsTab);
                                  } catch {
                                    setLimitedEventError("Грешка при запазване.");
                                  } finally {
                                    setLimitedEventSaving(false);
                                  }
                                }}
                              >
                                Промени места
                              </button>
                              <button
                                type="button"
                                className="amp-btn amp-btn--sm amp-btn--danger"
                                disabled={limitedEventSaving}
                                onClick={async () => {
                                  if (!clubId || !limitedEvent) return;
                                  setLimitedEventSaving(true);
                                  setLimitedEventError("");
                                  try {
                                    const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events/${encodeURIComponent(limitedEvent.id)}`, {
                                      method: "DELETE",
                                    });
                                    if (!res.ok) {
                                      const d = await res.json().catch(() => ({})) as { error?: string };
                                      setLimitedEventError(typeof d.error === "string" ? d.error : "Грешка при изтриване.");
                                      return;
                                    }
                                    setLimitedEvent(null);
                                    setLimitedSpotsInput("10");
                                  } catch {
                                    setLimitedEventError("Грешка при изтриване.");
                                  } finally {
                                    setLimitedEventSaving(false);
                                  }
                                }}
                              >
                                Деактивирай
                              </button>
                            </div>
                          </div>
                        )}
                        {!limitedEventLoading && !limitedEvent && showLimitedForm && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="number"
                              min={1}
                              max={200}
                              value={limitedSpotsInput}
                              onChange={(e) => setLimitedSpotsInput(e.target.value)}
                              placeholder="Брой места"
                              style={{ width: 100, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 13 }}
                              disabled={limitedEventSaving}
                            />
                            <button
                              type="button"
                              className="amp-btn amp-btn--sm amp-btn--primary"
                              disabled={limitedEventSaving}
                              onClick={async () => {
                                if (!clubId || !trainingAttendanceDate) return;
                                const maxSpots = parseInt(limitedSpotsInput, 10);
                                if (!Number.isInteger(maxSpots) || maxSpots < 1 || maxSpots > 200) {
                                  setLimitedEventError("Броят места трябва да е между 1 и 200.");
                                  return;
                                }
                                const scopeKey = getScopeKeyFromSessionId(trainingDayDetailsTab);
                                if (!scopeKey) return;
                                const teamGroupMatch = scopeKey.match(/^team_group:(\d+)$/);
                                const teamGroup = teamGroupMatch ? parseInt(teamGroupMatch[1], 10) : null;
                                const customGroupMatch = scopeKey.match(/^custom_group:(.+)$/);
                                const scopeId = customGroupMatch ? customGroupMatch[1] : null;
                                setLimitedEventSaving(true);
                                setLimitedEventError("");
                                try {
                                  const res = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/limited-training-events`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ scopeKey, scopeId, teamGroup, trainingDate: trainingAttendanceDate, maxSpots }),
                                  });
                                  if (!res.ok) {
                                    const d = await res.json().catch(() => ({})) as { error?: string };
                                    setLimitedEventError(typeof d.error === "string" ? d.error : "Грешка при създаване.");
                                    return;
                                  }
                                  setShowLimitedForm(false);
                                  await fetchLimitedEventForSession(trainingAttendanceDate, trainingDayDetailsTab);
                                } catch {
                                  setLimitedEventError("Грешка при създаване.");
                                } finally {
                                  setLimitedEventSaving(false);
                                }
                              }}
                            >
                              Запази
                            </button>
                            <button
                              type="button"
                              className="amp-btn amp-btn--sm amp-btn--ghost"
                              onClick={() => { setShowLimitedForm(false); setLimitedEventError(""); }}
                              disabled={limitedEventSaving}
                            >
                              Отказ
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>}
          </div>
        </div>
      )}
      {trainingBulkNoteOpen && (
        <div className="amp-overlay amp-overlay--confirm" onClick={() => setTrainingBulkNoteOpen(false)}>
          <div className="amp-modal amp-modal--confirm amp-modal--training-note" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Добави описание</span>
              <button
                className="amp-modal-close"
                onClick={() => setTrainingBulkNoteOpen(false)}
                aria-label="Затвори"
                disabled={trainingNoteSaving}
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body" style={{ position: "relative" }}>
              {trainingNoteSaving && (
                <div className="amp-modal-loading-overlay" style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(16,16,20,0.9)" }}>
                  <div className="amp-loading" style={{ minHeight: 200 }}>
                    <div className="amp-spinner" />
                    <p style={{ marginTop: 16, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>Запазване...</p>
                  </div>
                </div>
              )}
              <label className="amp-edit-field">
                <span className="amp-lbl">Избери дни</span>
                <div className="amp-training-calendar amp-training-calendar--attendance">
                  {trainingAttendanceCalendarMonths.map((month) => (
                    <div key={month.key} className="amp-training-month">
                      <div className="amp-training-month-title">{month.label}</div>
                      <div className="amp-training-weekdays-row">
                        {TRAINING_WEEKDAY_SHORT_BG.map((weekday) => (
                          <span key={`${month.key}-${weekday}`} className="amp-training-weekday-cell">
                            {weekday}
                          </span>
                        ))}
                      </div>
                      <div className="amp-training-month-grid">
                        {month.cells.map((date, index) => {
                          if (!date) {
                            return (
                              <span
                                key={`${month.key}-empty-${index}`}
                                className="amp-training-calendar-cell amp-training-calendar-cell--empty"
                                aria-hidden="true"
                              />
                            );
                          }
                          const dayNumber = Number.parseInt(date.slice(8, 10), 10);
                          const dateData = trainingUpcomingByDate.get(date);
                          const matchesForDate = trainingAttendanceMatchesByDate.get(date) ?? [];
                          const hasMatch = matchesForDate.length > 0;
                          if ((!dateData || !trainingUpcomingDateSet.has(date)) && !hasMatch) {
                            return (
                              <span
                                key={date}
                                className="amp-training-calendar-cell amp-training-calendar-cell--disabled"
                                aria-hidden="true"
                              >
                                <span className="amp-training-day-number">{dayNumber}</span>
                              </span>
                            );
                          }
                          if (!dateData && hasMatch) {
                            return (
                              <span
                                key={date}
                                className="amp-training-date-btn amp-training-date-btn--calendar-match-only"
                                aria-label={`Мач на ${formatIsoDateForDisplay(date)}`}
                              >
                                <span className="amp-training-day-number">{dayNumber}</span>
                                {matchesForDate[0]?.matchTime && (
                                  <span className="amp-training-day-match">{matchesForDate[0].matchTime}</span>
                                )}
                                <span className="amp-training-day-match amp-training-day-match--location">{matchesForDate[0]?.isHome ? "Д" : "Г"}</span>
                              </span>
                            );
                          }

                          const isSelected = trainingNoteTargetDates.includes(date);
                          const isToday = todayIsoDate === date;
                          const trainingTimeLabel = dateData!.trainingTime?.trim() ?? "";
                          const hasTrainingAndMatch = hasMatch;
                          return (
                            <button
                              key={date}
                              type="button"
                              className={`amp-training-date-btn amp-training-date-btn--training${hasTrainingAndMatch ? " amp-training-date-btn--training-match" : ""}${isSelected ? " amp-training-date-btn--selected" : ""}${isToday ? " amp-training-date-btn--today" : ""}`}
                              onClick={() => toggleTrainingNoteTargetDate(date)}
                              disabled={trainingNoteSaving}
                            >
                              <span className="amp-training-day-number">{dayNumber}</span>
                              {hasTrainingAndMatch && matchesForDate[0]?.matchTime && (
                                <span className="amp-training-day-match">{matchesForDate[0].matchTime}</span>
                              )}
                              {hasTrainingAndMatch && (
                                <span className="amp-training-day-match amp-training-day-match--location">{matchesForDate[0]?.isHome ? "Д" : "Г"}</span>
                              )}
                              {!hasTrainingAndMatch && trainingTimeLabel && (
                                <span className="amp-training-day-time">{trainingTimeLabel}</span>
                              )}
                              {!hasTrainingAndMatch && (
                                <span className="amp-training-day-meta">
                                  {dateData!.stats.attending}/{dateData!.stats.total}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </label>
              <label className="amp-edit-field">
                <span className="amp-lbl">Описание</span>
                <textarea
                  className="amp-edit-input amp-training-note"
                  value={trainingNote}
                  onChange={(e) => setTrainingNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Добавете инструкции, сборен час, локация..."
                  disabled={trainingNoteSaving}
                />
              </label>
              {trainingAttendanceError && <p className="amp-confirm-error">{trainingAttendanceError}</p>}
              {isTrainingNoteSameAsExisting && !trainingAttendanceError && (
                <p className="amp-confirm-error">Описанието е същото като предишното за избраната дата.</p>
              )}
              <div className="amp-modal-actions">
                <button
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setTrainingBulkNoteOpen(false)}
                  disabled={trainingNoteSaving}
                >
                  Отказ
                </button>
                <button
                  className="amp-btn amp-btn--primary"
                  onClick={() => void saveTrainingNote()}
                  disabled={
                    trainingNoteSaving ||
                    trainingNoteComparisonLoading ||
                    effectiveTrainingNoteTargetDates.length === 0 ||
                    isTrainingNoteSameAsExisting
                  }
                >
                  {trainingNoteSaving
                    ? "Запазване..."
                    : `Запази описание за ${effectiveTrainingNoteTargetDates.length} ден(дни)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {inactivePlayersOpen && canViewInactiveMembers && canManageMemberActions && (
        <InactivePlayersModal
          members={inactiveMembers}
          isReactivating={Boolean(reactivatingMemberId)}
          reactivatingMemberId={reactivatingMemberId}
          isDeletingPermanent={Boolean(deletingPermanentMemberId)}
          deletingPermanentMemberId={deletingPermanentMemberId}
          error={inactiveActionError}
          onClose={() => {
            if (reactivatingMemberId || deletingPermanentMemberId || memberToPermanentDelete) return;
            setInactivePlayersOpen(false);
            setInactiveActionError("");
          }}
          onSelectMember={(member) => {
            if (reactivatingMemberId || deletingPermanentMemberId || memberToPermanentDelete) return;
            setInactivePlayersOpen(false);
            setSelectedMember(member);
          }}
          onReactivate={handleReactivateMember}
          onPermanentDelete={(member) => {
            if (reactivatingMemberId || deletingPermanentMemberId) return;
            setInactiveActionError("");
            setMemberToPermanentDelete(member);
          }}
        />
      )}
      {memberToPermanentDelete && (
        <ConfirmPermanentDeleteModal
          member={memberToPermanentDelete}
          isDeleting={Boolean(deletingPermanentMemberId)}
          onCancel={() => {
            if (!deletingPermanentMemberId) {
              setMemberToPermanentDelete(null);
            }
          }}
          onConfirm={handlePermanentDeleteMember}
        />
      )}
      {schedulerSettingsOpen && (
        <div
          className="amp-overlay"
          onClick={() => {
            if (!schedulerSettingsSaving) {
              setSchedulerSettingsOpen(false);
            }
          }}
        >
          <div className="amp-modal amp-modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient" style={{ flex: 1, textAlign: "center", paddingLeft: "32px" }}>Месечно напомняне</span>
              <button
                className="amp-modal-close"
                onClick={() => setSchedulerSettingsOpen(false)}
                aria-label="Затвори"
                disabled={schedulerSettingsSaving}
              >
                <XIcon />
              </button>
            </h2>

            <div className="amp-modal-body">
              {schedulerSettingsLoading ? (
                <p className="amp-empty amp-empty--modal">Зареждане...</p>
              ) : (
                <div className="amp-edit-grid">
                  <label className="amp-edit-field amp-scheduler-primary-day" style={{ textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>Ден месечно напомняне (1-28)</span>
                    <input
                      className="amp-edit-input"
                      style={{ textAlign: "center" }}
                      inputMode="numeric"
                      value={schedulerForm.reminderDay}
                      onChange={(e) =>
                        setSchedulerForm((prev) => ({
                          ...prev,
                          reminderDay: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      disabled={schedulerSettingsSaving}
                    />
                  </label>
                  <label className="amp-edit-field amp-scheduler-overdue-day" style={{ textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>Ден за начало на платежния месец</span>
                    <input
                      className="amp-edit-input"
                      style={{ textAlign: "center" }}
                      inputMode="numeric"
                      value={schedulerForm.overdueDay}
                      onChange={(e) =>
                        setSchedulerForm((prev) => ({
                          ...prev,
                          overdueDay: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      disabled={schedulerSettingsSaving}
                    />
                  </label>
                  <label className="amp-edit-field amp-scheduler-primary-time" style={{ textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>Час за месечно напомняне</span>
                    <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                      <input
                        className="amp-inner-time-input"
                        type="time"
                        step={60}
                        value={reminderTimeValue}
                        onChange={(e) => {
                          const [hour = "0", minute = "0"] = e.target.value.split(":");
                          setSchedulerForm((prev) => ({
                            ...prev,
                            reminderHour: hour.replace(/\D/g, ""),
                            reminderMinute: minute.replace(/\D/g, ""),
                          }));
                        }}
                        disabled={schedulerSettingsSaving}
                      />
                    </div>
                  </label>
                  <div className="amp-edit-field amp-edit-field--full amp-scheduler-section-title amp-scheduler-section-title--second" style={{ textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>Второ напомняне (по избор)</span>
                  </div>
                  {!secondReminderEnabled ? (
                    <div className="amp-edit-field amp-edit-field--full amp-scheduler-second-toggle" style={{ textAlign: "center" }}>
                      <span className="amp-lbl" style={{ textAlign: "center" }}>Второ месечно напомняне</span>
                      <button
                        className="amp-btn amp-btn--ghost amp-btn--compact"
                        style={{ width: "100%", justifyContent: "center" }}
                        type="button"
                        onClick={enableSecondReminder}
                        disabled={schedulerSettingsSaving}
                      >
                        Добави второ напомняне
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="amp-edit-field amp-scheduler-second-day" style={{ textAlign: "center" }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Ден второ месечно напомняне (1-28)</span>
                        <input
                          className="amp-edit-input"
                          style={{ textAlign: "center" }}
                          inputMode="numeric"
                          value={schedulerForm.secondReminderDay}
                          onChange={(e) =>
                            setSchedulerForm((prev) => ({
                              ...prev,
                              secondReminderDay: e.target.value.replace(/\D/g, ""),
                            }))
                          }
                          disabled={schedulerSettingsSaving}
                        />
                      </label>
                      <label className="amp-edit-field amp-scheduler-second-time" style={{ textAlign: "center" }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Час за второ месечно напомняне</span>
                        <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                          <input
                            className="amp-inner-time-input"
                            type="time"
                            step={60}
                            value={secondReminderTimeValue}
                            onChange={(e) => {
                              const [hour = "0", minute = "0"] = e.target.value.split(":");
                              setSchedulerForm((prev) => ({
                                ...prev,
                                secondReminderHour: hour.replace(/\D/g, ""),
                                secondReminderMinute: minute.replace(/\D/g, ""),
                              }));
                            }}
                            disabled={schedulerSettingsSaving}
                          />
                        </div>
                      </label>
                      <div className="amp-edit-field amp-edit-field--full amp-scheduler-second-remove" style={{ textAlign: "center" }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Опция</span>
                        <button
                          className="amp-btn amp-btn--ghost amp-btn--compact"
                          style={{ width: "100%", justifyContent: "center" }}
                          type="button"
                          onClick={disableSecondReminder}
                          disabled={schedulerSettingsSaving}
                        >
                          Премахни второто напомняне
                        </button>
                      </div>
                    </>
                  )}
                  {secondReminderEnabled && (
                    <>
                      <div className="amp-edit-field amp-edit-field--full amp-scheduler-section-title amp-scheduler-section-title--third" style={{ textAlign: "center" }}>
                        <span className="amp-lbl" style={{ textAlign: "center" }}>Трето напомняне (по избор)</span>
                      </div>
                      {!thirdReminderEnabled ? (
                        <div className="amp-edit-field amp-edit-field--full amp-scheduler-third-toggle" style={{ textAlign: "center" }}>
                          <span className="amp-lbl" style={{ textAlign: "center" }}>Трето месечно напомняне</span>
                          <button
                            className="amp-btn amp-btn--ghost amp-btn--compact"
                            style={{ width: "100%", justifyContent: "center" }}
                            type="button"
                            onClick={enableThirdReminder}
                            disabled={schedulerSettingsSaving}
                          >
                            Добави трето напомняне
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className="amp-edit-field amp-scheduler-third-day" style={{ textAlign: "center" }}>
                            <span className="amp-lbl" style={{ textAlign: "center" }}>Ден трето месечно напомняне (1-28)</span>
                            <input
                              className="amp-edit-input"
                              style={{ textAlign: "center" }}
                              inputMode="numeric"
                              value={schedulerForm.thirdReminderDay}
                              onChange={(e) =>
                                setSchedulerForm((prev) => ({
                                  ...prev,
                                  thirdReminderDay: e.target.value.replace(/\D/g, ""),
                                }))
                              }
                              disabled={schedulerSettingsSaving}
                            />
                          </label>
                          <label className="amp-edit-field amp-scheduler-third-time" style={{ textAlign: "center" }}>
                            <span className="amp-lbl" style={{ textAlign: "center" }}>Час за трето месечно напомняне</span>
                            <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                              <input
                                className="amp-inner-time-input"
                                type="time"
                                step={60}
                                value={thirdReminderTimeValue}
                                onChange={(e) => {
                                  const [hour = "0", minute = "0"] = e.target.value.split(":");
                                  setSchedulerForm((prev) => ({
                                    ...prev,
                                    thirdReminderHour: hour.replace(/\D/g, ""),
                                    thirdReminderMinute: minute.replace(/\D/g, ""),
                                  }));
                                }}
                                disabled={schedulerSettingsSaving}
                              />
                            </div>
                          </label>
                          <div className="amp-edit-field amp-edit-field--full amp-scheduler-third-remove" style={{ textAlign: "center" }}>
                            <span className="amp-lbl" style={{ textAlign: "center" }}>Опция</span>
                            <button
                              className="amp-btn amp-btn--ghost amp-btn--compact"
                              style={{ width: "100%", justifyContent: "center" }}
                              type="button"
                              onClick={disableThirdReminder}
                              disabled={schedulerSettingsSaving}
                            >
                              Премахни третото напомняне
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  <div className="amp-edit-field amp-edit-field--full amp-scheduler-section-title amp-scheduler-section-title--overdue" style={{ textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>Просрочие</span>
                  </div>
                  <label className="amp-edit-field amp-scheduler-overdue-time" style={{ textAlign: "center" }}>
                    <span className="amp-lbl" style={{ textAlign: "center" }}>Час за просрочие</span>
                    <div className="amp-edit-input" style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 0 }}>
                      <input
                        className="amp-inner-time-input"
                        type="time"
                        step={60}
                        value={overdueTimeValue}
                        onChange={(e) => {
                          const [hour = "0", minute = "0"] = e.target.value.split(":");
                          setSchedulerForm((prev) => ({
                            ...prev,
                            overdueHour: hour.replace(/\D/g, ""),
                            overdueMinute: minute.replace(/\D/g, ""),
                          }));
                        }}
                        disabled={schedulerSettingsSaving}
                      />
                    </div>
                  </label>
                </div>
              )}

              {schedulerSettingsError && <p className="amp-confirm-error" style={{ textAlign: "center" }}>{schedulerSettingsError}</p>}

              <div className="amp-modal-actions" style={{ justifyContent: "center" }}>
                <button
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setSchedulerSettingsOpen(false)}
                  disabled={schedulerSettingsSaving}
                >
                  Отказ
                </button>
                <button
                  className="amp-btn amp-btn--primary"
                  onClick={() => void saveSchedulerSettings()}
                  disabled={
                    schedulerSettingsSaving ||
                    schedulerSettingsLoading
                  }
                >
                  {schedulerSettingsSaving ? "Запазване..." : "Запази"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importSheetsOpen && clubId && (
        <ImportFromSheetsModal
          clubId={clubId}
          coachGroupId={coachGroupId || undefined}
          onClose={() => setImportSheetsOpen(false)}
          onImported={() => void refreshMembersList()}
        />
      )}

      {importPhotosOpen && clubId && (
        <ImportPhotosFromDriveModal
          clubId={clubId}
          onClose={() => setImportPhotosOpen(false)}
          onImported={() => void refreshMembersList()}
        />
      )}

      {bulkCoachGroupTargetId && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => { if (!bulkCoachGroupBusy) setBulkCoachGroupTargetId(null); }}
        >
          <div
            className="amp-modal amp-modal--confirm amp-modal--notify"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">
                {coachGroups.find((g) => g.id === bulkCoachGroupTargetId)?.name ?? "Управление на група"}
              </span>
              <button
                className="amp-modal-close"
                onClick={() => setBulkCoachGroupTargetId(null)}
                disabled={bulkCoachGroupBusy}
                aria-label="Затвори"
                type="button"
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              <label className="amp-edit-field" style={{ marginBottom: "12px" }}>
                <span className="amp-lbl">Търсене</span>
                <input
                  className="amp-edit-input"
                  type="search"
                  placeholder="Търси по име..."
                  value={bulkCoachGroupSearchTerm}
                  onChange={(e) => setBulkCoachGroupSearchTerm(e.target.value)}
                  disabled={bulkCoachGroupBusy}
                />
              </label>
              <div className="amp-notify-count" style={{ marginBottom: "8px" }}>
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost amp-btn--compact"
                  style={{ marginRight: "8px" }}
                  disabled={bulkCoachGroupBusy || bulkCoachGroupLoadingMembers || bulkCoachGroupVisibleMembers.length === 0}
                  onClick={() => setBulkCoachGroupSelectedIds(new Set(bulkCoachGroupVisibleMembers.map((m) => m.id)))}
                >
                  Избери всички видими ({bulkCoachGroupVisibleMembers.length})
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost amp-btn--compact"
                  disabled={bulkCoachGroupBusy || bulkCoachGroupLoadingMembers || bulkCoachGroupSelectedIds.size === 0}
                  onClick={() => setBulkCoachGroupSelectedIds(new Set())}
                >
                  Изчисти
                </button>
              </div>
              <div className="amp-notify-player-list">
                {bulkCoachGroupLoadingMembers ? (
                  <p style={{ padding: "12px", fontSize: "13px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
                    Зареждане...
                  </p>
                ) : bulkCoachGroupVisibleMembers.length === 0 ? (
                  <p style={{ padding: "12px", fontSize: "13px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
                    Няма състезатели
                  </p>
                ) : (
                  bulkCoachGroupVisibleMembers.map((m) => {
                    const isSelected = bulkCoachGroupSelectedIds.has(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`amp-notify-player-item${isSelected ? " amp-notify-player-item--selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={bulkCoachGroupBusy}
                          onChange={(e) => {
                            setBulkCoachGroupSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(m.id);
                              else next.delete(m.id);
                              return next;
                            });
                          }}
                        />
                        <span className="amp-notify-player-name">{m.fullName}</span>
                        {m.teamGroup !== null && (
                          <span className="amp-notify-player-group">{m.teamGroup}</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              {bulkCoachGroupError && (
                <p className="amp-confirm-error" style={{ marginTop: "8px" }}>{bulkCoachGroupError}</p>
              )}
              <div className="amp-modal-actions" style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setBulkCoachGroupTargetId(null)}
                  disabled={bulkCoachGroupBusy}
                >
                  Затвори
                </button>
                <button
                  type="button"
                  className={`amp-btn amp-btn--primary${bulkCoachGroupSaved ? " amp-btn--saved" : ""}`}
                  disabled={bulkCoachGroupBusy || bulkCoachGroupSaved}
                  onClick={() => void handleBulkCoachGroupSave()}
                >
                  {bulkCoachGroupBusy ? "Запазване..." : bulkCoachGroupSaved ? "✓ Записано" : `Запази (${bulkCoachGroupSelectedIds.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {coachMessageOpen && (isAdmin || isCoach) && clubId && (
        <CoachMessageModal
          clubId={clubId}
          groups={coachGroups}
          onClose={() => setCoachMessageOpen(false)}
        />
      )}
      {notifyPanelOpen && !coachMessageOpen && (
        <div
          className="amp-overlay amp-overlay--confirm"
          onClick={() => { if (!notifyBusy) setNotifyPanelOpen(false); }}
        >
          <div
            className="amp-modal amp-modal--confirm amp-modal--notify"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="amp-modal-tint" aria-hidden="true" />
            <h2 className="amp-modal-title">
              <span className="amp-modal-title-gradient">Изпрати съобщение</span>
              <button
                className="amp-modal-close"
                onClick={() => setNotifyPanelOpen(false)}
                disabled={notifyBusy}
                aria-label="Затвори"
                type="button"
              >
                <XIcon />
              </button>
            </h2>
            <div className="amp-modal-body">
              {(isAdmin || isCoach) && clubId && (
                <button
                  className="amp-btn amp-btn--ghost amp-btn--compact"
                  type="button"
                  disabled={notifyBusy}
                  style={{ marginBottom: 16 }}
                  onClick={async () => { await loadCoachGroups(); setCoachMessageOpen(true); }}
                >
                  <BellIcon />
                  <span>Изпрати до треньори</span>
                </button>
              )}
              {(isAdmin || isCoach) && !coachGroupId && coachGroups.length > 0 && (
                <label className="amp-edit-field" style={{ marginBottom: "12px" }}>
                  <span className="amp-lbl">Група треньор</span>
                  <select
                    className="amp-edit-input"
                    value={notifyCoachGroupFilter}
                    onChange={(e) => {
                      setNotifyCoachGroupFilter(e.target.value);
                      setNotifySelectedIds(new Set());
                    }}
                    disabled={notifyBusy}
                  >
                    <option value="">Всички</option>
                    {coachGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {groupOptions.length > 0 && (
                <label className="amp-edit-field" style={{ marginBottom: "12px" }}>
                  <span className="amp-lbl">Отбор / група</span>
                  <select
                    className="amp-edit-input"
                    value={notifyGroupFilter}
                    onChange={(e) => {
                      setNotifyGroupFilter(e.target.value);
                      setNotifySelectedIds(new Set());
                    }}
                    disabled={notifyBusy}
                  >
                    <option value="all">Всички</option>
                    {isCustomTrainingGroupMode
                      ? customTrainingGroups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))
                      : (
                        <>
                          {trainingScheduleGroups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                          {groupOptions.map((g) => (
                            <option key={g} value={String(g)}>{g}</option>
                          ))}
                        </>
                      )}
                  </select>
                </label>
              )}
              <label className="amp-edit-field" style={{ marginBottom: "12px" }}>
                <span className="amp-lbl">Търсене</span>
                <input
                  className="amp-edit-input"
                  type="search"
                  placeholder="Търси по име..."
                  value={notifySearchTerm}
                  onChange={(e) => setNotifySearchTerm(e.target.value)}
                  disabled={notifyBusy}
                />
              </label>
              <div className="amp-notify-count" style={{ marginBottom: "8px" }}>
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost amp-btn--compact"
                  style={{ marginRight: "8px" }}
                  disabled={notifyBusy || notifyVisibleMembers.length === 0}
                  onClick={() => setNotifySelectedIds(new Set(notifyVisibleMembers.map((m) => m.id)))}
                >
                  Избери всички видими ({notifyVisibleMembers.length})
                </button>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)" }}>
                  Избрани: {notifySelectedIds.size} от {notifyVisibleMembers.length} видими
                </span>
              </div>
              <div className="amp-notify-player-list">
                {notifyVisibleMembers.length === 0 ? (
                  <p style={{ padding: "12px", fontSize: "13px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
                    Няма състезатели
                  </p>
                ) : (
                  notifyVisibleMembers.map((m) => (
                    <label
                      key={m.id}
                      className={`amp-notify-player-item${notifySelectedIds.has(m.id) ? " amp-notify-player-item--selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={notifySelectedIds.has(m.id)}
                        disabled={notifyBusy}
                        onChange={(e) => {
                          setNotifySelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m.id);
                            else next.delete(m.id);
                            return next;
                          });
                        }}
                      />
                      <span className="amp-notify-player-name">{m.fullName}</span>
                      {m.teamGroup !== null && (
                        <span className="amp-notify-player-group">{m.teamGroup}</span>
                      )}
                    </label>
                  ))
                )}
              </div>
              <label className="amp-edit-field" style={{ marginTop: "16px" }}>
                <span className="amp-lbl">Съобщение</span>
                <textarea
                  className="amp-edit-input amp-notify-textarea"
                  placeholder="Въведете съобщение..."
                  value={notifyMessage}
                  rows={4}
                  onChange={(e) => setNotifyMessage(e.target.value)}
                  disabled={notifyBusy}
                  style={{ height: "auto", resize: "vertical", padding: "8px 10px" }}
                />
              </label>
              {notifyError && (
                <p className="amp-confirm-error" style={{ marginTop: "8px" }}>{notifyError}</p>
              )}
              {notifySuccess && (
                <p style={{ color: "#9cff9c", fontSize: "13px", fontWeight: 600, marginTop: "8px" }}>{notifySuccess}</p>
              )}
              <div className="amp-modal-actions" style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  className="amp-btn amp-btn--ghost"
                  onClick={() => setNotifyPanelOpen(false)}
                  disabled={notifyBusy}
                >
                  Затвори
                </button>
                <button
                  type="button"
                  className="amp-btn amp-btn--primary"
                  disabled={notifyBusy || notifySelectedIds.size === 0 || !notifyMessage.trim()}
                  onClick={() => void handleSendNotify()}
                >
                  {notifyBusy ? "Изпращане..." : `Изпрати до ${notifySelectedIds.size}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {guideOpen && (
        <div className="amp-overlay" onClick={() => setGuideOpen(false)}>
          <div className="amp-modal amp-modal--guide" onClick={(e) => e.stopPropagation()}>
            <div className="amp-modal-tint" aria-hidden="true" />
            <div className="amp-guide-sidebar">
              <div className="amp-guide-sidebar-title">Наръчник</div>
              {guideSteps.map((step, idx) => (
                <button
                  key={step.id}
                  className={`amp-guide-sidebar-item${idx === guideStep ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => { setGuideStep(idx); setGuideImgExpanded(false); }}
                >
                  <span className="amp-guide-sidebar-num">{idx + 1}</span>
                  <span className="amp-guide-sidebar-name">{step.title}</span>
                </button>
              ))}
            </div>
            <div className="amp-guide-content">
              <div className="amp-guide-content-header">
                <span className="amp-guide-step-counter">{guideStep + 1} / {guideSteps.length}</span>
                <button className="amp-modal-close" onClick={() => setGuideOpen(false)} aria-label="Затвори">
                  <XIcon />
                </button>
              </div>
              <div className="amp-guide-content-scroll">
                <div
                  key={guideSteps[guideStep]?.id}
                  className="amp-guide-step-img-wrap"
                  style={{ display: 'none' }}
                >
                  <img
                    src={'/guide/' + (guideSteps[guideStep]?.id ?? '') + '.png'}
                    alt=""
                    className="amp-guide-step-img"
                    onLoad={(e) => { if (e.currentTarget.parentElement) (e.currentTarget.parentElement as HTMLElement).style.display = 'flex'; }}
                    onError={(e) => { if (e.currentTarget.parentElement) (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                    onClick={() => setGuideImgExpanded(true)}
                  />
                  <span className="amp-guide-step-img-hint">🔍 Кликни за цял екран</span>
                </div>
                {guideImgExpanded && (
                  <div
                    className="amp-guide-lightbox"
                    onClick={() => { if (guideImgScale <= 1) setGuideImgExpanded(false); }}
                  >
                    <img
                      src={'/guide/' + (guideSteps[guideStep]?.id ?? '') + '.png'}
                      alt=""
                      className="amp-guide-lightbox-img"
                      style={{ transform: `scale(${guideImgScale}) translate(${guideImgPos.x / guideImgScale}px, ${guideImgPos.y / guideImgScale}px)` }}
                      onTouchStart={handleGuideImgTouchStart}
                      onTouchMove={handleGuideImgTouchMove}
                      onTouchEnd={handleGuideImgTouchEnd}
                      onClick={(e) => { e.stopPropagation(); if (guideImgScale > 1) { setGuideImgScale(1); setGuideImgPos({ x: 0, y: 0 }); } else { setGuideImgExpanded(false); } }}
                    />
                    {guideImgScale <= 1 && (
                      <span className="amp-guide-lightbox-hint">Щипни за увеличение · Натисни за затваряне</span>
                    )}
                  </div>
                )}
                <div className="amp-guide-step-body">
                  <div
                    className="amp-guide-step-icon-wrap"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (guideSteps[guideStep]?.icon ?? '') + '</svg>'
                    }}
                  />
                  <div>
                    <h3 className="amp-guide-step-title">{guideSteps[guideStep]?.title}</h3>
                    <p className="amp-guide-step-desc">{guideSteps[guideStep]?.description}</p>
                  </div>
                </div>
              </div>
              <div className="amp-guide-nav">
                <button
                  className="amp-btn amp-btn--ghost amp-btn--compact"
                  type="button"
                  onClick={() => { setGuideStep((s) => Math.max(0, s - 1)); setGuideImgExpanded(false); }}
                  disabled={guideStep === 0}
                >
                  ← Назад
                </button>
                {guideStep === guideSteps.length - 1 ? (
                  <button
                    className="amp-btn amp-btn--primary amp-btn--compact"
                    type="button"
                    onClick={() => setGuideOpen(false)}
                  >
                    Готово ✓
                  </button>
                ) : (
                  <button
                    className="amp-btn amp-btn--primary amp-btn--compact"
                    type="button"
                    onClick={() => { setGuideStep((s) => s + 1); setGuideImgExpanded(false); }}
                  >
                    Напред →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function AdminMembersPage() {
  return (
    <Suspense fallback={<main className="amp-page" />}>
      <AdminMembersPageContent />
    </Suspense>
  );
}
