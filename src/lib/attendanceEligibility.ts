// Compare the session's local wall clock with registration in the club time zone.
export function isEligibleForTraining(createdAt: Date | undefined, date: string, time?: string | null) {
  if (!createdAt) return true;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(createdAt);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const registeredDate = `${part("year")}-${part("month")}-${part("day")}`;
  if (date !== registeredDate) return date > registeredDate;
  // Without a start time, do not infer attendance on registration day.
  if (!time) return false;
  return `${time}:00` >= `${part("hour")}:${part("minute")}:${part("second")}`;
}

export function attendancePercentage(cells: Array<{ present: boolean } | undefined>) {
  const eligible = cells.filter((cell) => cell !== undefined);
  return eligible.length ? Math.round(eligible.filter((cell) => cell.present).length / eligible.length * 100) : null;
}

export type AttendanceMembershipPeriod = {
  scopeKey: string; joinedAt: Date | null; leftAt: Date | null;
};

export type AttendancePlayer = {
  createdAt?: Date;
  attendanceStartedAt?: Date | null;
  attendanceMemberships?: AttendanceMembershipPeriod[];
};

export function isEligibleForMembership(player: AttendancePlayer, date: string, time: string | null | undefined, scopeKey: string, recorded = false) {
  // A deliberate attendance decision is stronger evidence than an inferred date.
  if (recorded) return true;
  if (!isEligibleForTraining(player.attendanceStartedAt ?? player.createdAt, date, time)) return false;
  if (!scopeKey.startsWith("coach_group:") && !scopeKey.startsWith("custom_group:")) return true;
  // undefined supports pre-history fixtures; an empty real relation means not enrolled.
  if (!player.attendanceMemberships) return true;
  return player.attendanceMemberships.some((period) => period.scopeKey === scopeKey
    && isEligibleForTraining(period.joinedAt ?? undefined, date, time)
    && (!period.leftAt || !isEligibleForTraining(period.leftAt, date, time)));
}
