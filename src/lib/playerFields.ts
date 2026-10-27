export const PLAYER_FIELDS = ["rank", "weight", "age", "jerseyNumber", "teamGroup"] as const;
export type PlayerField = typeof PLAYER_FIELDS[number];
export const PLAYER_FIELD_LABELS: Record<PlayerField, string> = {
  age: "Възраст", rank: "Степен", weight: "Тегло (кг)", jerseyNumber: "Номер в отбора", teamGroup: "Набор",
};
export const LEGACY_PLAYER_FIELDS: PlayerField[] = ["jerseyNumber", "teamGroup"];
export function playerFieldEnabled(settings: { playerFields?: readonly string[] } | null | undefined, field: PlayerField): boolean {
  if (field === "age") return true;
  return (settings?.playerFields ?? LEGACY_PLAYER_FIELDS).includes(field);
}
export function parsePlayerFields(raw: unknown): PlayerField[] {
  if (!Array.isArray(raw) || raw.some(field => !PLAYER_FIELDS.includes(field as PlayerField))) {
    throw new Error("Невалиден избор на полета за състезателите.");
  }
  return [...new Set(raw)].filter(field => field !== "age") as PlayerField[];
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
    if (field === "age") continue;
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

export function calculatePlayerAge(birthDate: Date | string | null | undefined, today = new Date()): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  // Birthdates are calendar dates; take today's date in the club's timezone.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(today);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  let age = year - birth.getUTCFullYear();
  if (month < birth.getUTCMonth() + 1 ||
      (month === birth.getUTCMonth() + 1 && day < birth.getUTCDate())) age--;
  return age < 0 ? null : age;
}

// Recalculate the stored age when the birthdate changes.
export function playerAgeForBirthDate(birthDate: Date | null, previous: Date | string | null | undefined) {
  const previousDate = previous ? new Date(previous).toISOString().slice(0, 10) : null;
  return (birthDate?.toISOString().slice(0, 10) ?? null) === previousDate
    ? {} : { age: calculatePlayerAge(birthDate) };
}
