"use client";

import { useState } from "react";

export default function CoachMessageModal({ clubId, groups, onClose }: {
  clubId: string;
  groups: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function send() {
    if (busy || !selected.size || !message.trim()) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/members/notify-coaches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubId, coachGroupIds: [...selected], message: message.trim() }),
      });
      const data = await response.json() as { error?: string; delivered?: number; failed?: number; pushFailed?: number };
      if (!response.ok) throw new Error(data.error ?? "Грешка при изпращане");
      setSuccess(`Съобщението е записано в ${data.delivered ?? 0} треньорски страници.`);
      if (data.failed) setError(`Неуспешно записване в ${data.failed} страници.`);
      else { setSelected(new Set()); setMessage(""); }
      if (data.pushFailed) setError(prev => `${prev} Неуспешни push известия: ${data.pushFailed}.`.trim());
    } catch (err) { setError(err instanceof Error ? err.message : "Грешка при изпращане"); }
    finally { setBusy(false); }
  }
  return (
    <div className="amp-overlay amp-overlay--confirm" onClick={() => { if (!busy) onClose(); }}>
      <div className="amp-modal amp-modal--confirm amp-modal--notify" role="dialog" aria-modal="true" aria-labelledby="coach-message-title" onClick={event => event.stopPropagation()}>
        <div className="amp-modal-tint" aria-hidden="true" />
        <h2 className="amp-modal-title">
          <span id="coach-message-title" className="amp-modal-title-gradient">Изпрати до треньори</span>
          <button className="amp-modal-close" type="button" aria-label="Затвори" disabled={busy} onClick={onClose}>×</button>
        </h2>
        <div className="amp-modal-body">
          <p>Съобщението ще се появи в известията на избраните треньорски страници.</p>
          <button type="button" className="amp-btn amp-btn--ghost amp-btn--compact" disabled={busy || !groups.length} onClick={() => setSelected(new Set(groups.map(group => group.id)))}>Избери всички ({groups.length})</button>
          <div className="amp-notify-player-list" style={{ marginTop: 12 }}>
            {!groups.length && <p className="amp-empty amp-empty--modal">Няма треньорски групи.</p>}
            {groups.map(group => (
              <label className="amp-notify-player-item" key={group.id}>
                <input type="checkbox" disabled={busy} checked={selected.has(group.id)} onChange={event => {
                  const checked = event.target.checked;
                  setSelected(prev => { const next = new Set(prev); if (checked) next.add(group.id); else next.delete(group.id); return next; });
                }} />
                <span className="amp-notify-player-name">{group.name}</span>
              </label>
            ))}
          </div>
          <label className="amp-edit-field" style={{ marginTop: 16 }}>
            <span className="amp-lbl">Съобщение</span>
            <textarea className="amp-edit-input amp-notify-textarea" rows={4} placeholder="Въведете съобщение..." disabled={busy} value={message} onChange={event => setMessage(event.target.value)} style={{ height: "auto", resize: "vertical", padding: "8px 10px" }} />
          </label>
          {error && <p className="amp-confirm-error" role="alert">{error}</p>}
          {success && <p role="status">{success}</p>}
          <div className="amp-modal-actions" style={{ marginTop: 16 }}>
            <button type="button" className="amp-btn amp-btn--ghost" disabled={busy} onClick={onClose}>Затвори</button>
            <button type="button" className="amp-btn amp-btn--primary" disabled={busy || !selected.size || !message.trim()} onClick={() => void send()}>{busy ? "Изпращане..." : `Изпрати до ${selected.size}`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
