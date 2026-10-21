import { isIsoDate } from "./training";

// Import dates denote midnight in Sofia, independent of the machine's time zone.
export function parseAttendanceStartDate(raw: string): Date | null {
  const input = raw.trim();
  if (!input) return null;
  const match = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const date = match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : input;
  if (!isIsoDate(date)) throw new Error("Невалидна начална дата на участие. Използвайте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.");
  const midnight = new Date(`${date}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hourCycle: "h23" }).format(midnight));
  return new Date(midnight.getTime() - hour * 3600000);
}
