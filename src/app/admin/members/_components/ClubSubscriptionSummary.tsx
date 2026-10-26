"use client";
import { useEffect, useRef, useState } from "react";
import type { ClubSubscriptionSummaryView, SubscriptionStatus } from "@/lib/clubSubscriptionDomain";
import styles from "./ClubSubscriptionSummary.module.css";
const monthLabel = (month: string) => new Intl.DateTimeFormat("bg-BG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const dateLabel = (date: string) => date.split("-").reverse().join(".");
const statusLabels: Record<SubscriptionStatus, string> = {
  contract: "С договор",
  not_activated: "Неактивен",
  trial: "Безплатен пробен период",
  trial_expired: "Пробният период е изтекъл",
  active: "Активен — платено",
  unpaid: "Има неплатени месеци",
  scheduled: "Предстоящ платен абонамент",
};

export default function ClubSubscriptionSummary({ clubId }: { clubId: string }) {
  const [data, setData] = useState<{ clubId: string; value: ClubSubscriptionSummaryView | null } | null>(null);
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const response = await fetch(`/api/admin/clubs/${encodeURIComponent(clubId)}/subscription`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Абонаментът не може да бъде зареден.");
        const value = await response.json() as ClubSubscriptionSummaryView | null;
        if (!controller.signal.aborted) { setData({ clubId, value }); setError(""); }
      } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
      finally { loading = false; }
    }
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [clubId]);
  const subscription = data?.clubId === clubId ? data.value : null;
  if (error) return <p role="status" className={styles.error}>{error}</p>;
  if (!subscription) return null;
  const { summary } = subscription;
  return <div className={styles.container}>
    {summary.status !== "contract" && <button type="button" className={styles.badge} data-status={summary.status} aria-haspopup="dialog" aria-label={`Абонамент за MyTeam: ${statusLabels[summary.status]}`} onClick={() => setIsOpen(true)}>{statusLabels[summary.status]}</button>}
    <dialog ref={dialogRef} className={styles.dialog} aria-label="Абонамент на клуба за MyTeam" onClose={() => setIsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
    <section className={styles.panel} data-status={summary.status}>
    <div className={styles.heading}><h3>Абонамент на клуба за MyTeam</h3><button type="button" className={styles.close} aria-label="Затвори" onClick={() => setIsOpen(false)}>×</button></div>
    <span className={styles.badge} role="status" data-status={summary.status}>{statusLabels[summary.status]}</span>
    {summary.status === "scheduled" && subscription.firstBillingMonth && <p>Платеният абонамент започва от {monthLabel(subscription.firstBillingMonth)}.</p>}
    {subscription.mode === "contract" ? <p>Таксуването се управлява по договор извън приложението.</p> : subscription.mode === "trial" ? <p>{subscription.trialEndDate ? `Пробен период до ${dateLabel(subscription.trialEndDate)} включително.` : "Пробен период без крайна дата."}</p> : <>
      <dl className={styles.metrics}>
        <div><dt>Месечна такса</dt><dd>{summary.currentFee} EUR</dd></div>
        <div><dt>Дължимо до текущия месец</dt><dd data-outstanding={summary.outstanding.length > 0}>{summary.outstandingTotal} EUR</dd></div>
        <div><dt>Платено до (без пропуски)</dt><dd>{summary.paidThrough ? monthLabel(summary.paidThrough) : "Няма непрекъснато покритие"}</dd></div>
      </dl>
      <details><summary>Платени месеци ({subscription.paidMonths.length})</summary>
        {subscription.paidMonths.length ? <ul>{[...subscription.paidMonths].sort((a, b) => b.month.localeCompare(a.month)).map((m) => <li key={m.month}><span>{monthLabel(m.month)}</span><strong>{m.amount} EUR</strong></li>)}</ul> : <p>Няма записани плащания.</p>}
      </details>
      {summary.outstanding.length > 0 && <details><summary>Неплатени месеци ({summary.outstanding.length})</summary><ul>{summary.outstanding.map((m) => <li key={m.month}><span>{monthLabel(m.month)}</span><strong>{m.amount} EUR</strong></li>)}</ul></details>}
      <p className={styles.hint}>Таксите са за абонамента на клуба към MyTeam. При вече извършено плащане се свържете с администратора за отразяването му.</p>
    </>}
    </section>
    </dialog>
  </div>;
}
