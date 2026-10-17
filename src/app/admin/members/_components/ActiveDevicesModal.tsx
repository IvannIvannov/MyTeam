"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ActiveDevicesModal.module.css";

type PlayerDevices = { id: string; fullName: string; activeDeviceCount: number };
type Filter = "all" | "active" | "inactive";
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "Всички" },
  { value: "active", label: "С активни устройства" },
  { value: "inactive", label: "Без активни устройства" },
];

export default function ActiveDevicesModal({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  const [players, setPlayers] = useState<PlayerDevices[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [accessError, setAccessError] = useState<"session" | "forbidden" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setAccessError(null);
      try {
        const response = await fetch(`/api/admin/members/push-devices?clubId=${encodeURIComponent(clubId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setPlayers([]);
          setHasLoaded(false);
          setAccessError(response.status === 401 ? "session" : "forbidden");
          return;
        }
        if (!response.ok) throw new Error("Неуспешно зареждане. Опитайте отново с „Обнови“.");
        const data: { players: PlayerDevices[] } = await response.json();
        if (!controller.signal.aborted) {
          setPlayers(data.players);
          setHasLoaded(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "Неуспешно зареждане.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [clubId, refresh]);

  const activeCount = players.filter((player) => player.activeDeviceCount > 0).length;
  const counts = { all: players.length, active: activeCount, inactive: players.length - activeCount };
  const visiblePlayers = players.filter((player) => filter === "all" || (filter === "active" ? player.activeDeviceCount > 0 : player.activeDeviceCount === 0));

  return (
    <div className="amp-overlay" onClick={onClose}>
      <div ref={dialogRef} className={`amp-modal ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="active-devices-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h2 id="active-devices-title" className={`amp-modal-title ${styles.title}`}>
          <span className="amp-modal-title-gradient">Активирани известия</span>
          <button className="amp-modal-close" type="button" onClick={onClose} aria-label="Затвори">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </h2>
        <p className={styles.description}>Активни устройства на състезателите в текущия клуб.</p>
        <div className={styles.toolbar}>
          <span role="status">{loading ? (hasLoaded ? "Обновяване…" : "Зареждане…") : hasLoaded ? `${players.length} състезатели` : "Данните не са заредени"}</span>
          <button type="button" className={styles.refresh} disabled={loading || accessError !== null} onClick={() => setRefresh((value) => value + 1)}>Обнови</button>
        </div>
        <div className={styles.filters} role="group" aria-label="Филтър по активни устройства">
          {filters.map((item) => (
            <button key={item.value} type="button" aria-pressed={filter === item.value} className={`${styles.filter} ${styles[item.value]}`} onClick={() => setFilter(item.value)}>
              {item.label}<span>{hasLoaded ? counts[item.value] : loading ? "…" : "—"}</span>
            </button>
          ))}
        </div>
        {(error || accessError) && (
          <div className={styles.error} role="alert">
            {accessError === "session" ? <>
              <p>Сесията ви е изтекла. Влезте отново, за да заредите устройствата.</p>
              <button type="button" className={styles.refresh} onClick={() => {
                const next = window.location.pathname + window.location.search;
                window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`);
              }}>Влез отново</button>
            </> : accessError === "forbidden" ? <p>Нямате права за достъп до този списък.</p>
              : <p>{error}{hasLoaded ? " Показани са последните успешно заредени данни; възможно е да не са актуални." : ""}</p>}
          </div>
        )}
        <div className={styles.list} aria-busy={loading}>
          {loading && !hasLoaded ? <p className={styles.empty} role="status">Зареждане на устройствата…</p>
            : !hasLoaded ? null
            : visiblePlayers.length === 0 ? <p className={styles.empty} role="status">{players.length === 0 ? "Няма активни състезатели в този клуб." : "Няма състезатели, отговарящи на избрания филтър."}</p>
            : <ul>{visiblePlayers.map((player) => (
              <li key={player.id} className={styles.row}>
                <span className={styles.name}>{player.fullName}</span>
                <span className={`${styles.count} ${player.activeDeviceCount > 0 ? styles.active : styles.inactive}`}>
                  <strong>{player.activeDeviceCount}</strong>
                  <span>{player.activeDeviceCount === 1 ? "активно устройство" : "активни устройства"}</span>
                </span>
              </li>
            ))}</ul>}
        </div>
      </div>
    </div>
  );
}
