type TrainingDay = {
  date: string;
  trainingTime?: string;
  optedOut?: boolean;
  sessions?: { trainingTime?: string; optedOut?: boolean }[];
};

/** Interpret club schedule times in Sofia, regardless of the viewer's timezone. */
export function getTrainingDateTimeMs(date: string, time?: string): number {
  const normalizedTime = time?.trim() || "00:00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime)) return NaN;
  const wallTime = Date.parse(`${date}T${normalizedTime}:00Z`);
  if (!Number.isFinite(wallTime)) return NaN;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let instant = wallTime;
  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (name: string) => parts.find((p) => p.type === name)?.value;
    const localWallTime = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
    instant += wallTime - localWallTime;
  }
  return instant;
}

export function getTrainingCountdownCandidates(days: TrainingDay[]) {
  return days.flatMap((day) => {
    const sessions = day.sessions?.length ? day.sessions : [day];
    return sessions.filter((session) => !(session.optedOut ?? day.optedOut)).map((session) => ({
      type: "training" as const,
      date: day.date,
      time: session.trainingTime?.trim() || null,
      targetMs: getTrainingDateTimeMs(day.date, session.trainingTime),
    }));
  });
}
