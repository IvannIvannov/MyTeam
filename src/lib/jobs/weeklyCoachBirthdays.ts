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
  const week = nextBirthdayWeek(now);
  const result = { success: true, skipped: !week, notifiedGroups: 0, pushWarnings: 0, failedGroups: [] as string[] };
  // Local scheduler checks hourly; do not send before Monday morning in Sofia.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (!week || hour < 9) return { ...result, skipped: true };

  const groups = await prisma.coachGroup.findMany({ select: {
    id: true, clubId: true, name: true,
    players: { where: { isActive: true, birthDate: { not: null } }, select: { id: true, fullName: true, birthDate: true } },
  } });
  for (const group of groups) {
    try {
      const birthdays = week.dates.flatMap((date) => group.players
        .filter((player) => player.birthDate?.toISOString().slice(5, 10) === date.slice(5))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "bg"))
        .map((player) => `${date.slice(8)}.${date.slice(5, 7)} — ${player.fullName}`));
      if (!birthdays.length) continue;
      const id = `weekly-birthdays:${group.id}:${week.start}`;
      const payload = {
        title: `🎂 Рожденици следващата седмица · ${group.name}`,
        body: `${week.start.split("-").reverse().join(".")} – ${week.end.split("-").reverse().join(".")}\n${birthdays.join("\n")}`,
        url: `/admin/members?clubId=${encodeURIComponent(group.clubId)}&coachGroupId=${encodeURIComponent(group.id)}`,
        tag: id,
        data: { type: "weekly_birthdays" },
      };
      // A deterministic primary key makes simultaneous cron/local runs idempotent.
      const saved = await prisma.adminNotification.createMany({ data: [{
        id, clubId: group.clubId, coachGroupId: group.id, type: "weekly_birthdays",
        title: payload.title, body: payload.body, url: payload.url,
      }], skipDuplicates: true });
      if (!saved.count) continue;
      result.notifiedGroups++;
      publishAdminNotificationCreated(group.clubId);
      try {
        const push = await sendPushToClubAdmins(group.clubId, payload, group.id);
        if (push.failed) result.pushWarnings++;
      } catch (error) {
        result.pushWarnings++;
        console.error("Weekly birthday push failed:", group.id, error);
      }
    } catch (error) {
      result.success = false;
      result.failedGroups.push(group.id);
      console.error("Weekly birthday digest failed:", group.id, error);
    }
  }
  return result;
}
