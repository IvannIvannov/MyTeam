import type { Prisma } from "@prisma/client";

export type MatchScope = { clubId: string; customGroupId: string | null; teamGroups: number[] };
export type MatchAttendance = { present: boolean; reasonCode: string | null; reasonText: string | null };
export const MATCH_ABSENCE_REASONS = { injury: "Контузия", sick: "Болен", other: "Друго" } as const;

export function matchPlayerWhere(match: MatchScope): Prisma.PlayerWhereInput {
  return {
    clubId: match.clubId,
    isActive: true,
    ...(match.customGroupId
      ? { customTrainingGroups: { some: { groupId: match.customGroupId } } }
      : match.teamGroups.length ? { teamGroup: { in: match.teamGroups } } : {}),
  };
}

export function parseMatchAttendance(raw: unknown): MatchAttendance | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Невалидно присъствие." };
  const body = raw as Record<string, unknown>;
  if (typeof body.present !== "boolean") return { error: "Невалидно присъствие." };
  if (body.present) return { present: true, reasonCode: null, reasonText: null };
  const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode.trim().toLowerCase() : "";
  if (reasonCode !== "injury" && reasonCode !== "sick" && reasonCode !== "other") return { error: "Изберете причина за отсъствие." };
  const reasonText = typeof body.reasonText === "string" ? body.reasonText.trim() : "";
  if (reasonCode === "other" && (!reasonText || reasonText.length > 200)) return { error: "Въведете причина до 200 символа." };
  return { present: false, reasonCode, reasonText: reasonCode === "other" ? reasonText : null };
}
