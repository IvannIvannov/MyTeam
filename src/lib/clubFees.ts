import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { parsePaymentAmount } from "@/lib/paymentAmount";
import { resolveMemberFee } from "@/lib/memberFee";

export type FeeConflict = { id: string; fullName: string; groups: { id: string; name: string; amount: string }[] };
export class FeeSettingsError extends Error {
  constructor(message: string, public status = 400, public conflicts: FeeConflict[] = []) { super(message); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeeSettingsError("Невалидни настройки за такси.");
  return value as Record<string, unknown>;
}
function amount(value: unknown) {
  const parsed = parsePaymentAmount(value);
  if (parsed === null) throw new FeeSettingsError("Въведете валидна сума с до 2 десетични знака.");
  return parsed;
}
function feeRevision(clubAmount: string, groups: { id: string; paymentAmount: string | null }[], players: { id: string; paymentAmount: string; billingCoachGroupId: string | null; coachGroupIds: string[] }[]) {
  return createHash("sha256").update(JSON.stringify({
    club: clubAmount,
    groups: groups.map((g) => [g.id, g.paymentAmount]).sort(),
    players: players.map((p) => [p.id, p.paymentAmount, p.billingCoachGroupId, [...p.coachGroupIds].sort()]).sort(),
  })).digest("hex");
}

// A club row lock serializes fee edits and membership changes using this service.
export async function updateClubFees(clubId: string, input: unknown) {
  const body = record(input);
  return prisma.$transaction(async (tx) => {
    const clubs = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clubs WHERE id::text = ${clubId} FOR UPDATE`;
    if (!clubs.length) throw new FeeSettingsError("Club not found", 404);
    const club = await tx.club.findUniqueOrThrow({ where: { id: clubId } });
    const groups = await tx.coachGroup.findMany({ where: { clubId }, orderBy: { name: "asc" } });
    const players = await tx.player.findMany({ where: { clubId }, include: { coachGroups: true }, orderBy: { fullName: "asc" } });
    const revision = feeRevision(club.defaultPaymentAmount.toFixed(2),
      groups.map((g) => ({ id: g.id, paymentAmount: g.paymentAmount?.toFixed(2) ?? null })),
      players.map((p) => ({ id: p.id, paymentAmount: p.paymentAmount.toFixed(2), billingCoachGroupId: p.billingCoachGroupId, coachGroupIds: p.coachGroups.map((g) => g.id) })));
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) {
      throw new FeeSettingsError("Настройките са променени от друг потребител. Затворете прозореца и го отворете отново.", 409);
    }
    const clubAmount = body.paymentAmount === undefined ? club.defaultPaymentAmount.toFixed(2) : amount(body.paymentAmount);
    const groupFees = body.groupFees === undefined ? {} : record(body.groupFees);
    const personalFees = body.personalFees === undefined ? {} : record(body.personalFees);
    const choices = body.billingChoices === undefined ? {} : record(body.billingChoices);
    const assignments = body.assignments === undefined ? {} : record(body.assignments);
    const groupIds = new Set(groups.map((g) => g.id));
    const deletedGroupId = body.deleteGroupId;
    if (deletedGroupId !== undefined && (typeof deletedGroupId !== "string" || !groupIds.has(deletedGroupId))) throw new FeeSettingsError("Coach group not found", 404);
    const playerIds = new Set(players.map((p) => p.id));
    const playersById = new Map(players.map((p) => [p.id, p]));
    for (const id of Object.keys(groupFees)) if (!groupIds.has(id)) throw new FeeSettingsError("Coach group not found", 404);
    for (const id of [...Object.keys(personalFees), ...Object.keys(choices), ...Object.keys(assignments)]) {
      if (!playerIds.has(id)) throw new FeeSettingsError("Member not found", 404);
    }
    const proposedGroups = groups.filter((g) => g.id !== deletedGroupId).map((g) => ({ id: g.id, name: g.name,
      paymentAmount: Object.hasOwn(groupFees, g.id) ? (groupFees[g.id] === null || groupFees[g.id] === "" ? null : amount(groupFees[g.id])) : g.paymentAmount?.toFixed(2) ?? null,
    }));
    const conflicts: FeeConflict[] = [];
    const proposedPlayers = players.map((p) => {
      let ids = p.coachGroups.map((g) => g.id).filter((id) => id !== deletedGroupId);
      if (Object.hasOwn(assignments, p.id)) {
        const raw = assignments[p.id];
        if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !groupIds.has(id) || id === deletedGroupId)) throw new FeeSettingsError("Invalid coach groups");
        ids = [...new Set(raw as string[])];
      }
      const memberships = proposedGroups.filter((g) => ids.includes(g.id));
      let billingCoachGroupId = p.billingCoachGroupId && ids.includes(p.billingCoachGroupId) ? p.billingCoachGroupId : null;
      if (Object.hasOwn(choices, p.id)) {
        const selected = choices[p.id];
        if (selected !== null && (typeof selected !== "string" || !ids.includes(selected))) throw new FeeSettingsError("Избраната група не принадлежи на състезателя.");
        billingCoachGroupId = selected as string | null;
      }
      const paymentAmount = Object.hasOwn(personalFees, p.id) ? amount(personalFees[p.id]) : p.paymentAmount.toFixed(2);
      const fee = resolveMemberFee({ paymentAmount, billingCoachGroupId, coachGroups: memberships }, clubAmount);
      if (fee.source === "conflict") conflicts.push({ id: p.id, fullName: p.fullName, groups: memberships.map((g) => ({ id: g.id, name: g.name, amount: g.paymentAmount ?? clubAmount })) });
      return { id: p.id, fullName: p.fullName, paymentAmount, billingCoachGroupId, coachGroupIds: ids, effectiveAmount: fee.amount, source: fee.source, isActive: p.isActive, teamGroup: p.teamGroup };
    });
    if (body.preview !== true) {
      if (conflicts.length) throw new FeeSettingsError("Изберете такса за състезателите в групи с различни такси.", 409, conflicts);
      if (body.paymentAmount !== undefined) await tx.club.update({ where: { id: clubId }, data: { defaultPaymentAmount: clubAmount } });
      for (const group of proposedGroups) if (Object.hasOwn(groupFees, group.id)) await tx.coachGroup.update({ where: { id: group.id }, data: { paymentAmount: group.paymentAmount } });
      for (const p of proposedPlayers) {
        const original = playersById.get(p.id)!;
        if (Object.hasOwn(personalFees, p.id) || Object.hasOwn(choices, p.id) || Object.hasOwn(assignments, p.id) || original.billingCoachGroupId !== p.billingCoachGroupId) {
          await tx.player.update({ where: { id: p.id }, data: {
            ...(Object.hasOwn(personalFees, p.id) ? { paymentAmount: p.paymentAmount } : {}),
            billingCoachGroupId: p.billingCoachGroupId,
            ...(Object.hasOwn(assignments, p.id) ? { coachGroups: {
              disconnect: original.coachGroups.filter((group) => !p.coachGroupIds.includes(group.id)).map((group) => ({ id: group.id })),
              connect: p.coachGroupIds.filter((id) => !original.coachGroups.some((group) => group.id === id)).map((id) => ({ id })),
            } } : {}),
          } });
        }
      }
      if (typeof deletedGroupId === "string") await tx.coachGroup.delete({ where: { id: deletedGroupId } });
    }
    return { paymentAmount: clubAmount, groups: proposedGroups, players: proposedPlayers, conflicts,
      revision: body.preview === true ? revision : feeRevision(clubAmount, proposedGroups, proposedPlayers) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
