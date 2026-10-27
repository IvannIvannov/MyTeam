import { PLAYER_FIELD_LABELS, playerFieldEnabled } from "@/lib/playerFields";

export default function PlayerExtraFields({ settings, values, onChange, variant = "admin" }: {
  settings?: { playerFields?: readonly string[] } | null;
  values: { rank: string; weight: string };
  onChange: (field: "rank" | "weight", value: string) => void;
  variant?: "admin" | "add" | "member";
}) {
  const fieldClass = variant === "add" ? "add-member-field" : variant === "admin" ? "amp-edit-field" : "pm-optional-field";
  const labelClass = variant === "add" ? "add-member-label" : variant === "admin" ? "amp-lbl" : "pm-info-lbl";
  const inputClass = variant === "add" ? "add-member-input" : variant === "admin" ? "amp-edit-input" : "pm-optional-input";
  return <>{(["rank", "weight"] as const).map(field => playerFieldEnabled(settings, field) ? (
    <label className={fieldClass} key={field}>
      <span className={labelClass}>{PLAYER_FIELD_LABELS[field]}</span>
      <input className={inputClass} type="text" inputMode={field === "weight" ? "decimal" : "text"}
        value={values[field] ?? ""} onChange={event => onChange(field, event.target.value)} />
    </label>
  ) : null)}</>;
}
