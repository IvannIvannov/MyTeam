import { getTodayIsoDateInTimeZone } from "./training";

export function getMatchScheduleRange(): { from: string; to: string } {
  const from = getTodayIsoDateInTimeZone("Europe/Sofia");
  const start = new Date(`${from}T00:00:00.000Z`);
  const nextYear = start.getUTCFullYear() + 1;
  const month = start.getUTCMonth();
  const lastDay = new Date(Date.UTC(nextYear, month + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(nextYear, month, Math.min(start.getUTCDate(), lastDay)));
  return { from, to: end.toISOString().slice(0, 10) };
}

export function getMatchCalendarDates(): string[] {
  const { from, to } = getMatchScheduleRange();
  const dates: string[] = [];
  const day = new Date(`${from}T00:00:00.000Z`);
  while (day.toISOString().slice(0, 10) <= to) {
    dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return dates;
}
