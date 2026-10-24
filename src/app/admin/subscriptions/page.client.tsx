"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import SubscriptionSetupFields, { defaultTrialDraft, setupFromDraft, type SubscriptionDraft } from "@/components/admin/SubscriptionSetupFields";
import {
  amountCents, earliestFeeChangeMonth, feeForMonth, localToday, money, nextMonth,
  type ClubSubscriptionView, type SubscriptionStatus,
} from "@/lib/clubSubscriptionDomain";
import styles from "./subscriptions.module.css";
import { subscriptionAuditDescription, subscriptionAuditLabels } from "@/lib/clubSubscriptionAudit";

const STATUS: Record<SubscriptionStatus, string> = {
  not_activated: "Неактивиран", trial: "Пробен период", trial_expired: "Изтекъл пробен период",
  active: "Платен", unpaid: "Неплатени месеци", scheduled: "Предстоящ",
};
const MONTH_NAMES = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];
type Action = "trial" | "start_paid" | "fee" | "payment" | "history";
type Save = (body: Record<string, unknown>) => Promise<void>;

function monthLabel(month: string): string { return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`; }
function dateLabel(date: string): string { return date.slice(0, 10).split("-").reverse().join("."); }
function endOfMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}

export default function SubscriptionsPageClient() {
  const [clubs, setClubs] = useState<ClubSubscriptionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<{ clubId: string; action: Action } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/admin/subscriptions", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Абонаментите не могат да бъдат заредени.");
    setClubs(await response.json() as ClubSubscriptionView[]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  async function refresh() {
    setError(""); setLoading(true);
    try { await load(); } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }

  async function save(club: ClubSubscriptionView, body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/subscriptions/${club.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedVersion: club.subscription!.version }),
      });
      const result = await response.json() as { error?: string; warning?: string };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(result.error ?? "Промяната не е запазена.");
      }
      setMessage(result.warning ?? "Промяната е запазена.");
      setEditor(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally { setBusy(false); }
  }

  const visible = clubs.filter((club) => club.name.toLocaleLowerCase("bg").includes(search.toLocaleLowerCase("bg")) && (!status || club.summary.status === status));
  return <main className={styles.page}>
    <div className={styles.dotGrid} aria-hidden="true" />
    <div className={styles.inner}>
      <Link href="/admin/players" className={styles.back}>← Състезатели и клубове</Link>
      <header className={styles.header}><div><h1>Абонаменти</h1><p>Месечни такси на клубовете за MyTeam</p><div className={styles.titleLine} /></div><button type="button" onClick={() => void refresh()} disabled={loading || busy}>Обнови</button></header>
      <div className={styles.filters}>
        <label>Търсене на клуб<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Име на клуб" /></label>
        <label>Статус<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Всички</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {message && <p role="status" className={styles.success}>{message}</p>}
      {loading && <p role="status">Зареждане…</p>}
      {!loading && !visible.length && <p>Няма намерени клубове.</p>}
      <div className={styles.list} aria-busy={busy || loading}>
        {visible.map((club) => <article key={club.id} className={styles.card}>
          <div className={styles.cardHeader}><h2>{club.name}</h2><span className={styles.badge} data-status={club.summary.status}>{STATUS[club.summary.status]}</span></div>
          {club.subscription?.mode === "trial" ? <p>Безплатен пробен период: <strong>{club.subscription.trialEndDate ? `до ${dateLabel(club.subscription.trialEndDate)} включително` : "без крайна дата"}</strong></p> : club.subscription ? <>
            <dl className={styles.metrics}>
              <div><dt>Месечна такса</dt><dd>{club.summary.currentFee} EUR</dd></div>
              <div><dt>Начало</dt><dd>{monthLabel(club.subscription.firstBillingMonth!)}</dd></div>
              <div><dt>Платено до</dt><dd>{club.summary.paidThrough ? dateLabel(endOfMonth(club.summary.paidThrough)) : "Няма непрекъснато покритие"}</dd></div>
              <div><dt>Дължимо до текущия месец</dt><dd>{club.summary.outstandingTotal} EUR</dd></div>
            </dl>
            {club.summary.outstanding.length > 0 && <details><summary>Неплатени месеци ({club.summary.outstanding.length})</summary><ul className={styles.monthList}>{club.summary.outstanding.map((m) => <li key={m.month}>{monthLabel(m.month)} — {m.amount} EUR</li>)}</ul></details>}
            {club.summary.laterPaidMonths.length > 0 && <p>Отделно платени месеци след пропуск: {club.summary.laterPaidMonths.map(monthLabel).join(", ")}</p>}
          </> : <p>Активирайте таксуването от страницата „Такси“ на клуба, за да настроите абонамент.</p>}
          <div className={styles.actions}>
            {club.subscription?.mode === "trial" && <>
              <button type="button" disabled={busy || loading} onClick={() => { setError(""); setEditor({ clubId: club.id, action: "trial" }); }}>Редактирай пробния период</button>
              <button type="button" disabled={busy || loading} onClick={() => { setError(""); setEditor({ clubId: club.id, action: "start_paid" }); }}>Задай платен абонамент</button>
              <button type="button" disabled={busy || loading} onClick={() => setEditor({ clubId: club.id, action: "history" })}>История и такси</button>
            </>}
            {club.subscription?.mode === "paid" && <>
              <button type="button" disabled={busy || loading} onClick={() => { setError(""); setEditor({ clubId: club.id, action: "fee" }); }}>Редактирай таксата</button>
              <button className={styles.primary} type="button" disabled={busy || loading} onClick={() => { setError(""); setEditor({ clubId: club.id, action: "payment" }); }}>Маркирай като платено</button>
              <button type="button" disabled={busy || loading} onClick={() => setEditor({ clubId: club.id, action: "history" })}>История и такси</button>
            </>}
            {club.billingStatus === "active" && <Link href={`/admin/members?clubId=${club.id}`}>Отвори клуба ↗</Link>}
          </div>
          {editor?.clubId === club.id && club.subscription && <section className={styles.editor}>
            <div className={styles.editorHeader}><h3>{({ trial: "Редакция на пробен период", start_paid: "Платен абонамент", fee: "Промяна на месечната такса", payment: "Запис на плащане", history: "История и такси" })[editor.action]}</h3><button type="button" disabled={busy} onClick={() => setEditor(null)}>Затвори</button></div>
            <SubscriptionEditor key={`${club.id}-${club.subscription.version}-${editor.action}`} club={club} action={editor.action} busy={busy} save={(body) => save(club, body)} />
          </section>}
        </article>)}
      </div>
    </div>
  </main>;
}

function SubscriptionEditor({ club, action, busy, save }: { club: ClubSubscriptionView; action: Action; busy: boolean; save: Save }) {
  const subscription = club.subscription!;
  const [draft, setDraft] = useState<SubscriptionDraft>(() => ({ ...defaultTrialDraft(), mode: action === "start_paid" ? "paid" : "trial",
    trialChoice: subscription.trialEndDate ? "limited" : "unlimited", trialEndDate: subscription.trialEndDate ?? "" }));
  const minimumFeeMonth = earliestFeeChangeMonth(subscription.firstBillingMonth ?? localToday().slice(0, 7), subscription.payments);
  const [effectiveMonth, setEffectiveMonth] = useState(() => {
    const next = nextMonth(localToday().slice(0, 7));
    return minimumFeeMonth > next ? minimumFeeMonth : next;
  });
  const [amount, setAmount] = useState(() => feeForMonth(subscription.fees, effectiveMonth) ?? "");
  const [formError, setFormError] = useState("");
  const id = useId();
  if (action === "history") return <PaymentHistory club={club} busy={busy} save={save} />;
  if (action === "payment") return <PaymentForm club={club} busy={busy} save={save} />;

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError("");
    try {
      if (action === "fee") await save({ action, amount, effectiveMonth });
      else {
        const setup = setupFromDraft(draft);
        await save({ ...setup, action });
      }
    } catch (error) { setFormError((error as Error).message); }
  }
  return <form onSubmit={(e) => void submit(e)}>
    {action === "fee" ? <fieldset disabled={busy} className={styles.formFields}>
      <label htmlFor={`${id}-amount`}>Нова месечна такса (EUR)<input id={`${id}-amount`} type="text" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label htmlFor={`${id}-month`}>В сила от месец<input id={`${id}-month`} type="month" min={minimumFeeMonth} max="2199-12" required value={effectiveMonth} onChange={(e) => setEffectiveMonth(e.target.value)} /></label>
      <p>Най-ранен месец за промяна: {monthLabel(minimumFeeMonth)}. Новата такса може да влиза в сила само след последния платен месец.</p>
      <p>Сегашна такса за избрания месец: {feeForMonth(subscription.fees, effectiveMonth) ?? "—"} EUR. Новата такса важи до следващата зададена промяна. Платените суми се запазват.</p>
      <p>Промяната се запазва в „Известия за треньори“ за клуба. Push известието се изпраща само до устройствата на клуба, без треньорските групи.</p>
    </fieldset> : <SubscriptionSetupFields value={draft} onChange={setDraft} disabled={busy} fixedMode={action === "trial" ? "trial" : "paid"} />}
    {action !== "fee" && <p className={styles.hint}>При промяна клубът ще получи съобщение в „Известия за треньори“ и push известие на активираните устройства на клуба.</p>}
    {formError && <p role="alert" className={styles.error}>{formError}</p>}
    <button className={styles.primary} disabled={busy} type="submit">{busy ? "Запазване…" : "Запази"}</button>
  </form>;
}

function PaymentForm({ club, busy, save }: { club: ClubSubscriptionView; busy: boolean; save: Save }) {
  const subscription = club.subscription!;
  const first = subscription.firstBillingMonth!;
  const [year, setYear] = useState(Math.max(Number(first.slice(0, 4)), Number(localToday().slice(0, 4))));
  const [selected, setSelected] = useState<string[]>([]);
  const [paidOn, setPaidOn] = useState(localToday);
  const [note, setNote] = useState("");
  const [paymentId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const id = useId();
  const paid = new Set(subscription.payments.filter((p) => !p.voidedAt).flatMap((p) => p.months.map((m) => m.month)));
  const total = money(selected.reduce((sum, month) => sum + amountCents(feeForMonth(subscription.fees, month)!), 0));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!selected.length) { setError("Изберете поне един месец."); return; }
    try { await save({ action: "payment", paymentId, months: selected, paidOn, note, expectedTotal: total }); }
    catch (err) { setError((err as Error).message); }
  }
  return <form onSubmit={(e) => void submit(e)}>
    <fieldset disabled={busy} className={styles.formFields}>
      <legend>Изберете месеци за плащане</legend>
      <label htmlFor={`${id}-year`}>Година<select id={`${id}-year`} value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 2200 - Number(first.slice(0, 4)) }, (_, i) => Number(first.slice(0, 4)) + i).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      <div className={styles.monthGrid}>{MONTH_NAMES.map((label, index) => {
        const month = `${year}-${String(index + 1).padStart(2, "0")}`;
        const unavailable = month < first || paid.has(month);
        return <label className={styles.monthOption} key={month}>
          <input type="checkbox" disabled={unavailable || (!selected.includes(month) && selected.length >= 120)} checked={selected.includes(month)} onChange={(e) => setSelected((previous) => e.target.checked ? [...previous, month].sort() : previous.filter((m) => m !== month))} />
          <span>{label}<small>{paid.has(month) ? "Платено" : month < first ? "Преди абонамента" : `${feeForMonth(subscription.fees, month)} EUR`}</small></span>
        </label>;
      })}</div>
      <p>Може да изберете месеци от повече от една година. Плащането не изчиства други неплатени месеци.</p>
      {selected.length > 0 && <ul className={styles.monthList}>{selected.map((month) => <li key={month}>{monthLabel(month)} — {feeForMonth(subscription.fees, month)} EUR <button type="button" aria-label={`Премахни ${monthLabel(month)}`} onClick={() => setSelected((previous) => previous.filter((m) => m !== month))}>×</button></li>)}</ul>}
      <p className={styles.total}>Общо за {selected.length} месеца: {total} EUR</p>
      <label htmlFor={`${id}-paid`}>Дата на получаване<input id={`${id}-paid`} type="date" min="2000-01-01" max={localToday()} required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
      <label htmlFor={`${id}-note`}>Бележка (незадължително)<textarea id={`${id}-note`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.primary} type="submit" disabled={busy || !selected.length}>{busy ? "Записване…" : `Потвърди плащане — ${total} EUR`}</button>
  </form>;
}

function PaymentHistory({ club, busy, save }: { club: ClubSubscriptionView; busy: boolean; save: Save }) {
  const subscription = club.subscription!;
  const [error, setError] = useState("");
  async function voidPayment(paymentId: string) {
    if (!window.confirm("Анулирате това плащане? Месеците му отново ще са неплатени. Записът ще остане в историята.")) return;
    setError("");
    try { await save({ action: "void", paymentId }); } catch (err) { setError((err as Error).message); }
  }
  return <>
    <div className={styles.historyHeading}><h4>Месечни такси</h4><span>График на промените</span></div>
    <ul className={styles.feeHistory}>{[...subscription.fees].sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth)).map((fee) => <li key={fee.effectiveMonth}>
      <span>В сила от <strong>{monthLabel(fee.effectiveMonth)}</strong></span><strong>{fee.amount} <small>EUR / месец</small></strong>
    </li>)}</ul>
    <div className={styles.historyHeading}><h4>Плащания</h4><span>{subscription.payments.length} записа</span></div>
    <p className={styles.hint}>Сумите за платените месеци са запазени към момента на плащането и може да се различават от текущата такса.</p>
    {!subscription.payments.length && <p className={styles.emptyHistory}>Няма записани плащания.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.paymentHistory}>
      {[...subscription.payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt)).map((payment) => <article className={styles.payment} data-voided={Boolean(payment.voidedAt)} key={payment.id}>
        <div className={styles.paymentHeader}>
          <div><span className={styles.historyLabel}>Дата на плащане</span><time dateTime={payment.paidOn}>{dateLabel(payment.paidOn)}</time></div>
          <strong className={styles.paymentAmount}>{payment.total} <small>EUR</small></strong>
        </div>
        <div className={styles.paymentStatus}>
          <span className={styles.badge} data-status={payment.voidedAt ? "trial_expired" : "active"}>{payment.voidedAt ? "Анулирано" : "Платено"}</span>
          {payment.voidedAt && <span>на {dateLabel(payment.voidedAt)}</span>}
        </div>
        <details className={styles.paymentMonths} open>
          <summary>Месеци в плащането ({payment.months.length})</summary>
          <ul>{[...payment.months].sort((a, b) => a.month.localeCompare(b.month)).map((month) => <li key={month.month}><span>{monthLabel(month.month)}</span><strong>{month.amount} EUR</strong></li>)}</ul>
        </details>
        {payment.note && <div className={styles.paymentNote}><span className={styles.historyLabel}>Бележка</span><p>{payment.note}</p></div>}
        {!payment.voidedAt && <div className={styles.paymentFooter}><button className={styles.voidButton} type="button" disabled={busy} onClick={() => void voidPayment(payment.id)}>Анулирай плащането</button></div>}
      </article>)}
    </div>
    <div className={styles.historyHeading}><h4>Административна история</h4><span>Кой и кога</span></div>
    <p className={styles.hint}>Показва се идентификаторът на акаунта, използван при промяната. Споделените акаунти не идентифицират отделен човек.</p>
    {!subscription.changes?.length && <p className={styles.emptyHistory}>Няма записани промени.</p>}
    <ol className={styles.auditHistory}>{subscription.changes?.map((entry) => <li key={entry.id}>
      <div className={styles.paymentHeader}><strong>{subscriptionAuditLabels[entry.action] ?? "Промяна"}</strong><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("bg-BG", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Sofia" }).format(new Date(entry.createdAt))}</time></div>
      <p>{subscriptionAuditDescription(entry)}</p>
      <span className={styles.historyLabel}>Акаунт: {entry.actorId === "migration" ? "Системна миграция" : entry.actorId === "env-admin" ? "Администратор (системен акаунт)" : entry.actorId}</span>
    </li>)}</ol>
  </>;
}
