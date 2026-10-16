import { parsePaymentAmount } from "@/lib/paymentAmount";

export type FeeGroup = { id: string; name: string; paymentAmount: unknown };
export type FeePlayer = {
  paymentAmount: unknown;
  billingCoachGroupId?: string | null;
  coachGroups?: FeeGroup[];
};
export const feeConflictMessage = "Изберете група за месечната такса на състезателя в настройките за месечни такси.";

export function resolveMemberFee(player: FeePlayer, clubAmount: unknown): {
  amount: string | null;
  source: "personal" | "group" | "club" | "conflict";
} {
  const personal = parsePaymentAmount(player.paymentAmount);
  if (personal !== null && Number(personal) > 0) return { amount: personal, source: "personal" };
  const fallback = parsePaymentAmount(clubAmount);
  const groups = player.coachGroups ?? [];
  const selected = groups.find((group) => group.id === player.billingCoachGroupId);
  const groupAmount = (group: FeeGroup) => parsePaymentAmount(group.paymentAmount) ?? fallback;
  if (selected) return { amount: groupAmount(selected), source: selected.paymentAmount == null ? "club" : "group" };
  if (new Set(groups.map(groupAmount)).size > 1) return { amount: null, source: "conflict" };
  if (groups.length) return { amount: groupAmount(groups[0]), source: groups[0].paymentAmount == null ? "club" : "group" };
  return { amount: fallback, source: "club" };
}
