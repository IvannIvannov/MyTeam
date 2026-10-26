"use client";

import { useId } from "react";
import { localToday, parseSubscriptionSetup, SubscriptionError } from "@/lib/clubSubscriptionDomain";
import styles from "./SubscriptionSetupFields.module.css";

export type SubscriptionDraft = { mode: "trial" | "paid" | "contract"; trialChoice: "" | "limited" | "unlimited"; trialEndDate: string; firstBillingMonth: string; amount: string };
export function defaultTrialDraft(): SubscriptionDraft {
  return { mode: "trial", trialChoice: "", trialEndDate: "", firstBillingMonth: localToday().slice(0, 7), amount: "" };
}
export function setupFromDraft(value: SubscriptionDraft) {
  if (value.mode === "trial" && !value.trialChoice) throw new SubscriptionError("Изберете ограничен пробен период или без крайна дата.");
  if (value.mode === "contract") return parseSubscriptionSetup({ mode: "contract" });
  return parseSubscriptionSetup(value.mode === "trial" ? { mode: "trial", trialEndDate: value.trialChoice === "unlimited" ? null : value.trialEndDate }
    : { mode: "paid", firstBillingMonth: value.firstBillingMonth, amount: value.amount });
}

export default function SubscriptionSetupFields({ value, onChange, disabled = false, fixedMode }: {
  value: SubscriptionDraft; onChange: (value: SubscriptionDraft) => void; disabled?: boolean; fixedMode?: "trial" | "paid";
}) {
  const id = useId();
  return <fieldset disabled={disabled} className={styles.fields}>
    <legend>{fixedMode === "trial" ? "Пробен период" : fixedMode === "paid" ? "Платен абонамент" : "Вид абонамент"}</legend>
    {!fixedMode && <label htmlFor={`${id}-mode`}>Абонамент
      <select id={`${id}-mode`} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as SubscriptionDraft["mode"] })}>
        <option value="trial">Безплатен пробен период</option><option value="paid">Платен абонамент</option><option value="contract">С договор</option>
      </select>
    </label>}
    {value.mode === "trial" ? <>
      <label htmlFor={`${id}-choice`}>Продължителност
        <select id={`${id}-choice`} value={value.trialChoice} onChange={(e) => onChange({ ...value, trialChoice: e.target.value as SubscriptionDraft["trialChoice"] })}>
          <option value="">Изберете продължителност</option><option value="limited">До определена дата</option><option value="unlimited">Без крайна дата</option>
        </select>
      </label>
      {value.trialChoice === "limited" && <label htmlFor={`${id}-end`}>Последен ден (включително)
        <input id={`${id}-end`} type="date" required value={value.trialEndDate} onChange={(e) => onChange({ ...value, trialEndDate: e.target.value })} />
      </label>}
    </> : value.mode === "contract" ? <p>Таксуването се управлява извън приложението. Не се изпращат известия за абонамент.</p> : <>
      <label htmlFor={`${id}-amount`}>Месечна такса (EUR)
        <input id={`${id}-amount`} type="text" inputMode="decimal" required placeholder="0.00" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
      </label>
      <label htmlFor={`${id}-first`}>Първи месец за плащане
        <input id={`${id}-first`} type="month" min="2000-01" max="2199-12" required value={value.firstBillingMonth} onChange={(e) => onChange({ ...value, firstBillingMonth: e.target.value })} />
      </label>
      <p>Плащане се записва отделно с „Маркирай като платено“.</p>
    </>}
  </fieldset>;
}
