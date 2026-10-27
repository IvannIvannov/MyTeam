export const PLAYER_FIELDS = ["rank", "weight", "jerseyNumber", "teamGroup"] as const;
export type PlayerField = typeof PLAYER_FIELDS[number];
export const PLAYER_FIELD_LABELS: Record<PlayerField, string> = {
  rank: "Степен", weight: "Тегло (кг)", jerseyNumber: "Номер в отбора", teamGroup: "Набор",
};
export const LEGACY_PLAYER_FIELDS: PlayerField[] = ["jerseyNumber", "teamGroup"];
export function playerFieldEnabled(settings: { playerFields?: readonly string[] } | null | undefined, field: PlayerField): boolean {
  return (settings?.playerFields ?? LEGACY_PLAYER_FIELDS).includes(field);
}
export function parsePlayerFields(raw: unknown): PlayerField[] {
  if (!Array.isArray(raw) || raw.some(field => !PLAYER_FIELDS.includes(field as PlayerField))) {
    throw new Error("Невалиден избор на полета за състезателите.");
  }
  return [...new Set(raw)] as PlayerField[];
}
export function parsePlayerWeight(raw: unknown): number | null {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return null;
  if (typeof raw !== "number" && typeof raw !== "string") throw new Error("Теглото трябва да е положително число в килограми.");
  const value = Number(typeof raw === "string" ? raw.trim().replace(",", ".") : raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Теглото трябва да е положително число в килограми.");
  return value;
}
export const HIDE_TEAM_GROUP_ERROR = "Преди да скриете полето „Набор“, сменете начина на групиране на „По избрани групи“ от „Настройки на групите“.";
export const ENABLE_TEAM_GROUP_ERROR = "За графици по набори включете полето „Набор“ от редакцията на клуба.";

export class PlayerFieldError extends Error {}
export function optionalPlayerUpdates(body: Record<string, unknown>, settings: { playerFields?: readonly string[] }) {
  const data: { rank?: string | null; weight?: number | null; jerseyNumber?: string | null; teamGroup?: number | null } = {};
  for (const field of PLAYER_FIELDS) {
    if (!playerFieldEnabled(settings, field) || !Object.prototype.hasOwnProperty.call(body, field)) continue;
    const raw = body[field];
    if (field === "weight") {
      try { data.weight = parsePlayerWeight(raw); } catch (error) { throw new PlayerFieldError((error as Error).message); }
    } else if (field === "teamGroup") {
      const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isInteger(value) || value <= 0 || value > 9999)) throw new PlayerFieldError("Наборът трябва да е валидна година.");
      data.teamGroup = value;
    } else {
      if (raw !== null && raw !== undefined && typeof raw !== "string" && typeof raw !== "number") throw new PlayerFieldError("Невалидна стойност на полето.");
      data[field] = raw === null || raw === undefined ? null : String(raw).trim() || null;
    }
  }
  return data;
}
