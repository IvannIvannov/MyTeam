type CalendarDay = {
  date: string;
  sessions?: { id: string }[];
  stats: { total: number; attending: number; optedOut: number };
};

export function mergeTrainingCalendarDates<T extends CalendarDay>(legacy: T[], coach: T[]): (T & { trainingCount: number })[] {
  const days = new Map<string, T & { trainingCount: number }>();
  for (const day of legacy) days.set(day.date, { ...day, trainingCount: day.sessions?.length || 1 });
  for (const day of coach) {
    const existing = days.get(day.date);
    days.set(day.date, {
      ...existing, ...day,
      sessions: day.sessions,
      trainingCount: (existing?.trainingCount ?? 0) + (day.sessions?.length || 1),
      stats: {
        total: (existing?.stats.total ?? 0) + day.stats.total,
        attending: (existing?.stats.attending ?? 0) + day.stats.attending,
        optedOut: (existing?.stats.optedOut ?? 0) + day.stats.optedOut,
      },
    });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
