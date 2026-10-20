"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { MATCH_ABSENCE_REASONS, type MatchAttendance } from "@/lib/matchAttendanceRules";
import "@/components/matchAttendance.css";

type Props = { attendance: MatchAttendance; endpoint: string; playerId?: string; onSaved: () => void | Promise<void>; disabled?: boolean };
export default function MatchAttendanceControl({ attendance, endpoint, playerId, onSaved, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<"attend" | "optOut" | null>(null);
  const confirmationTitleId = useId();
  async function save(present: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, present, reasonCode, reasonText }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Грешка при запазване.");
      setEditing(false);
      setConfirmation(null);
      setReasonCode("");
      setReasonText("");
      await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Грешка при запазване."); }
    finally { setSaving(false); }
  }
  const label = MATCH_ABSENCE_REASONS[attendance.reasonCode as keyof typeof MATCH_ABSENCE_REASONS];
  const checkmark = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;
  function closeConfirmation() {
    if (saving) return;
    setConfirmation(null);
    setReasonCode("");
    setReasonText("");
    setError("");
  }
  if (!playerId) return <div className="match-attendance-control match-attendance-control--member">
    <div className="training-attendance-buttons">
      <button className={`pm-btn training-attend-btn${attendance.present ? " training-btn-selected" : ""}`} type="button" disabled={saving || disabled || attendance.present} onClick={() => { setError(""); setConfirmation("attend"); }}>
        {attendance.present && !saving && checkmark}{saving ? "Запазване..." : "Присъствам"}
      </button>
      <button className={`pm-btn training-optout-btn${!attendance.present ? " training-btn-selected" : ""}`} type="button" disabled={saving || disabled || !attendance.present} onClick={() => { setError(""); setReasonCode(""); setReasonText(""); setConfirmation("optOut"); }}>
        {!attendance.present && !saving && checkmark}{saving ? "Запазване..." : "Отсъствам"}
      </button>
    </div>
    {!attendance.present && <p className="match-attendance-reason">Причина: {attendance.reasonText || label || "—"}</p>}
    {confirmation && createPortal(<div className="pm-overlay" onClick={(event) => { event.stopPropagation(); closeConfirmation(); }}>
      <div className="pm-modal member-training-confirm-modal" role="dialog" aria-modal="true" aria-labelledby={confirmationTitleId} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") closeConfirmation(); }}>
        <div className="pm-header"><h2 className="pm-title" id={confirmationTitleId}>Потвърждение</h2></div>
        <div className="pm-divider" />
        <p className="training-confirm-text">{confirmation === "attend" ? "Сигурни ли сте, че искате да потвърдите присъствие за мача?" : "Сигурни ли сте, че искате да откажете присъствие за мача?"}</p>
        <form onSubmit={(event) => { event.preventDefault(); void save(confirmation === "attend"); }}>
          {confirmation === "optOut" && <div className="training-confirm-reason-fields">
            <label className="training-confirm-reason-label"><span className="pm-info-lbl">Причина (задължително)</span>
              <select className="training-confirm-reason-control" required autoFocus value={reasonCode} disabled={saving} onChange={(event) => { setReasonCode(event.target.value); setReasonText(""); }}>
                <option value="">Избери причина</option>
                {Object.entries(MATCH_ABSENCE_REASONS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            {reasonCode === "other" && <label className="training-confirm-reason-label"><span className="pm-info-lbl">Опиши причината (задължително)</span>
              <textarea className="training-confirm-reason-control training-confirm-reason-textarea" required maxLength={200} rows={3} placeholder="Въведи причина..." value={reasonText} disabled={saving} onChange={(event) => setReasonText(event.target.value)} />
            </label>}
          </div>}
          {error && <p role="alert" className="match-attendance-error">{error}</p>}
          <div className="pm-actions training-confirm-actions">
            <button className="pm-btn pm-btn--cancel" type="button" disabled={saving} onClick={closeConfirmation}>Отказ</button>
            <button className="pm-btn pm-btn--submit" type="submit" disabled={saving || disabled || (confirmation === "optOut" && (!reasonCode || (reasonCode === "other" && !reasonText.trim())))}>{saving ? "Запазване..." : "Потвърди"}</button>
          </div>
        </form>
      </div>
    </div>, document.body)}
  </div>;
  return <div className="match-attendance-control">
    <p className={attendance.present ? "match-attendance-present" : "match-attendance-absent"}>{attendance.present ? "Присъства" : "Отсъства"}</p>
    {!attendance.present && <p className="match-attendance-reason">Причина: {attendance.reasonText || label || "—"}</p>}
    {editing ? <form onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      <label>Причина за отсъствие
        <select required value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} disabled={saving}>
          <option value="">Изберете причина</option>
          {Object.entries(MATCH_ABSENCE_REASONS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      {reasonCode === "other" && <label>Описание<textarea required maxLength={200} value={reasonText} onChange={(event) => setReasonText(event.target.value)} disabled={saving} /></label>}
      <div className="match-attendance-actions">
        <button type="submit" disabled={saving || disabled}>{saving ? "Запазване…" : "Потвърди отсъствие"}</button>
        <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); }}>Отказ</button>
      </div>
    </form> : <button type="button" disabled={saving || disabled} onClick={() => { if (attendance.present) { setEditing(true); setError(""); } else void save(true); }}>{saving ? "Запазване…" : playerId ? (attendance.present ? "Отбележи отсъствие" : "Отбележи присъствие") : attendance.present ? "Няма да присъствам" : "Ще присъствам"}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
