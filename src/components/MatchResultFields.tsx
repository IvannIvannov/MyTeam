"use client";

export function MatchResultFields({ isHome, opponent, homeScore, awayScore, onChange, disabled }: {
  isHome: boolean; opponent: string; homeScore: string; awayScore: string;
  onChange: (homeScore: string, awayScore: string) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="match-result-fields">
    <legend className="amp-lbl">Резултат (домакин : гост)</legend>
    <div className="match-result-inputs">
      <label className="amp-edit-field"><span className="amp-lbl">Домакин · {isHome ? "Нашият отбор" : opponent || "Съперник"}</span><input type="number" inputMode="numeric" className="amp-edit-input" min={0} max={999} step={1} placeholder="—" value={homeScore} onChange={(event) => onChange(event.target.value, awayScore)} /></label>
      <span aria-hidden="true">:</span>
      <label className="amp-edit-field"><span className="amp-lbl">Гост · {isHome ? opponent || "Съперник" : "Нашият отбор"}</span><input type="number" inputMode="numeric" className="amp-edit-input" min={0} max={999} step={1} placeholder="—" value={awayScore} onChange={(event) => onChange(homeScore, event.target.value)} /></label>
    </div>
  </fieldset>;
}
