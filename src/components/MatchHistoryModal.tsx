"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Check, ChevronRight, X } from "lucide-react";
import { getTodayIsoDateInTimeZone } from "@/lib/training";
import MatchAttendancePanel from "@/components/MatchAttendancePanel";
import { AttendanceFilterSelect } from "@/components/AttendanceFilterSelect";
import { formatMatchResult, getMatchOutcome, hasMatchFinished, parseMatchResult } from "@/lib/matchResult";
import "@/components/matchHistory.css";

type HistoryMatch = {
  homeScore: number | null; awayScore: number | null;
  id: string; opponent: string; location: string; matchDate: string; matchTime: string;
  durationMinutes: number; isHome: boolean; teamGroups: number[]; attendanceEnabled: boolean;
  customGroup: { name: string } | null;
};
type History = { matches: HistoryMatch[]; total: number; page: number; pageSize: number; customGroups: { id: string; name: string }[]; recentForm: Pick<HistoryMatch, "id" | "opponent" | "matchDate" | "homeScore" | "awayScore" | "isHome">[] };

function MatchTeamBadge({ name, logoUrl, side }: { name: string; logoUrl?: string | null; side: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = logoUrl && logoUrl !== failedUrl ? logoUrl : "/default-team-badge.svg";
  return <div className="match-scoreboard-team">
    <div className="match-scoreboard-badge"><Image src={source} width={80} height={80} alt={`Емблема на ${name}`} unoptimized onError={() => setFailedUrl(source)} /></div>
    <strong>{name}</strong><span className="match-history-meta">{side}</span>
  </div>;
}

function MatchHistoryDetailsModal({ match, clubId, clubName, clubLogoUrl, onClose, onResultSaved }: { match: HistoryMatch; clubId: string; clubName: string; clubLogoUrl?: string | null; onClose: () => void; onResultSaved: (homeScore: number | null, awayScore: number | null) => void }) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [editingResult, setEditingResult] = useState(false);
  const [homeScore, setHomeScore] = useState(String(match.homeScore ?? ""));
  const [awayScore, setAwayScore] = useState(String(match.awayScore ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function saveResult() {
    const result = parseMatchResult({ homeScore: homeScore.trim() === "" ? null : Number(homeScore), awayScore: awayScore.trim() === "" ? null : Number(awayScore) });
    if ("error" in result) { setError(result.error); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/matches/${encodeURIComponent(match.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Грешка при запазване на резултата.");
      onResultSaved(data.match.homeScore, data.match.awayScore);
      setEditingResult(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Грешка при запазване."); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButton.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, []);
  const details = [
    ["Отбор", match.customGroup?.name || (match.teamGroups.length ? `Набор: ${match.teamGroups.join(", ")}` : "Всички отбори")],
    ["Място", match.location],
    ["Продължителност", `${match.durationMinutes} мин`],
  ];
  return <div className="amp-overlay amp-overlay--confirm match-history-details-overlay" onClick={(event) => { event.stopPropagation(); onClose(); }}>
    <div className="amp-modal amp-modal--match-history amp-modal--match-history-details" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="amp-modal-tint" aria-hidden="true" />
      <h2 id={titleId} className="amp-modal-title">
        <span className="amp-modal-title-gradient">Детайли за мача</span>
        <button ref={closeButton} type="button" className="amp-modal-close" aria-label="Затвори детайлите" onClick={onClose}><X size={18} /></button>
      </h2>
      <div className="amp-modal-body">
        <section className="match-scoreboard" aria-label="Отбори и резултат">
          <MatchTeamBadge name={match.isHome ? clubName : match.opponent || "Съперник"} logoUrl={match.isHome ? clubLogoUrl : null} side="Домакин" />
          <div className="match-scoreboard-centre">
            <time className="match-scoreboard-date" dateTime={`${match.matchDate}T${match.matchTime}`}>{new Date(`${match.matchDate}T12:00:00Z`).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })} · {match.matchTime}</time>
            {hasMatchFinished(match) && editingResult ? <form className="match-scoreboard-form" aria-label="Редактиране на резултата" onSubmit={(event) => { event.preventDefault(); void saveResult(); }}>
              <div className="match-scoreboard-inputs">
                <input className="amp-edit-input" type="number" min={0} max={999} step={1} inputMode="numeric" aria-label="Голове на домакина" value={homeScore} onChange={(event) => setHomeScore(event.target.value)} disabled={saving} />
                <span aria-hidden="true">:</span>
                <input className="amp-edit-input" type="number" min={0} max={999} step={1} inputMode="numeric" aria-label="Голове на госта" value={awayScore} onChange={(event) => setAwayScore(event.target.value)} disabled={saving} />
              </div>
              {error && <p className="amp-confirm-error" role="alert">{error}</p>}
              <div className="match-scoreboard-form-actions">
                <button type="button" className="match-scoreboard-action" aria-label="Отказ" title="Отказ" disabled={saving} onClick={() => { setEditingResult(false); setError(""); }}><X size={18} /></button>
                <button type="submit" className="match-scoreboard-action match-scoreboard-action--save" aria-label={saving ? "Запазване..." : "Запази резултата"} title="Запази резултата" disabled={saving}><Check size={18} /></button>
              </div>
            </form> : <strong className={`match-scoreboard-result${match.homeScore === null || match.awayScore === null ? " match-scoreboard-result--empty" : ""}`}>{formatMatchResult(match)}</strong>}
            {hasMatchFinished(match) && !editingResult && <button type="button" className="amp-btn amp-btn--ghost match-scoreboard-edit" onClick={() => { setHomeScore(String(match.homeScore ?? "")); setAwayScore(String(match.awayScore ?? "")); setEditingResult(true); }}>{match.homeScore === null ? "Добави резултат" : "Редактирай резултата"}</button>}
          </div>
          <MatchTeamBadge name={match.isHome ? match.opponent || "Съперник" : clubName} logoUrl={match.isHome ? null : clubLogoUrl} side="Гост" />
        </section>
        <dl className="amp-match-view-body">{details.map(([label, value]) => <div className="amp-match-view-row" key={label}><dt className="amp-match-view-label">{label}</dt><dd className="amp-match-view-value">{value}</dd></div>)}</dl>
        {match.attendanceEnabled ? <MatchAttendancePanel clubId={clubId} matchId={match.id} /> : <p className="match-history-meta">За този мач не е включено отчитане на присъствие.</p>}
        <div className="amp-modal-actions amp-modal-actions--end"><button type="button" className="amp-btn amp-btn--ghost" onClick={onClose}>Назад към историята</button></div>
      </div>
    </div>
  </div>;
}

export default function MatchHistoryModal({ clubId, clubName = "Нашият отбор", clubLogoUrl, coachGroupId, coachGroupName, onClose }: {
  clubId: string; clubName?: string; clubLogoUrl?: string | null; coachGroupId?: string; coachGroupName?: string; onClose: () => void;
}) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [customGroupId, setCustomGroupId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<HistoryMatch | null>(null);
  const today = getTodayIsoDateInTimeZone("Europe/Sofia");

  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ page: String(page) });
        if (from) query.set("from", from);
        if (to) query.set("to", to);
        if (search.trim()) query.set("search", search.trim());
        if (coachGroupId) query.set("coachGroupId", coachGroupId);
        if (customGroupId) query.set("customGroupId", customGroupId);
        const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/matches/history?${query}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Грешка при зареждане.");
        if (!cancelled) setData(result);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Грешка при зареждане.");
      } finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clubId, coachGroupId, from, to, search, page, customGroupId, refreshKey]);

  function resetPage() { setPage(1); setSelectedMatch(null); setLoading(true); }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return <><div className="amp-overlay amp-overlay--confirm" onClick={onClose} inert={selectedMatch !== null} aria-hidden={selectedMatch ? true : undefined}>
    <div className="amp-modal amp-modal--match-history" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="amp-modal-tint" aria-hidden="true" />
      <h2 id={titleId} className="amp-modal-title">
        <span className="amp-modal-title-gradient amp-modal-title-gradient--match">История на мачовете</span>
        <button ref={closeButton} type="button" className="amp-modal-close" onClick={onClose} aria-label="Затвори"><X size={18} /></button>
      </h2>
      <div className="amp-modal-body">
      {coachGroupName && <p className="amp-lbl">Треньорска група: {coachGroupName}</p>}
      <section className="match-history-form" aria-label="Форма от последните 5 мача" aria-busy={loading}>
        <div className="match-history-form-heading"><span className="amp-lbl">Последни 5 мача</span><span className="match-history-meta">Най-новият е вляво</span></div>
        <div className="match-history-form-squares">{Array.from({ length: 5 }, (_, index) => {
          const match = data?.recentForm?.[index];
          const outcome = match ? getMatchOutcome(match) : "unset";
          const label = outcome === "win" ? "Победа" : outcome === "loss" ? "Загуба" : outcome === "draw" ? "Равенство" : "Няма резултат";
          const description = match ? `${label} · ${match.matchDate} · срещу ${match.opponent || "—"} · ${formatMatchResult(match)} (домакин : гост)` : "Няма резултат";
          return <span key={match?.id ?? index} className={`match-history-form-square match-history-form-square--${outcome}`} title={description} aria-label={description}>{outcome === "win" ? "П" : outcome === "loss" ? "З" : outcome === "draw" ? "Р" : "—"}</span>;
        })}</div>
      </section>
      <div className="match-history-filters">
        <div className="amp-edit-field match-history-group-filter"><span className="amp-lbl">Група</span><AttendanceFilterSelect label="Група" value={customGroupId} options={[{ value: "", label: "Всички групи" }, ...(data?.customGroups ?? []).map((group) => ({ value: group.id, label: group.name }))]} onChange={(value) => { setCustomGroupId(value); resetPage(); }} /></div>
        <label className="amp-edit-field"><span className="amp-lbl">От</span><input type="date" className="amp-edit-input" value={from} max={to || today} onChange={(event) => { setFrom(event.target.value); resetPage(); }} /></label>
        <label className="amp-edit-field"><span className="amp-lbl">До</span><input type="date" className="amp-edit-input" value={to} min={from} max={today} onChange={(event) => { setTo(event.target.value); resetPage(); }} /></label>
        <label className="amp-edit-field match-history-search"><span className="amp-lbl">Съперник или място</span><input className="amp-edit-input" type="search" maxLength={200} placeholder="Търси мач..." value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} /></label>
      </div>
      {error ? <p className="amp-confirm-error" role="alert">{error}</p> : loading ? <p className="amp-empty amp-empty--modal" role="status">Зареждане...</p> : data && <>
        <p className="amp-lbl">Общо мачове: {data.total}</p>
        {data.matches.length === 0 ? <p className="amp-empty amp-empty--modal">Няма минали мачове за избраните филтри.</p> : <div className="match-history-list">
          {data.matches.map((match) => <article key={match.id} className={`match-history-card match-history-card--${getMatchOutcome(match)}`}>
            <button type="button" className="match-history-summary" aria-haspopup="dialog" onClick={() => setSelectedMatch(match)}>
              <span className="match-history-date">{new Date(`${match.matchDate}T12:00:00Z`).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })} · {match.matchTime}</span>
              <strong>{match.opponent ? `срещу ${match.opponent}` : "Мач без зададен съперник"}</strong>
              <span className="match-history-meta">{match.customGroup?.name || (match.teamGroups.length ? `Набор: ${match.teamGroups.join(", ")}` : "Всички отбори")} · {match.isHome ? "Домакин" : "Гост"}</span>
              <span className="match-history-meta">{match.location}</span>
              <span className={`match-history-score${match.homeScore === null ? " match-history-score--empty" : ""}`} aria-label={`Резултат, домакин : гост: ${formatMatchResult(match)}`}>{formatMatchResult(match)}</span>
              <ChevronRight className="match-history-arrow" size={18} aria-hidden="true" />
            </button>
          </article>)}
        </div>}
        {pages > 1 && <div className="match-history-pagination">
          <button type="button" className="amp-btn amp-btn--ghost" disabled={page <= 1} onClick={() => { setPage((current) => current - 1); setSelectedMatch(null); setLoading(true); }}>Предишна</button>
          <span>{page} / {pages}</span>
          <button type="button" className="amp-btn amp-btn--ghost" disabled={page >= pages} onClick={() => { setPage((current) => current + 1); setSelectedMatch(null); setLoading(true); }}>Следваща</button>
        </div>}
      </>}
      </div>
    </div>
  </div>
    {selectedMatch && createPortal(<MatchHistoryDetailsModal match={selectedMatch} clubId={clubId} clubName={clubName} clubLogoUrl={clubLogoUrl} onClose={() => setSelectedMatch(null)} onResultSaved={(homeScore, awayScore) => {
      setSelectedMatch((current) => current ? { ...current, homeScore, awayScore } : null);
      setData((current) => current ? { ...current, matches: current.matches.map((match) => match.id === selectedMatch.id ? { ...match, homeScore, awayScore } : match) } : null);
      setRefreshKey((current) => current + 1);
    }} />, document.body)}
  </>;
}
