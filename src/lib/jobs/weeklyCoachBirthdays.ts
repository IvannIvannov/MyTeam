import { prisma } from "@/lib/db";
import { localToday } from "@/lib/clubSubscriptionDomain";
import { publishAdminNotificationCreated } from "@/lib/adminNotificationEvents";
import { sendPushToClubAdmins } from "@/lib/push/adminService";

/** Calendar arithmetic uses UTC dates after taking today's date in Europe/Sofia. */
export function nextBirthdayWeek(now: Date) {
  const today = localToday(now);
  const monday = new Date(`${today}T00:00:00Z`);
  if (monday.getUTCDay() !== 1) return null;
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + 7 + index);
    return date.toISOString().slice(0, 10);
  });
  return { today, dates, start: dates[0], end: dates[6] };
}

export async function runWeeklyCoachBirthdays(now = new Date()) {
  return runBirthdayDigests(now, false);
}

export async function runDailyCoachBirthdays(now = new Date()) {
  return runBirthdayDigests(now, true);
}

async function runBirthdayDigests(now: Date, daily: boolean) {
  const today = localToday(now);
  const week = daily ? { today, dates: [today], start: today, end: today } : nextBirthdayWeek(now);
  const result = { success: true, skipped: !week, notifiedGroups: 0, notifiedClubs: 0, pushWarnings: 0, failedGroups: [] as string[] };
  // Local scheduler checks hourly; do not send before 09:00 in Sofia.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (!week || hour < 9) return { ...result, skipped: true };

  const groups = await prisma.coachGroup.findMany({ select: {
    id: true, clubId: true, name: true,
    players: { where: { isActive: true, birthDate: { not: null } }, select: { id: true, fullName: true, birthDate: true } },
  } });
  const clubs = await prisma.club.findMany({ select: {
    id: true, name: true,
    players: { where: { isActive: true, birthDate: { not: null } }, select: { id: true, fullName: true, birthDate: true } },
  } });
  const scopes = [
    ...clubs.map((club) => ({ ...club, clubId: club.id, coachGroupId: null as string | null })),
    ...groups.map((group) => ({ ...group, coachGroupId: group.id as string | null })),
  ];
  for (const group of scopes) {
    try {
      const birthdays = week.dates.flatMap((date) => group.players
        .filter((player) => player.birthDate?.toISOString().slice(5, 10) === date.slice(5))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "bg"))
        .map((player) => `${date.slice(8)}.${date.slice(5, 7)} — ${player.fullName}`));
      if (!birthdays.length) continue;
      const type = daily ? "daily_birthdays" : "weekly_birthdays";
      const id = `${daily ? "daily" : "weekly"}-birthdays:${group.coachGroupId ? group.id : `club:${group.id}`}:${week.start}`;
      const payload = {
        title: `🎂 Рожденици ${daily ? "днес" : "следващата седмица"} · ${group.name}`,
        body: `${daily ? week.start.split("-").reverse().join(".") : `${week.start.split("-").reverse().join(".")} – ${week.end.split("-").reverse().join(".")}`}\n${birthdays.join("\n")}`,
        url: `/admin/members?clubId=${encodeURIComponent(group.clubId)}${group.coachGroupId ? `&coachGroupId=${encodeURIComponent(group.coachGroupId)}` : ""}`,
        tag: id,
        data: { type },
      };
      // A deterministic primary key makes simultaneous cron/local runs idempotent.
      const saved = await prisma.adminNotification.createMany({ data: [{
        id, clubId: group.clubId, coachGroupId: group.coachGroupId, type,
        title: payload.title, body: payload.body, url: payload.url,
      }], skipDuplicates: true });
      if (!saved.count) continue;
      if (group.coachGroupId) result.notifiedGroups++;
      else result.notifiedClubs++;
      publishAdminNotificationCreated(group.clubId);
      try {
        const push = await sendPushToClubAdmins(group.clubId, payload, group.coachGroupId);
        if (push.failed) result.pushWarnings++;
      } catch (error) {
        result.pushWarnings++;
        console.error("Birthday push failed:", group.id, error);
      }
    } catch (error) {
      result.success = false;
      result.failedGroups.push(group.id);
      console.error("Birthday digest failed:", group.id, error);
    }
  }
  return result;
}
