import { resolveMemberFee } from "@/lib/memberFee";

export type GroupFeeSettings = {
  paymentAmount: string;
  revision: string;
  groups: { id: string; name: string; paymentAmount: string | null }[];
  players: {
    id: string; fullName: string; paymentAmount: string;
    billingCoachGroupId: string | null; coachGroupIds: string[];
    isActive: boolean; teamGroup: number | null;
  }[];
};

// Pure preview: checkbox changes never need a network request.
export function previewGroupAssignmentFees(settings: GroupFeeSettings, targetId: string, selectedIds: ReadonlySet<string>, choices: Record<string, string>) {
  const groupsById = new Map(settings.groups.map((group) => [group.id, group]));
  return settings.players.filter((p) => p.isActive && selectedIds.has(p.id) !== p.coachGroupIds.includes(targetId)).map((player) => {
    const coachGroupIds = selectedIds.has(player.id)
      ? [...new Set([...player.coachGroupIds, targetId])]
      : player.coachGroupIds.filter((id) => id !== targetId);
    const groups = coachGroupIds.map((id) => groupsById.get(id)).filter((group) => group !== undefined);
    const storedChoice = choices[player.id] ?? player.billingCoachGroupId;
    const billingCoachGroupId = storedChoice && coachGroupIds.includes(storedChoice) ? storedChoice : null;
    const fee = resolveMemberFee({ paymentAmount: player.paymentAmount, billingCoachGroupId, coachGroups: groups }, settings.paymentAmount);
    return { ...player, coachGroupIds, groups, billingCoachGroupId, fee };
  });
}

export type GroupAssignmentFeePreview = ReturnType<typeof previewGroupAssignmentFees>[number];

export function rebaseGroupAssignmentSelection(settings: GroupFeeSettings, targetId: string, intendedAssignments: Record<string, string[]>) {
  const selected = new Set(settings.players.filter((p) => p.isActive && p.coachGroupIds.includes(targetId)).map((p) => p.id));
  for (const [id, groups] of Object.entries(intendedAssignments)) {
    if (groups.includes(targetId)) selected.add(id);
    else selected.delete(id);
  }
  return selected;
}
