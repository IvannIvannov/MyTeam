"use client";

import { useEffect, useRef, useState } from "react";

type Training = { id: string; date: string; time: string | null; groupName: string; reasonCode: string | null; reasonText: string | null; charged: boolean };

export default function TrainingCheckInPicker({ cardCode, onClose, onConfirm }: { cardCode: string; onClose: () => void; onConfirm: (sessionId: string) => Promise<void> }) {
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/members/${encodeURIComponent(cardCode)}/training-credit/check-in`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Грешка при зареждане."); setTrainings(data.trainings); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cardCode]);
  return <dialog ref={dialogRef} className="pm-modal" aria-labelledby="training-check-in-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} style={{ position: "fixed", inset: 0, margin: "auto", maxHeight: "90vh", overflowY: "auto" }}>
    <h2 id="training-check-in-title">Чекирай тренировка</h2>
    {loading ? <p role="status">Зареждане…</p> : trainings.length === 0 && !error ? <p>Няма тренировки за чекиране</p> : <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, maxHeight: "50vh", overflowY: "auto" }}>
      <legend>Изберете тренировка</legend>
      {trainings.map((training) => <label key={training.id} style={{ display: "block", padding: "12px 0" }}>
        <input type="radio" name="training-check-in" value={training.id} checked={selected === training.id} onChange={() => setSelected(training.id)} />{" "}
        {new Date(`${training.date}T12:00:00Z`).toLocaleDateString("bg-BG")} · {training.time || "Без час"} · {training.groupName}
        {(training.reasonText || training.reasonCode) && <span style={{ display: "block" }}>Отсъствие: {training.reasonText || ({ sick: "Болест", injury: "Контузия", other: "Друга причина", limited_event: "Без потвърдено място" }[training.reasonCode ?? ""] ?? training.reasonCode)}</span>}
        {training.charged && <span style={{ display: "block" }}>Тренировката вече е таксувана. Без повторно отнемане.</span>}
      </label>)}
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <div className="pm-actions">
      <button type="button" className="pm-btn" disabled={saving} onClick={onClose}>Отказ</button>
      <button type="button" className="pm-btn" disabled={loading || saving || !selected} onClick={async () => { setSaving(true); setError(""); try { await onConfirm(selected); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Неуспешно чекиране."); } finally { setSaving(false); } }}>{saving ? "Запазване…" : "Потвърди"}</button>
    </div>
  </dialog>;
}
