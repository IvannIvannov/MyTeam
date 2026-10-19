"use client";

import { useEffect, useId, useState } from "react";
import { MATCH_ABSENCE_REASONS, type MatchAttendance } from "@/lib/matchAttendanceRules";
import "@/components/matchAttendance.css";

type Roster = { enabled: boolean; players: (MatchAttendance & { id: string; fullName: string; teamGroup: number | null })[] };
export default function MatchAttendancePanel({ clubId, matchId }: { clubId: string; matchId: string }) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const playersBodyId = useId();
  const endpoint = "/api/admin/clubs/" + encodeURIComponent(clubId) + "/matches/" + encodeURIComponent(matchId) + "/attendance";
  async function refresh() {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Неуспешно зареждане на присъствието.");
    setRoster(await response.json());
    setError("");
  }
  async function toggleAttendance(player: Roster["players"][number]) {
    setSavingPlayerId(player.id);
    setSaveError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: player.id, present: !player.present, reasonCode: "other", reasonText: "Промяна направена от треньор" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Грешка при запазване.");
      await refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Грешка при запазване.");
    } finally { setSavingPlayerId(null); }
  }
  useEffect(() => {
    let active = true;
    let generation = 0;
    async function load() {
      const current = ++generation;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error("Неуспешно зареждане на присъствието.");
        const data = await response.json() as Roster;
        if (active && current === generation) { setRoster(data); setError(""); }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "Грешка при зареждане."); }
    }
    void load();
    const stream = new EventSource("/api/admin/clubs/" + encodeURIComponent(clubId) + "/training-attendance/stream");
    stream.addEventListener("attendance-update", load);
    window.addEventListener("focus", load);
    return () => { active = false; stream.close(); window.removeEventListener("focus", load); };
  }, [endpoint, clubId]);
  if (error) return <p role="alert">{error}</p>;
  if (!roster) return <p role="status">Зареждане на присъствие…</p>;
  if (!roster.enabled) return null;
  return <section className="match-attendance-panel" aria-label="Присъствие за мача">
    <div className="amp-training-table-wrap">
      <button type="button" className="amp-training-players-toggle" aria-expanded={expanded} aria-controls={playersBodyId} onClick={() => setExpanded((current) => !current)}>
        <span>Играчи ({roster.players.length})</span>
        <span className={`amp-training-players-toggle-arrow${expanded ? " amp-training-players-toggle-arrow--open" : ""}`} aria-hidden="true">▾</span>
      </button>
      <div id={playersBodyId} className={`amp-training-players-body${expanded ? " amp-training-players-body--open" : ""}`} inert={!expanded}>
        {roster.players.length === 0 ? <p className="amp-empty amp-empty--modal">Няма състезатели за този отбор.</p> : <table className="amp-training-table">
          <thead><tr><th scope="col">Име</th><th scope="col">Набор</th><th scope="col">Статус</th></tr></thead>
          <tbody>{roster.players.map((player) => {
            const reasonLabel = MATCH_ABSENCE_REASONS[player.reasonCode as keyof typeof MATCH_ABSENCE_REASONS];
            return <tr key={player.id}>
              <td>{player.fullName}</td>
              <td>{player.teamGroup ?? "-"}</td>
              <td>
                <button type="button" className={`amp-training-tag ${player.present ? "amp-training-tag--in" : "amp-training-tag--out"}`} disabled={savingPlayerId !== null} onClick={() => void toggleAttendance(player)} title={player.present ? "Отбележи отсъствие" : "Отбележи присъствие"} aria-label={`${player.fullName}: ${player.present ? "Ще присъства. Отбележи отсъствие" : "Няма да присъства. Отбележи присъствие"}`}>
                  {savingPlayerId === player.id ? "Запазване..." : player.present ? "Ще присъства" : "Няма да присъства"}
                </button>
                {!player.present && <small className="match-attendance-table-reason">Причина: {player.reasonText || reasonLabel || "—"}</small>}
              </td>
            </tr>;
          })}</tbody>
        </table>}
      </div>
    </div>
    {saveError && <p role="alert" className="match-attendance-error">{saveError}</p>}
  </section>;
}
