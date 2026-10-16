"use client";

import { useEffect, useRef, useState } from "react";
import { resolveMemberFee } from "@/lib/memberFee";

type Group = { id: string; name: string; paymentAmount: string | null };
type Player = { id: string; fullName: string; paymentAmount: string; billingCoachGroupId: string | null; coachGroupIds: string[]; isActive: boolean };
type Settings = { paymentAmount: string; groups: Group[]; players: Player[]; revision: string };

export default function MonthlyFeeModal({ clubId, assignments, deleteGroupId, onClose, onSaved }: {
  clubId: string;
  assignments?: Record<string, string[]>;
  deleteGroupId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clubAmount, setClubAmount] = useState("");
  const [groupFees, setGroupFees] = useState<Record<string, string>>({});
  const [personalFees, setPersonalFees] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [editingPersonal, setEditingPersonal] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const url = `/api/admin/clubs/${encodeURIComponent(clubId)}/payment-amount`;
  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!active) return;
      if (!response.ok) throw new Error(data.error ?? "Грешка при зареждане.");
      setSettings(data);
      setClubAmount(data.paymentAmount);
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : "Грешка при зареждане."); });
    // Ignore late responses on close, club changes, and Strict Mode cleanup.
    // Aborting fetch here can surface a spurious AbortError in the dev overlay.
    return () => { active = false; };
  }, [url]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  const groups = (settings?.groups ?? []).filter((g) => g.id !== deleteGroupId).map((g) => ({ ...g, paymentAmount: Object.hasOwn(groupFees, g.id) ? groupFees[g.id] || null : g.paymentAmount }));
  const rows = (settings?.players ?? []).map((p) => {
    const ids = (assignments?.[p.id] ?? p.coachGroupIds).filter((id) => id !== deleteGroupId);
    const memberships = groups.filter((g) => ids.includes(g.id));
    const selected = choices[p.id] ?? (ids.includes(p.billingCoachGroupId ?? "") ? p.billingCoachGroupId : null);
    const personal = personalFees[p.id] ?? p.paymentAmount;
    const hasDifferentGroupFees = resolveMemberFee({ paymentAmount: 0, coachGroups: memberships }, clubAmount).source === "conflict";
    return { ...p, personal, selected, memberships, hasDifferentGroupFees, fee: resolveMemberFee({ paymentAmount: personal, billingCoachGroupId: selected, coachGroups: memberships }, clubAmount) };
  });
  const conflicts = rows.filter((p) => p.fee.source === "conflict");
  const visible = rows.filter((p) => p.fullName.toLocaleLowerCase("bg").includes(search.toLocaleLowerCase("bg")));
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expectedRevision: settings?.revision,
        ...(clubAmount !== settings?.paymentAmount ? { paymentAmount: clubAmount } : {}), groupFees, personalFees,
        billingChoices: choices, ...(assignments ? { assignments } : {}), ...(deleteGroupId ? { deleteGroupId } : {}),
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Грешка при запазване.");
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Грешка при запазване."); }
    finally { setBusy(false); }
  }
  const moneyInput = (label: string, value: string, change: (value: string) => void, placeholder?: string) => (
    <label className="amp-edit-field amp-edit-field--full"><span className="amp-lbl">{label}</span>
      <div className="amp-money-input-wrap"><span className="amp-money-input-icon">€</span><input className="amp-edit-input amp-money-input" type="number" min="0" step="0.01" value={value} placeholder={placeholder} disabled={busy} onChange={(e) => change(e.target.value)} /></div>
    </label>
  );
  return <div className="amp-overlay" style={{ zIndex: 150 }} onClick={() => { if (!busy) onClose(); }}>
    <div ref={dialog} className="amp-modal amp-modal--confirm" role="dialog" aria-modal="true" aria-labelledby="monthly-fee-title" tabIndex={-1} style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <div className="amp-modal-tint" aria-hidden="true" />
      <h2 className="amp-modal-title" id="monthly-fee-title"><span className="amp-modal-title-gradient">Месечна такса</span><button type="button" className="amp-modal-close" aria-label="Затвори" disabled={busy} onClick={onClose}>×</button></h2>
      <div className="amp-modal-body" style={{ maxHeight: "75vh", overflowY: "auto" }}>
        {!settings && !error && <p role="status">Зареждане...</p>}
        {settings && <>
          {assignments && <p className="amp-confirm-text">Промените в групите ще се запазят заедно с избраните такси.</p>}
          {assignments && <p className="amp-assignment-fees-warning" role="status">Промяната на групите изисква преглед на месечните такси. Изберете група за всеки състезател с различни такси в секцията „Избор на такса“ по-долу, след което натиснете „Запази“. Дотогава нищо не се променя.</p>}
          {deleteGroupId && <p className="amp-confirm-text">Групата ще бъде изтрита след запазване на новия избор на такси.</p>}
          {moneyInput("Сума за клуба", clubAmount, setClubAmount)}
          <p className="amp-confirm-text">Стандартната такса се използва, когато няма лична или групова такса. Личните такси не се променят автоматично.</p>
          <h3>Такси за групи треньори</h3>
          {groups.length === 0 && <p>Няма групи треньори.</p>}
          {groups.map((g) => <div key={g.id}>{moneyInput(g.name, g.paymentAmount ?? "", (value) => setGroupFees((prev) => ({ ...prev, [g.id]: value })), `Стандартна: ${clubAmount} €`)}</div>)}
          <p className="amp-confirm-text">Празна групова такса използва стандартната сума за клуба.</p>
          {conflicts.length > 0 && <div role="alert"><h3>Избор на такса за {conflicts.length} {conflicts.length === 1 ? "състезател" : "състезатели"}</h3><p>Тези състезатели участват в групи с различни такси. Изберете група за всеки преди запазване.</p>
            {conflicts.map((p) => <label key={p.id} className="amp-edit-field amp-edit-field--full"><span className="amp-lbl">{p.fullName}{!p.isActive ? " (неактивен)" : ""}</span><select className="amp-edit-input" value={choices[p.id] ?? ""} disabled={busy} onChange={(e) => setChoices((prev) => ({ ...prev, [p.id]: e.target.value }))}><option value="">Изберете група</option>{p.memberships.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.paymentAmount ?? clubAmount} €</option>)}</select></label>)}
          </div>}
          <h3>Лични такси ({rows.filter((p) => Number(p.personal) > 0).length}) и избор на група</h3>
          <label className="amp-edit-field"><span className="amp-lbl">Търсене на състезател</span><input className="amp-edit-input" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          {visible.filter((p) => Number(p.personal) > 0 || editingPersonal[p.id] || p.hasDifferentGroupFees).map((p) => <div key={p.id} style={{ paddingBlock: 10, borderBottom: "1px solid #ffffff20" }}>
            <strong>{p.fullName}{!p.isActive ? " (неактивен)" : ""}</strong>
            <p>{Number(p.personal) > 0 ? `Лична такса: ${p.personal} € — запазва се независимо от групите.` : `Такса: ${p.fee.amount ?? "изберете група"}${p.fee.amount ? " €" : ""}`}</p>
            <button className="amp-btn amp-btn--ghost" type="button" disabled={busy} onClick={() => setEditingPersonal((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}>{editingPersonal[p.id] ? "Скрий редакцията" : "Редактирай лична такса"}</button>
            {editingPersonal[p.id] && <>{moneyInput("Лична такса (0 = без лична такса)", p.personal, (value) => setPersonalFees((prev) => ({ ...prev, [p.id]: value })))}<button className="amp-btn amp-btn--ghost" type="button" disabled={busy} onClick={() => setPersonalFees((prev) => ({ ...prev, [p.id]: "0" }))}>Използвай групова / клубна такса</button></>}
            {p.hasDifferentGroupFees && p.fee.source !== "conflict" && <label className="amp-edit-field"><span className="amp-lbl">Група за таксата{Number(p.personal) > 0 ? " (при премахване на личната такса)" : ""}</span><select className="amp-edit-input" disabled={busy} value={p.selected ?? ""} onChange={(e) => setChoices((prev) => ({ ...prev, [p.id]: e.target.value }))}><option value="" disabled>Еднакви такси / без избрана група</option>{p.memberships.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.paymentAmount ?? clubAmount} €</option>)}</select></label>}
          </div>)}
          {!search.trim() && <p className="amp-confirm-text">Потърсете състезател, за да зададете нова лична такса.</p>}
          {search.trim() && visible.filter((p) => Number(p.personal) === 0 && !editingPersonal[p.id] && !p.hasDifferentGroupFees).map((p) => <div key={p.id} style={{ paddingBlock: 6 }}><span>{p.fullName} — {p.fee.amount} € </span><button type="button" className="amp-btn amp-btn--ghost" disabled={busy} onClick={() => setEditingPersonal((prev) => ({ ...prev, [p.id]: true }))}>Задай лична такса</button></div>)}
        </>}
        {error && <p className="amp-confirm-error" role="alert">{error}</p>}
        <div className="amp-modal-actions"><button type="button" className="amp-btn amp-btn--ghost" disabled={busy} onClick={onClose}>Отказ</button><button type="button" className="amp-btn amp-btn--primary" disabled={busy || !settings || conflicts.length > 0} onClick={() => void save()}>{busy ? "Запазване..." : "Запази"}</button></div>
      </div>
    </div>
  </div>;
}
