"use client";
import { useState } from "react";

type Session = { id?: string; scopeKey?: string; trainingTime?: string; trainingDurationMinutes?: number; trainingFieldName?: string | null; trainingFieldPieceNames?: string[]; note?: string; optedOut?: boolean; optOutReasonCode?: string | null; optOutReasonText?: string | null; limitedEvent?: { id: string; isRegistered: boolean; isConfirmed: boolean; waitlistPosition: number | null; spotsRemaining: number } | null };
export default function MemberTrainingSessions({ sessions, date, cardCode, onUpdated }: { sessions: Session[]; date?: string; cardCode: string; onUpdated: () => Promise<unknown> }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("sick");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  async function update(session: Session, optedOut: boolean) {
    setSaving(session.id ?? session.scopeKey ?? "legacy"); setError("");
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(cardCode)}/training`, { method: optedOut ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(session.id ? { trainingSessionId: session.id } : { trainingDate: date }), reasonCode: reason, reasonText: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Неуспешно запазване.");
      await onUpdated(); setSelected(null); setText("");
    } catch (e) { setError(e instanceof Error ? e.message : "Неуспешно запазване."); }
    finally { setSaving(null); }
  }
  async function register(session: Session) {
    const event = session.limitedEvent;
    if (!event || !date) return;
    setSaving(session.id ?? session.scopeKey ?? "legacy"); setError("");
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(cardCode)}/training/register`, { method: event.isRegistered ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limitedEventId: event.id, trainingDate: date }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Неуспешно записване.");
      await onUpdated();
    } catch (e) { setError(e instanceof Error ? e.message : "Неуспешно записване."); }
    finally { setSaving(null); }
  }
  return <div>
    {date && <h3>{new Date(`${date}T12:00:00Z`).toLocaleDateString("bg-BG", { weekday: "long", day: "2-digit", month: "long", timeZone: "Europe/Sofia" })}</h3>}
    {sessions.map((session) => <section key={session.id ?? session.scopeKey} className="training-attendance-info-card">
      <h3>{session.trainingTime} · {session.trainingDurationMinutes} мин.</h3>
      {session.trainingFieldName && <p>{session.trainingFieldName}{session.trainingFieldPieceNames?.length ? ` · ${session.trainingFieldPieceNames.join(", ")}` : " · Цял терен"}</p>}
      {session.note && <p style={{ whiteSpace: "pre-wrap" }}>{session.note}</p>}
      {session.limitedEvent ? <div className="training-attendance-buttons" style={{ flexDirection: "column" }}>
        <p>{session.limitedEvent.isRegistered ? session.limitedEvent.isConfirmed ? "Записан за тренировката" : `Чакалня · позиция ${session.limitedEvent.waitlistPosition}` : `${session.limitedEvent.spotsRemaining} свободни места`}</p>
        <button className="pm-btn training-attend-btn" disabled={!!saving} onClick={() => void register(session)}>{session.limitedEvent.isRegistered ? "Откажи записването" : session.limitedEvent.spotsRemaining ? "Запиши се" : "Запиши се в чакалнята"}</button>
      </div> : <>
      <p>{session.optedOut ? `Отсъствам${session.optOutReasonText ? `: ${session.optOutReasonText}` : ""}` : "Присъствам"}</p>
      <div className="training-attendance-buttons">
        <button className="pm-btn training-attend-btn" disabled={!!saving || !session.optedOut} onClick={() => void update(session, false)}>Присъствам</button>
        <button className="pm-btn training-optout-btn" disabled={!!saving || !!session.optedOut} onClick={() => { setSelected(session.id ?? session.scopeKey ?? "legacy"); setReason("sick"); setText(""); }}>Отсъствам</button>
      </div>
      </>}
      {selected === (session.id ?? session.scopeKey ?? "legacy") && <form className="training-confirm-reason-fields" onSubmit={(e) => { e.preventDefault(); void update(session, true); }}>
        <label className="training-confirm-reason-label"><span className="pm-info-lbl">Причина</span><select className="training-confirm-reason-control" value={reason} onChange={(e) => setReason(e.target.value)}><option value="sick">Болест</option><option value="injury">Контузия</option><option value="other">Друга</option></select></label>
        {reason === "other" && <label className="training-confirm-reason-label"><span className="pm-info-lbl">Описание</span><textarea className="training-confirm-reason-control training-confirm-reason-textarea" required value={text} onChange={(e) => setText(e.target.value)} /></label>}
        <button className="pm-btn" disabled={!!saving || (reason === "other" && !text.trim())}>{saving ? "Запазване…" : "Потвърди отсъствие"}</button>
        <button type="button" className="pm-btn" disabled={!!saving} onClick={() => setSelected(null)}>Назад</button>
      </form>}
    </section>)}
    {error && <p role="alert" className="training-error">{error}</p>}
  </div>;
}
