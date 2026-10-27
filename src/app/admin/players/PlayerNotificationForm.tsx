"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, Search } from "lucide-react";

export default function PlayerNotificationForm({ clubs, loading }: {
  clubs: { id: string; name: string }[];
  loading: boolean;
}) {
  const [audience, setAudience] = useState<"all" | "clubs">("clubs");
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pickerOpen]);
  const selectedNames = clubs.filter(club => clubIds.includes(club.id)).map(club => club.name);
  const pickerLabel = audience === "all" ? "Всички състезатели" : selectedNames.length === 0
    ? "Изберете отбор" : selectedNames.length <= 2 ? selectedNames.join(", ")
      : `${selectedNames[0]}, ${selectedNames[1]} +${selectedNames.length - 2}`;
  const visibleClubs = [...clubs].sort((a, b) => a.name.localeCompare(b.name))
    .filter(club => club.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return (
    <form className="mp-demo-box mp-notification-box mp-notification-box--players" onSubmit={async event => {
      event.preventDefault();
      if (sending || !message.trim() || (audience === "clubs" && !clubIds.length)) return;
      setSending(true);
      setPickerOpen(false);
      setStatus("");
      try {
        const response = await fetch("/api/admin/notifications/send-to-players", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience, clubIds, message: message.trim() }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Неуспешно изпращане.");
        setStatus(`Обработени състезатели: ${data.targetedPlayers}. Push известия: ${data.summary.sent}/${data.summary.total}. Неуспешни известия: ${data.summary.failed}. Грешки при състезатели: ${data.failedPlayers}.`);
        if (!data.failedPlayers && !data.summary.failed) setMessage("");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Неуспешно изпращане.");
      } finally { setSending(false); }
    }}>
      <p className="mp-demo-label">СЪОБЩЕНИЕ ДО СЪСТЕЗАТЕЛИТЕ</p>
      <fieldset disabled={sending || loading} className="mp-player-notification-fields">
        <div className="mp-demo-picker" ref={pickerRef} onKeyDown={event => {
          if (event.key === "Escape") {
            setPickerOpen(false);
            pickerRef.current?.querySelector("button")?.focus();
          }
        }}>
          <button type="button" className="mp-demo-picker-trigger" aria-expanded={pickerOpen}
            aria-label={`Получатели: ${pickerLabel}`} onClick={() => setPickerOpen(previous => !previous)}>
            <span className="mp-demo-picker-trigger-label">{pickerLabel}</span>
            <ChevronDown size={16} />
          </button>
          {pickerOpen && <div className="mp-demo-picker-panel">
            <div className="mp-demo-picker-search">
              <Search size={16} />
              <input className="mp-search-input" aria-label="Търси отбор за съобщение" placeholder="Търси отбор..." value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            <div className="mp-demo-picker-list">
              <label className={`mp-demo-picker-option${audience === "all" ? " is-selected" : ""}`}>
                <input type="checkbox" checked={audience === "all"} onChange={() => {
                  setAudience(previous => previous === "all" ? "clubs" : "all");
                  setClubIds([]);
                }} />
                <span>Избери всички</span>
              </label>
              {visibleClubs.map(club => <label key={club.id} className={`mp-demo-picker-option${audience === "all" || clubIds.includes(club.id) ? " is-selected" : ""}`}>
                <input type="checkbox" checked={audience === "all" || clubIds.includes(club.id)} onChange={() => {
                  if (audience === "all") {
                    setAudience("clubs");
                    setClubIds(clubs.filter(item => item.id !== club.id).map(item => item.id));
                  } else {
                    setClubIds(previous => previous.includes(club.id) ? previous.filter(id => id !== club.id) : [...previous, club.id]);
                  }
                }} />
                <span>{club.name}</span>
              </label>)}
              {!visibleClubs.length && <p className="mp-demo-picker-empty">Няма намерени отбори.</p>}
            </div>
          </div>}
        </div>
        <textarea className="mp-player-message" aria-label="Съобщение до състезателите" placeholder="Въведете съобщение до състезателите..." value={message} onChange={event => setMessage(event.target.value)} required maxLength={1000} rows={3} />
        <div className="mp-demo-actions">
          <button type="submit" className="mp-demo-btn mp-demo-btn--yellow" disabled={!message.trim() || (audience === "clubs" && !clubIds.length)}>
            <Bell size={16} />
            {sending ? "Изпращане..." : "Изпрати до състезателите"}
          </button>
        </div>
      </fieldset>
      <div role="status">{status && <p>{status}</p>}</div>
    </form>
  );
}
