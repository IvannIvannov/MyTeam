import type { GroupAssignmentFeePreview } from "@/lib/groupAssignmentFees";

export default function GroupAssignmentFeeNotice({ rows, clubAmount, busy, onChoice }: {
  rows: GroupAssignmentFeePreview[];
  clubAmount: string;
  busy: boolean;
  onChoice: (playerId: string, groupId: string) => void;
}) {
  if (!rows.length) return null;
  const unresolved = rows.filter((row) => row.fee.source === "conflict").length;
  return <section className="amp-assignment-fees" aria-label="Месечни такси при промяна на група" aria-live="polite">
    <h3>Месечни такси при промяна на група</h3>
    {unresolved > 0 && <p className="amp-assignment-fees-warning" role="alert">
      {unresolved} {unresolved === 1 ? "състезател участва" : "състезатели участват"} в групи с различни такси. Изберете от коя група да се взема таксата за всеки състезател. След това натиснете „Запази“ — групите и изборът на такса ще се запазят заедно.
    </p>}
    {rows.map((row) => <div className="amp-assignment-fee-row" key={row.id}>
      <strong>{row.fullName}</strong>
      {row.fee.source === "personal" ? <p>Личната такса {row.fee.amount} € се запазва. Групите няма да я променят.</p> : <>
        {row.groups.length > 1 && <label className="amp-edit-field amp-edit-field--full">
          <span className="amp-lbl">Група за таксата на {row.fullName}</span>
          <select className="amp-edit-input" value={row.billingCoachGroupId ?? ""} disabled={busy} onChange={(e) => onChoice(row.id, e.target.value)}>
            <option value="" disabled>{row.fee.source === "conflict" ? "Изберете група за таксата" : "Групите имат еднаква такса"}</option>
            {row.groups.map((group) => <option key={group.id} value={group.id}>{group.name} — {group.paymentAmount ?? clubAmount} €</option>)}
          </select>
        </label>}
        {row.fee.source !== "conflict" && <p>Месечна такса: {row.fee.amount} €{row.billingCoachGroupId ? ". Следва бъдещите промени на избраната група." : "."}</p>}
      </>}
    </div>)}
    <p className="amp-confirm-text">Промените ще се приложат само след „Запази“.</p>
  </section>;
}
