"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import "./page.css";

const BellIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
  </svg>
);

const TriangleAlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </svg>
);

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const MONTHS = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];

interface ClubRow {
  id: string;
  name: string;
  emblemUrl?: string | null;
  imageUrl?: string | null;
  imagePublicId?: string | null;
  notifyOnCoachVisit?: boolean;
  billingStatus?: string;
  createdAt?: string | null;
}

export default function AdminPlayersPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubsSearch, setClubsSearch] = useState("");
  const [clubsLoading, setClubsLoading] = useState(true);
  const [demoSendingType, setDemoSendingType] = useState<"reminder" | "overdue" | null>(null);
  const [demoClubIds, setDemoClubIds] = useState<string[]>([]);
  const [demoClubSearch, setDemoClubSearch] = useState("");
  const [demoClubPickerOpen, setDemoClubPickerOpen] = useState(false);
  const demoPickerRef = useRef<HTMLDivElement | null>(null);

  const [coachMessage, setCoachMessage] = useState("");
  const [coachImage, setCoachImage] = useState<File | null>(null);
  const coachImageInputRef = useRef<HTMLInputElement | null>(null);
  const [coachClubIds, setCoachClubIds] = useState<string[]>([]);
  const [coachClubPickerOpen, setCoachClubPickerOpen] = useState(false);
  const [coachClubSearch, setCoachClubSearch] = useState("");
  const [coachMessageScope, setCoachMessageScope] = useState<"main" | "all">("main");
  const [isSendingCoach, setIsSendingCoach] = useState(false);
  const coachPickerRef = useRef<HTMLDivElement | null>(null);

  const [togglingNotifyClubId, setTogglingNotifyClubId] = useState<string | null>(null);

  const toggleNotify = async (e: React.MouseEvent, clubId: string, current: boolean) => {
    e.stopPropagation();
    setTogglingNotifyClubId(clubId);
    try {
      await fetch(`/api/admin/clubs/${clubId}/notify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyOnCoachVisit: !current }),
      });
      setClubs((prev) =>
        prev.map((c) => (c.id === clubId ? { ...c, notifyOnCoachVisit: !current } : c)),
      );
    } finally {
      setTogglingNotifyClubId(null);
    }
  };

  const fetchClubs = async () => {
    setClubsLoading(true);
    try {
      const response = await fetch("/api/admin/clubs", { cache: "no-store" });
      if (!response.ok) {
        setClubs([]);
        return;
      }

      const data = (await response.json()) as ClubRow[];
      const nextClubs = Array.isArray(data) ? data : [];
      console.log("clubs response:", nextClubs);
      setClubs(nextClubs);
      setDemoClubIds((prev) => prev.filter((id) => nextClubs.some((club) => club.id === id)));
    } catch (error) {
      console.error("Error fetching clubs:", error);
      setClubs([]);
    } finally {
      setClubsLoading(false);
    }
  };

  useEffect(() => {
    void fetchClubs();
  }, []);

  useEffect(() => {
    if (!demoClubPickerOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (demoPickerRef.current && !demoPickerRef.current.contains(event.target as Node)) {
        setDemoClubPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [demoClubPickerOpen]);

  useEffect(() => {
    if (!coachClubPickerOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (coachPickerRef.current && !coachPickerRef.current.contains(event.target as Node)) {
        setCoachClubPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [coachClubPickerOpen]);

  const toggleDemoClub = (clubId: string) => {
    setDemoClubIds((prev) =>
      prev.includes(clubId)
        ? prev.filter((id) => id !== clubId)
        : [...prev, clubId],
    );
  };

  const sendDemoNotification = async (type: "reminder" | "overdue") => {
    if (demoSendingType || demoClubIds.length === 0) return;

    setDemoSendingType(type);
    try {
      const selectedDemoClubs = clubs.filter((club) => demoClubIds.includes(club.id));
      if (selectedDemoClubs.length === 0) {
        throw new Error("Invalid club selection.");
      }

      const membersPayloads = await Promise.all(
        selectedDemoClubs.map(async (club) => {
          const membersResponse = await fetch(`/api/admin/members?clubId=${encodeURIComponent(club.id)}`, {
            cache: "no-store",
          });
          if (!membersResponse.ok) {
            throw new Error(`Failed loading members for "${club.name}".`);
          }
          return membersResponse.json();
        }),
      );
      const memberIds = Array.from(
        new Set(
          membersPayloads.flatMap((membersPayload: unknown) =>
            Array.isArray(membersPayload)
              ? membersPayload
                  .map((item) => {
                    const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
                    return typeof raw.id === "string" ? raw.id.trim() : "";
                  })
                  .filter((id): id is string => Boolean(id))
              : [],
          ),
        ),
      );
      if (memberIds.length === 0) {
        throw new Error("No members found in selected clubs.");
      }

      const trainerMessage =
        type === "reminder"
          ? "Напомняне: Здравейте! Напомняме Ви, че предстои плащането на месечния Ви членски внос. "
          : "Просрочие: Здравейте! Вие просрочихте плащането и вече дължите два месечни членски вноса!";

      const response = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "trainer_message",
          memberIds,
          trainerMessage,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const errorMessage =
          typeof payload.error === "string"
            ? payload.error
            : "Неуспешно изпращане на известия.";
        throw new Error(errorMessage);
      }

      const payload = (await response.json()) as {
        summary?: { sent?: number; total?: number };
      };
      const sent = payload.summary?.sent ?? 0;
      const total = payload.summary?.total ?? 0;
      window.alert(`Известия изпратени: ${sent}/${total}`);
    } catch (error) {
      console.error("Demo notification send error:", error);
      window.alert(
        error instanceof Error ? error.message : "Възникна грешка при изпращане."
      );
    } finally {
      setDemoSendingType(null);
    }
  };

  const sendCoachMessage = async () => {
    if (isSendingCoach || coachClubIds.length === 0 || !coachMessage.trim()) return;
    setIsSendingCoach(true);
    try {
      const payload = {
        clubIds: coachClubIds,
        message: coachMessage.trim(),
        includeCoachGroupPages: coachMessageScope === "all",
      };
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      if (coachImage) form.append("image", coachImage);
      const response = await fetch("/api/admin/notifications/send-to-coaches", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as { sent?: number; total?: number; error?: string };
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Неуспешно изпращане.");
      }
      window.alert(`Съобщението е изпратено: ${data.sent ?? 0}/${data.total ?? 0}`);
      setCoachMessage("");
      setCoachImage(null);
      if (coachImageInputRef.current) coachImageInputRef.current.value = "";
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Възникна грешка при изпращане.");
    } finally {
      setIsSendingCoach(false);
    }
  };

  const toggleCoachClub = (clubId: string) => {
    setCoachClubIds((prev) =>
      prev.includes(clubId) ? prev.filter((id) => id !== clubId) : [...prev, clubId],
    );
  };

  const coachClubSearchNormalized = coachClubSearch.trim().toLocaleLowerCase();
  const coachPickerClubs = [...clubs]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .filter((club) =>
      coachClubSearchNormalized.length === 0
        ? true
        : club.name.toLocaleLowerCase().includes(coachClubSearchNormalized),
    );
  const allCoachClubsSelected = clubs.length > 0 && coachClubIds.length === clubs.length;
  const selectedCoachClubNames = clubs.filter((c) => coachClubIds.includes(c.id)).map((c) => c.name);
  const coachPickerLabel =
    selectedCoachClubNames.length === 0
      ? "Изберете отбор"
      : selectedCoachClubNames.length <= 2
        ? selectedCoachClubNames.join(", ")
        : `${selectedCoachClubNames[0]}, ${selectedCoachClubNames[1]} +${selectedCoachClubNames.length - 2}`;

  const normalizedSearch = clubsSearch.trim().toLocaleLowerCase();
  const visibleClubs = [...clubs]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .filter((club) =>
      normalizedSearch.length === 0
        ? true
        : club.name.toLocaleLowerCase().includes(normalizedSearch),
    );
  const demoClubSearchNormalized = demoClubSearch.trim().toLocaleLowerCase();
  const demoPickerClubs = [...clubs]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .filter((club) =>
      demoClubSearchNormalized.length === 0
        ? true
        : club.name.toLocaleLowerCase().includes(demoClubSearchNormalized),
    );
  const selectedDemoClubNames = clubs
    .filter((club) => demoClubIds.includes(club.id))
    .map((club) => club.name);
  const demoPickerLabel =
    selectedDemoClubNames.length === 0
      ? "Select clubs for simulation"
      : selectedDemoClubNames.length <= 2
        ? selectedDemoClubNames.join(", ")
        : `${selectedDemoClubNames[0]}, ${selectedDemoClubNames[1]} +${selectedDemoClubNames.length - 2}`;

  return (
    <main className="mp-page">
      <div className="mp-dot-grid" aria-hidden="true" />

      <div className="mp-inner">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
          <AdminLogoutButton />
        </div>
        <div className="mp-header">
          <h1 className="mp-title">Списък състезатели</h1>
          <p className="mp-subtitle">Търсене, филтриране и ръчно отбелязване на плащания</p>
          <div className="mp-title-line" />
        </div>

        <button
          className="mp-reports-btn"
          style={{ width: "100%", justifyContent: "center" }}
          type="button"
          onClick={() => router.push("/admin/subscriptions")}
        >
          Абонаменти
        </button>

        <button
          className="mp-reports-btn"
          style={{ width: "100%", justifyContent: "center" }}
          type="button"
          onClick={() => router.push("/admin/discounts")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Управление на отстъпки
        </button>

        <button
          className="mp-reports-btn"
          style={{ width: "100%", justifyContent: "center", marginTop: "-16px" }}
          type="button"
          onClick={() => router.push("/admin/discount-stats")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Статистика на отстъпки
        </button>

        <button
          className="mp-reports-btn"
          style={{ width: "100%", justifyContent: "center", marginTop: "-16px" }}
          type="button"
          onClick={() => router.push("/admin/page-clicks")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            <path d="m13 13 6 6" />
          </svg>
          Кликове на началната страница
        </button>

        <button
          className="mp-reports-btn"
          style={{ width: "100%", justifyContent: "center", marginTop: "-16px" }}
          type="button"
          onClick={() => router.push("/admin/email")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          Изпрати имейл
        </button>

        <div className="mp-demo-box">
          <p className="mp-demo-label">DEMO ACTIONS</p>
          <div className="mp-demo-picker" ref={demoPickerRef}>
            <button
              type="button"
              className="mp-demo-picker-trigger"
              onClick={() => setDemoClubPickerOpen((prev) => !prev)}
              aria-expanded={demoClubPickerOpen}
              disabled={clubsLoading || demoSendingType !== null}
            >
              <span className="mp-demo-picker-trigger-label">{demoPickerLabel}</span>
              <ChevronDownIcon />
            </button>
            {demoClubPickerOpen && (
              <div className="mp-demo-picker-panel">
                <div className="mp-demo-picker-search">
                  <SearchIcon />
                  <input
                    type="text"
                    value={demoClubSearch}
                    onChange={(e) => setDemoClubSearch(e.target.value)}
                    className="mp-search-input"
                    placeholder="Search clubs..."
                    aria-label="Search clubs for simulation"
                  />
                </div>
                <div className="mp-demo-picker-list">
                  {demoPickerClubs.length === 0 ? (
                    <p className="mp-demo-picker-empty">No clubs found.</p>
                  ) : (
                    demoPickerClubs.map((club) => {
                      const isSelected = demoClubIds.includes(club.id);
                      return (
                        <label key={`demo-picker-${club.id}`} className={`mp-demo-picker-option${isSelected ? " is-selected" : ""}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDemoClub(club.id)}
                          />
                          <span>{club.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="mp-demo-actions">
            <button
              className="mp-demo-btn mp-demo-btn--yellow"
              onClick={() => void sendDemoNotification("reminder")}
              disabled={demoSendingType !== null || demoClubIds.length === 0}
            >
              <BellIcon />
              Симулирай Напомняне (25-то число)
            </button>
            <button
              className="mp-demo-btn mp-demo-btn--red"
              onClick={() => void sendDemoNotification("overdue")}
              disabled={demoSendingType !== null || demoClubIds.length === 0}
            >
              <TriangleAlertIcon />
              Симулирай Просрочие (1-во число)
            </button>
          </div>
        </div>

        <div className="mp-demo-box">
          <p className="mp-demo-label">СЪОБЩЕНИЕ ДО ТРЕНЬОРИТЕ</p>
          <div className="mp-demo-picker" ref={coachPickerRef}>
            <button
              type="button"
              className="mp-demo-picker-trigger"
              onClick={() => setCoachClubPickerOpen((prev) => !prev)}
              aria-expanded={coachClubPickerOpen}
              disabled={clubsLoading || isSendingCoach}
            >
              <span className="mp-demo-picker-trigger-label">{coachPickerLabel}</span>
              <ChevronDownIcon />
            </button>
            {coachClubPickerOpen && (
              <div className="mp-demo-picker-panel">
                <div className="mp-demo-picker-search">
                  <SearchIcon />
                  <input
                    type="text"
                    value={coachClubSearch}
                    onChange={(e) => setCoachClubSearch(e.target.value)}
                    className="mp-search-input"
                    placeholder="Търси отбор..."
                    aria-label="Търси отбор"
                  />
                </div>
                <div className="mp-demo-picker-list">
                  {coachPickerClubs.length === 0 ? (
                    <p className="mp-demo-picker-empty">Няма намерени отбори.</p>
                  ) : (
                    <>
                      <label className={`mp-demo-picker-option${allCoachClubsSelected ? " is-selected" : ""}`}>
                        <input
                          type="checkbox"
                          checked={allCoachClubsSelected}
                          onChange={() =>
                            setCoachClubIds(allCoachClubsSelected ? [] : clubs.map((c) => c.id))
                          }
                        />
                        <span>Избери всички</span>
                      </label>
                      {coachPickerClubs.map((club) => (
                        <label
                          key={`coach-picker-${club.id}`}
                          className={`mp-demo-picker-option${coachClubIds.includes(club.id) ? " is-selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={coachClubIds.includes(club.id)}
                            onChange={() => toggleCoachClub(club.id)}
                          />
                          <span>{club.name}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <textarea
            value={coachMessage}
            onChange={(e) => setCoachMessage(e.target.value)}
            placeholder="Въведете съобщение до треньорите..."
            disabled={isSendingCoach}
            rows={3}
            style={{
              width: "100%",
              marginTop: "10px",
              padding: "10px 12px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--accent-gold-color)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "14px",
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <label style={{ display: "block", marginTop: 10 }}>
            Снимка към съобщението (JPG, PNG, WebP, до 9 MB)
            <input ref={coachImageInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              disabled={isSendingCoach}
              onChange={event => {
                const file = event.target.files?.[0] ?? null;
                if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 9 * 1024 * 1024)) {
                  window.alert("Изберете JPG, PNG или WebP снимка до 9 MB.");
                  event.target.value = "";
                  setCoachImage(null);
                  return;
                }
                setCoachImage(file);
              }} />
          </label>
          {coachImage ? <button type="button" disabled={isSendingCoach} onClick={() => {
            setCoachImage(null);
            if (coachImageInputRef.current) coachImageInputRef.current.value = "";
          }}>Премахни снимката: {coachImage.name}</button> : null}
          <div className="mp-coach-scope" role="radiogroup" aria-label="Обхват на съобщението">
            <label className={`mp-coach-scope-option${coachMessageScope === "main" ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="coachMessageScope"
                checked={coachMessageScope === "main"}
                onChange={() => setCoachMessageScope("main")}
                disabled={isSendingCoach}
              />
              <span>Само главната страница</span>
            </label>
            <label className={`mp-coach-scope-option${coachMessageScope === "all" ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="coachMessageScope"
                checked={coachMessageScope === "all"}
                onChange={() => setCoachMessageScope("all")}
                disabled={isSendingCoach}
              />
              <span>Главната и треньорските групи</span>
            </label>
          </div>
          <div className="mp-demo-actions">
            <button
              className="mp-demo-btn mp-demo-btn--yellow"
              onClick={() => void sendCoachMessage()}
              disabled={isSendingCoach || coachClubIds.length === 0 || !coachMessage.trim()}
            >
              <BellIcon />
              {isSendingCoach ? "Изпращане..." : "Изпрати до треньорите"}
            </button>
          </div>
        </div>

        <div className="mp-add-team-section">
          <button 
            className="mp-add-team-btn"
            onClick={() => router.push("/admin/teams/add")}
          >
            <span className="mp-add-team-icon">+</span>
            Добави отбор
          </button>
        </div>

        <div className="mp-teams-section">
          <div className="mp-search-wrap">
            <SearchIcon />
            <input
              className="mp-search-input"
              type="text"
              value={clubsSearch}
              onChange={(e) => setClubsSearch(e.target.value)}
              placeholder="Търси отбор..."
              aria-label="Търси отбор"
            />
            {clubsSearch && (
              <button
                type="button"
                className="mp-search-clear"
                onClick={() => setClubsSearch("")}
                aria-label="Изчисти търсенето"
              >
                <XIcon />
              </button>
            )}
          </div>
          <h2 className="mp-teams-title" style={{ textAlign: "center" }}>Изберете отбор:</h2>
          <div className="mp-teams-grid">
            {clubsLoading && (
              <div className="mp-team-empty">Зареждане на отборите...</div>
            )}

            {!clubsLoading && visibleClubs.map((club) => (
              <div key={club.id} className={`mp-team-card${club.billingStatus === "active" ? " mp-team-card--active" : " mp-team-card--demo"}`}>
                <button
                  type="button"
                  className="mp-team-card-content"
                  onClick={() => router.push(`/admin/members?clubId=${club.id}`)}
                >
                  <div className="mp-team-logo-wrap">
                    {club.imageUrl || club.emblemUrl ? (
                      <img src={club.imageUrl || club.emblemUrl || ""} alt={club.name} className="mp-team-logo mp-team-logo--img" />
                    ) : (
                      <span className="mp-team-logo">🏆</span>
                    )}
                  </div>
                  <div className="mp-team-info">
                    <h3 className="mp-team-name">{club.name}</h3>
                    {club.createdAt && (
                      <p className="mp-team-created">
                        {new Date(club.createdAt).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </p>
                    )}
                  </div>
                  <ChevronRightIcon />
                </button>
                <button
                  type="button"
                  className={`mp-notify-btn${club.notifyOnCoachVisit ? " is-active" : ""}`}
                  onClick={(e) => void toggleNotify(e, club.id, club.notifyOnCoachVisit ?? false)}
                  disabled={togglingNotifyClubId === club.id}
                  title={club.notifyOnCoachVisit ? "Уведомленията са включени" : "Уведомленията са изключени"}
                >
                  <BellIcon filled={club.notifyOnCoachVisit} />
                </button>
              </div>
            ))}
            {!clubsLoading && clubs.length > 0 && visibleClubs.length === 0 && (
              <div className="mp-team-empty">Няма резултати за това търсене.</div>
            )}

            {!clubsLoading && clubs.length === 0 && (
              <div className="mp-team-empty">Няма добавени отбори.</div>
            )}
          </div>
        </div>
      </div>

    </main>
  );
}
