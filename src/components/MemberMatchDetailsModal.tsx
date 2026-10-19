"use client";
import { matchCategoryLabel } from "@/lib/matchCategory";

import { X as XIcon } from "lucide-react";
import { matchEventTypeLabel } from "@/lib/matchEventType";
import MatchAttendanceControl from "@/components/MatchAttendanceControl";

export interface MemberMatchDetails {
  description?: string;
  category?: string | null;
  eventType?: string;
  attendanceEnabled: boolean;
  present: boolean;
  reasonCode: string | null;
  reasonText: string | null;
  id: string;
  opponent: string;
  location: string;
  matchDate: string;
  matchTime: string;
  isHome: boolean;
  durationMinutes: number | null;
  teamGroups: number[];
}

type Props = {
  match: MemberMatchDetails;
  matches: MemberMatchDetails[];
  cardCode: string;
  onSelect: (match: MemberMatchDetails) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

export default function MemberMatchDetailsModal({ match, matches, cardCode, onSelect, onClose, onSaved }: Props) {
  return (
    <div
      className="pm-overlay"
      onClick={onClose}
    >
      <div className="pm-modal member-match-details-popup" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pm-close" aria-label="Затвори" onClick={onClose}>
          <XIcon size={16} />
        </button>
        <div className="pm-header">
          <h2 className="pm-title">{matchEventTypeLabel(match.eventType)}</h2>
        </div>
        {matches.length > 1 && <nav className="member-match-day-selector" aria-label="Събития за деня">
          {matches.map((item) => <button
            key={item.id}
            type="button"
            className={`member-day-tab member-day-tab--match${item.id === match.id ? " member-day-tab--active" : ""}`}
            aria-pressed={item.id === match.id}
            aria-label={`${matchEventTypeLabel(item.eventType)} · ${item.matchTime} · ${item.opponent || "Без съперник"}`}
            onClick={() => onSelect(item)}
          >{matchEventTypeLabel(item.eventType)} · {item.matchTime} · {item.opponent || "Без съперник"}</button>)}
        </nav>}
        <p className="match-details-date">
          {new Date(`${match.matchDate}T12:00:00.000Z`).toLocaleDateString("bg-BG", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>
        <div className="match-details-body">
          <div className="match-details-row"><span className="match-details-label">Характер на срещата</span><span className="match-details-value">{matchCategoryLabel(match.category)}</span></div>
          {match.description && <div className="match-details-row"><span className="match-details-label">Описание</span><span className="match-details-value" style={{ whiteSpace: "pre-wrap" }}>{match.description}</span></div>}
          <div className="match-details-row">
            <span className="match-details-label">Противник</span>
            <span className="match-details-value">{match.opponent}</span>
          </div>
          <div className="match-details-row">
            <span className="match-details-label">Час</span>
            <span className="match-details-value">{match.matchTime}</span>
          </div>
          <div className="match-details-row">
            <span className="match-details-label">Място</span>
            <span className="match-details-value">{match.location}</span>
          </div>
          <div className="match-details-row">
            <span className="match-details-label">Домакин/Гост</span>
            <span className={`match-details-badge${match.isHome ? " match-details-badge--home" : " match-details-badge--away"}`}>
              {match.isHome ? "Домакин" : "Гост"}
            </span>
          </div>
          {match.durationMinutes && (
            <div className="match-details-row">
              <span className="match-details-label">Продължителност</span>
              <span className="match-details-value">{match.durationMinutes} мин</span>
            </div>
          )}
        </div>
        {match.attendanceEnabled && <MatchAttendanceControl key={match.id} attendance={match} endpoint={`/api/members/${cardCode}/matches/${match.id}/attendance`} onSaved={onSaved} />}
      </div>
    </div>
  );
}
