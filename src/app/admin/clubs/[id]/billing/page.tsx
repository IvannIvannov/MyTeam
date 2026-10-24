"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./billing.module.css";
import SubscriptionSetupFields, { defaultTrialDraft, setupFromDraft } from "@/components/admin/SubscriptionSetupFields";
import { localToday } from "@/lib/clubSubscriptionDomain";

interface ClubData {
  id: string;
  name: string;
  billingStatus: "demo" | "active";
  firstBillingMonth: string | null;
  billingActivatedAt: string | null;
}

type Step = "idle" | "confirm" | "override";

export default function ClubBillingPage() {
  const params = useParams<{ id: string }>();
  const clubId = params.id;
  const router = useRouter();

  const [subscriptionDraft, setSubscriptionDraft] = useState(defaultTrialDraft);
  const [loading, setLoading] = useState(true);
  const [club, setClub] = useState<ClubData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState("");
  const [playerStatus, setPlayerStatus] = useState<"keep" | "paid" | "warning" | "overdue">("warning");
  const [step, setStep] = useState<Step>("idle");
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    const fetchClub = async () => {
      try {
        const response = await fetch("/api/admin/clubs", { cache: "no-store" });
        if (!response.ok) {
          setError("Грешка при зареждане на клуба.");
          return;
        }
        const clubs: unknown[] = await response.json();
        const found = clubs.find((c) => {
          const item = c as { id?: unknown };
          return String(item.id ?? "") === clubId;
        }) as ClubData | undefined;

        if (!found) {
          router.replace("/404");
          return;
        }

        setClub(found);
        if (found.firstBillingMonth) {
          setSelectedMonth(new Date(found.firstBillingMonth).toISOString().slice(0, 7));
        } else {
          setSelectedMonth(localToday().slice(0, 7));
        }
      } catch (err) {
        console.error("Error fetching club:", err);
        setError("Грешка при зареждане на клуба.");
      } finally {
        setLoading(false);
      }
    };

    if (clubId) {
      void fetchClub();
    }
  }, [clubId, router]);

  const handleActivate = async (confirm?: "override") => {
    setError(null);
    setSuccess(null);
    setActivating(true);

    try {
      const body: Record<string, unknown> = { firstBillingMonth: selectedMonth, playerStatus };
      if (club?.billingStatus !== "active") body.subscription = setupFromDraft(subscriptionDraft);
      if (confirm) body.confirm = confirm;

      const response = await fetch(`/api/admin/clubs/${clubId}/activate-billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status === 409) {
        setStep("override");
        setActivating(false);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError((payload as { error?: string }).error ?? "Грешка при активиране на таксуването.");
        setStep("idle");
        setActivating(false);
        return;
      }

      const result = await response.json();
      const affectedPlayers: number = (result as { affectedPlayers?: number }).affectedPlayers ?? 0;

      setClub((prev) =>
        prev
          ? {
              ...prev,
              billingStatus: "active",
              firstBillingMonth: `${selectedMonth}-01T00:00:00.000Z`,
              billingActivatedAt: new Date().toISOString(),
            }
          : prev,
      );
      setStep("idle");
      setSuccess(
        `Таксуването е активирано от ${selectedMonth}. Засегнати състезатели: ${affectedPlayers}.` +
          (typeof result.warning === "string" ? ` ${result.warning}` : ""),
      );
    } catch (err) {
      console.error("Billing activation error:", err);
      setError(err instanceof Error ? err.message : "Грешка при активиране на таксуването.");
      setStep("idle");
    } finally {
      setActivating(false);
    }
  };

  const handlePrimaryClick = () => {
    if (step === "idle") {
      if (club?.billingStatus === "active") {
        setStep("confirm");
      } else {
        void handleActivate();
      }
    } else if (step === "confirm") {
      void handleActivate();
    } else if (step === "override") {
      void handleActivate("override");
    }
  };

  const handleCancel = () => {
    setStep("idle");
    setError(null);
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  if (!club) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.alertError}>{error ?? "Клубът не е намерен."}</div>
        </div>
      </div>
    );
  }

  const isActive = club.billingStatus === "active";
  const currentFirstBillingMonth = club.firstBillingMonth
    ? new Date(club.firstBillingMonth).toISOString().slice(0, 7)
    : null;

  const buttonLabel = (() => {
    if (activating) return "Активиране...";
    if (step === "override") return "Потвърди промяната";
    if (step === "confirm") return "Потвърди";
    return isActive ? "Промени началния месец" : "Активирай таксуването";
  })();

  return (
    <div className={`${styles.page} ${styles.fadeIn}`}>
      <div className={styles.dotGrid} />
      <div className={styles.inner}>
        <div className={styles.card}>
          <div className={styles.header}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => router.back()}
            >
              ← Назад
            </button>
            <h1 className={styles.title}>Таксуване — {club.name}</h1>
          </div>

          <div className={styles.section}>
            <span className={styles.label}>Текущ статус</span>
            {isActive ? (
              <span className={styles.badgeActive}>Активно</span>
            ) : (
              <span className={styles.badgeDemo}>Демо</span>
            )}
          </div>

          {isActive && currentFirstBillingMonth && (
            <div className={styles.section}>
              <span className={styles.label}>Начален месец на таксуване</span>
              <span className={styles.infoValue}>{currentFirstBillingMonth}</span>
              {club.billingActivatedAt && (
                <span className={styles.infoMeta}>
                  (активирано на{" "}
                  {new Date(club.billingActivatedAt).toLocaleDateString("bg-BG", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                  )
                </span>
              )}
            </div>
          )}

          <div className={styles.divider} />

          {success && <div className={styles.alertSuccess}>{success}</div>}
          {error && <div className={styles.alertError}>{error}</div>}

          {step === "confirm" && (
            <div className={styles.alertWarning}>
              <strong>Внимание:</strong> Промяната на началния месец ще актуализира{" "}
              <em>всички активни състезатели</em> в клуба
              {playerStatus === "keep"
                ? " без промяна на техния статус"
                : ` и ще зададе техния статус на "${
                    playerStatus === "paid" ? "Платено" : playerStatus === "warning" ? "Напомняне" : "Просрочено"
                  }"`}
              . Продължи?
            </div>
          )}

          {step === "override" && (
            <div className={styles.alertError}>
              <strong>Таксуването е вече активно.</strong> Искаш ли да замениш началния месец с{" "}
              <strong>{selectedMonth}</strong>? Това ще актуализира всички активни състезатели.
            </div>
          )}

          <div className={styles.section}>
            <label className={styles.label}>Статус на състезателите след активиране</label>
            <select
              className={styles.select}
              value={playerStatus}
              onChange={(e) => setPlayerStatus(e.target.value as typeof playerStatus)}
              disabled={activating}
            >
              <option value="keep">Запази текущия статус</option>
              <option value="paid">Платено</option>
              <option value="warning">Напомняне</option>
              <option value="overdue">Просрочено</option>
            </select>
          </div>

          <div>
            <label className={styles.label}>
              {isActive ? "Нов начален месец" : "Начален месец на таксуване"}
            </label>
            <input
              type="month"
              className={styles.input}
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setStep("idle");
                setError(null);
                setSuccess(null);
              }}
              disabled={activating}
            />
            {!isActive && (
              <p className={styles.hint}>
                След активиране всички активни състезатели ще получат този начален месец и статусите им ще бъдат преизчислени.
              </p>
            )}
          </div>

          {!isActive && (
            <section className={styles.section}>
              <h2 className={styles.label}>Абонамент на клуба за MyTeam</h2>
              <p className={styles.hint}>Изберете пробен период или платен абонамент. Таксите на състезателите се управляват отделно.</p>
              <SubscriptionSetupFields value={subscriptionDraft} onChange={setSubscriptionDraft} disabled={activating} />
            </section>
          )}

          <div className={styles.btnRow}>
            {step !== "idle" && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={handleCancel}
                disabled={activating}
              >
                Отказ
              </button>
            )}
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handlePrimaryClick}
              disabled={activating || !selectedMonth.trim()}
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
