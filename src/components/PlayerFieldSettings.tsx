import { PLAYER_FIELDS, PLAYER_FIELD_LABELS, type PlayerField } from "@/lib/playerFields";
import styles from "./PlayerFieldSettings.module.css";

export default function PlayerFieldSettings({ value, onChange, disabled = false }: {
  value: readonly string[]; onChange: (fields: PlayerField[]) => void; disabled?: boolean;
}) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Полета за състезателите</legend>
      <p className={styles.description}>
        Изберете кои незадължителни полета да се показват в профилите и формулярите.
      </p>
      <div className={styles.options}>
        {PLAYER_FIELDS.filter(field => field !== "age").map(field => (
          <label key={field} className={styles.option}>
            <input
              className={styles.checkbox}
              type="checkbox"
              checked={value.includes(field)}
              onChange={event => onChange(
                event.target.checked
                  ? [...value.filter(item => item !== "age"), field] as PlayerField[]
                  : value.filter(item => item !== field && item !== "age") as PlayerField[],
              )}
            />
            <span>{PLAYER_FIELD_LABELS[field]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
