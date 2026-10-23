"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import "./page.css";

const PARTNER_LABELS: Record<string, string> = {
  SPORT_DEPOT: "Sport Depot",
  IDB: "Innline Dragon Body",
  NIKO: "Мебели Нико",
  DALIDA: "Dalida Dance",
};

const PARTNER_BADGE_CLASS: Record<string, string> = {
  SPORT_DEPOT: "ds-badge-sd",
  IDB: "ds-badge-idb",
  NIKO: "ds-badge-niko",
  DALIDA: "ds-badge-dalida",
};

const PARTNER_LOGOS: Record<string, string> = {
  SPORT_DEPOT: "/sd-logo.webp",
  IDB: "/idb-logo.svg",
  NIKO: "/niko-logo.webp",
  DALIDA: "/dalida-logo.webp",
};

interface ClubRow {
  id: string;
  name: string;
}

interface DailyRow {
  createdAt: string;
  partner: string;
  action: string;
}

interface StatsResponse {
  partners: { name: string; logoUrl: string | null }[];
  totals: Record<string, { view: number; copy: number; link_click: number }>;
  daily: DailyRow[];
}

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

function getDefaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminDiscountStatsClient() {
  const router = useRouter();

  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getDefaultTo);
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/clubs", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setClubs(data as ClubRow[]);
      })
      .catch(() => { });
  }, []);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedClubId) params.set("clubId", selectedClubId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/admin/discount-stats?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setError("Грешка при зареждане на данните.");
        return;
      }
      const data = (await res.json()) as StatsResponse;
      setStats(data);
    } catch {
      setError("Грешка при зареждане на данните.");
    } finally {
      setLoading(false);
    }
  }, [selectedClubId, from, to]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Always keep a ref to the latest fetchStats so the SSE handler
  // never captures a stale closure, without reopening the connection on filter changes.
  const fetchStatsRef = useRef(fetchStats);
  useEffect(() => {
    fetchStatsRef.current = fetchStats;
  }, [fetchStats]);

  useEffect(() => {
    const es = new EventSource("/api/admin/discount-stats/events");
    // Events are process-local; refresh also when tracking hits another server.
    const refreshTimer = window.setInterval(() => void fetchStatsRef.current(), 30_000);

    es.onmessage = (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { type: string };
      if (data.type === "discount-usage") {
        void fetchStatsRef.current();
      }
    };

    return () => {
      window.clearInterval(refreshTimer);
      es.close();
    };
  }, []); // Opens once on mount, never closed by filter changes

  const PARTNERS = Object.keys(stats?.totals ?? {});
  const partnerLabel = (partner: string) => PARTNER_LABELS[partner] ?? partner;
  const partnerLogo = (partner: string) => stats?.partners.find((p) => p.name === partner)?.logoUrl ?? PARTNER_LOGOS[partner];

  return (
    <div className="ds-page">
      <div className="ds-dot-grid" />
      <div className="ds-inner">
        {/* Top Action Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <button className="ds-back-btn" onClick={() => router.push("/admin/players")} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
            Назад
          </button>
          <AdminLogoutButton />
        </div>

        {/* Centered Title */}
        <div className="ds-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: "28px" }}>
          <h1 className="ds-title" style={{ textAlign: "center", margin: 0 }}>Партньорски отстъпки</h1>
          <p className="ds-subtitle" style={{ textAlign: "center" }}>Статистика за използване на отстъпките по партньори</p>
          <div className="ds-title-line" />
        </div>

        {/* Filters */}
        <div className="ds-filters">
          <select
            className="ds-filter-select"
            style={{ textAlign: "center", textAlignLast: "center", textIndent: "16px" }}
            value={selectedClubId}
            onChange={(e) => setSelectedClubId(e.target.value)}
          >
            <option value="">Всички отбори</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="date"
            className="ds-filter-input"
            style={{ textAlign: "center", textIndent: "16px" }}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            className="ds-filter-input"
            style={{ textAlign: "center", textIndent: "16px" }}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        {/* Summary cards */}
        <div className="ds-summary" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {PARTNERS.map((partner) => {
            const t = stats?.totals[partner] ?? { view: 0, copy: 0, link_click: 0 };
            const isSelected = selectedPartner === partner;
            return (
              <div
                key={partner}
                className={`ds-card ${isSelected ? "is-selected" : ""}`}
                style={{
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  border: isSelected ? "1px solid rgba(50, 205, 50, 0.8)" : "1px solid rgba(255, 255, 255, 0.1)",
                  backgroundColor: isSelected ? "rgba(50, 205, 50, 0.15)" : "rgba(255, 255, 255, 0.03)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px 15px",
                  minHeight: "180px",
                  gap: "8px",
                  borderRadius: "16px",
                  position: "relative",
                  overflow: "hidden",
                  backgroundImage: `linear-gradient(to bottom, rgba(13, 13, 13, 0.68), rgba(13, 13, 13, 0.82)), url(${partnerLogo(partner) ?? ""})`,
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  boxShadow: isSelected ? "0 8px 32px rgba(50, 205, 50, 0.15)" : "0 4px 12px rgba(0, 0, 0, 0.2)"
                }}
                onClick={() => setSelectedPartner(isSelected ? null : partner)}
              >
                <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", width: "100%", height: "100%" }}>
                  <div className="ds-card-name" style={{
                    textAlign: "center",
                    width: "100%",
                    fontSize: "15px",
                    fontWeight: "700",
                    color: "rgba(255, 255, 255, 0.95)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    textShadow: "0 2px 4px rgba(0,0,0,0.5)"
                  }}>
                    {partnerLabel(partner)}
                  </div>

                  <div className="ds-card-stats" style={{
                    justifyContent: "center",
                    width: "100%",
                    gap: "16px",
                    marginTop: "auto"
                  }}>
                    <div className="ds-stat" style={{ alignItems: "center" }}>
                      <span className="ds-stat-value" style={{
                        fontSize: "24px",
                        fontWeight: "900",
                        color: "#32cd32",
                        textShadow: "0 0 15px rgba(50, 205, 50, 0.3)"
                      }}>{t.view}</span>
                      <span className="ds-stat-label" style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.5)", fontWeight: "600", textTransform: "uppercase" }}>Прегледи</span>
                    </div>
                    <div className="ds-stat" style={{ alignItems: "center" }}>
                      <span className="ds-stat-value" style={{
                        fontSize: "24px",
                        fontWeight: "900",
                        color: "#32cd32",
                        textShadow: "0 0 15px rgba(50, 205, 50, 0.3)"
                      }}>{t.copy}</span>
                      <span className="ds-stat-label" style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.5)", fontWeight: "600", textTransform: "uppercase" }}>Копирания</span>
                    </div>
                    <div className="ds-stat" style={{ alignItems: "center" }}>
                      <span className="ds-stat-value" style={{
                        fontSize: "24px",
                        fontWeight: "900",
                        color: "#32cd32",
                        textShadow: "0 0 15px rgba(50, 205, 50, 0.3)"
                      }}>{t.link_click}</span>
                      <span className="ds-stat-label" style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.5)", fontWeight: "600", textTransform: "uppercase" }}>Линк клика</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Daily table */}
        <div className="ds-table-wrap" style={{ marginTop: "10px" }}>
          <div className="ds-table-title" style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.8)", borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
            Дневна разбивка {selectedPartner && <span style={{ color: "#32cd32", marginLeft: "4px" }}>({partnerLabel(selectedPartner)})</span>}
          </div>
          {loading ? (
            <div className="ds-loading">Зареждане...</div>
          ) : error ? (
            <div className="ds-empty">{error}</div>
          ) : !stats || stats.daily.length === 0 ? (
            <div className="ds-empty">Няма записани използвания за избрания период.</div>
          ) : (() => {
            const visibleDaily = selectedPartner
              ? stats.daily.filter((r) => r.partner === selectedPartner)
              : stats.daily;

            if (visibleDaily.length === 0) {
              return <div className="ds-empty">Няма записани използвания за този партньор.</div>;
            }

            return (
              <table className="ds-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "center" }}>Дата и час</th>
                    <th style={{ textAlign: "center" }}>Партньор</th>
                    <th style={{ textAlign: "center" }}>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDaily.map((row, i) => {
                    const dt = new Date(row.createdAt);
                    const dateStr = dt.toLocaleDateString("bg-BG", { timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", year: "numeric" });
                    const timeStr = dt.toLocaleTimeString("bg-BG", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", second: "2-digit" });
                    return (
                      <tr key={i} style={{ transition: "background 0.2s" }}>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center", padding: "12px 16px" }}>
                          <div style={{ color: "rgba(255, 255, 255, 0.9)", fontSize: "12px", fontWeight: "500" }}>{dateStr}</div>
                          <div style={{ color: "rgba(255, 255, 255, 0.45)", fontSize: "11px" }}>{timeStr}</div>
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px" }}>
                          <span className={`ds-partner-badge ${PARTNER_BADGE_CLASS[row.partner] ?? ""}`} style={{ padding: "4px 10px", borderRadius: "6px" }}>
                            {PARTNER_LABELS[row.partner] ?? row.partner}
                          </span>
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px" }}>
                          <span className={row.action === "copy" ? "ds-action-copy" : row.action === "link_click" ? "ds-action-link" : "ds-action-view"} style={{ fontSize: "11px", fontWeight: "600" }}>
                            {row.action === "copy" ? "Копиран код" : row.action === "link_click" ? "Линк клик" : "Преглед"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
