import { parsePaymentAmount } from "@/lib/paymentAmount";

type FeeSnapshot = {
  paymentAmount: string;
  groups: { id: string; paymentAmount: string | null }[];
  players: { id: string; paymentAmount: string; billingCoachGroupId: string | null; coachGroupIds: string[] }[];
};
type FeeDraft = {
  clubAmount: string;
  groupFees: Record<string, string>;
  personalFees: Record<string, string>;
  choices: Record<string, string>;
  assignments?: Record<string, string[]>;
  deleteGroupId?: string;
};

function money(value: string) {
  return parsePaymentAmount(value) ?? `invalid:${value.trim()}`;
}
function optionalMoney(value: string | null) {
  return value === null || value.trim() === "" ? null : money(value);
}
function sameMemberships(a: string[], b: string[]) {
  const ids = new Set(a);
  return ids.size === new Set(b).size && b.every((id) => ids.has(id));
}

export function hasUnsavedFeeChanges(settings: FeeSnapshot | null, draft: FeeDraft): boolean {
  if (draft.deleteGroupId) return true;
  if (!settings) return Boolean(draft.assignments && Object.keys(draft.assignments).length);
  if (money(draft.clubAmount) !== money(settings.paymentAmount)) return true;
  const groups = new Map(settings.groups.map((g) => [g.id, g]));
  if (Object.entries(draft.groupFees).some(([id, value]) => optionalMoney(value) !== optionalMoney(groups.get(id)?.paymentAmount ?? null))) return true;
  const players = new Map(settings.players.map((p) => [p.id, p]));
  if (Object.entries(draft.personalFees).some(([id, value]) => money(value) !== money(players.get(id)?.paymentAmount ?? "0"))) return true;
  if (Object.entries(draft.choices).some(([id, value]) => value !== (players.get(id)?.billingCoachGroupId ?? ""))) return true;
  return Object.entries(draft.assignments ?? {}).some(([id, ids]) => !sameMemberships(ids, players.get(id)?.coachGroupIds ?? []));
}
