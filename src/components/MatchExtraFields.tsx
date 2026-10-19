"use client";

type Props = { description: string; category: string; disabled?: boolean; onChange: (fields: { description: string; category: string }) => void };
export default function MatchExtraFields({ description, category, disabled, onChange }: Props) {
  return <>
    <div className="amp-edit-field">
      <span className="amp-lbl">Характер на срещата *</span>
      <div role="group" aria-label="Характер на срещата" style={{ display: "flex", gap: 8 }}>
        {[["friendly", "Контрола"], ["official", "Официален"]].map(([value, label]) => <button key={value} type="button" aria-pressed={category === value} disabled={disabled} className={`amp-btn ${category === value ? "amp-btn--primary amp-btn--match" : "amp-btn--ghost"}`} onClick={() => onChange({ description, category: value })}>{label}</button>)}
      </div>
    </div>
    <label className="amp-edit-field"><span className="amp-lbl">Описание</span><textarea className="amp-edit-input" rows={3} maxLength={2000} value={description} disabled={disabled} onChange={(event) => onChange({ description: event.target.value, category })} placeholder="Допълнителна информация за събитието" /></label>
  </>;
}
