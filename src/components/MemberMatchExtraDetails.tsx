import { matchCategoryLabel } from "@/lib/matchCategory";

type Props = { category?: string | null; description?: string };

export default function MemberMatchExtraDetails({ category, description }: Props) {
  return <>
    <div className="match-details-row">
      <span className="match-details-label">Характер на срещата</span>
      <span className="match-details-value">{matchCategoryLabel(category)}</span>
    </div>
    {description && <div className="match-details-row">
      <span className="match-details-label">Описание</span>
      <span className="match-details-value" style={{ whiteSpace: "pre-wrap" }}>{description}</span>
    </div>}
  </>;
}
