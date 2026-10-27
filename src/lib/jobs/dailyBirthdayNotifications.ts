import { prisma } from "@/lib/db";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";
import { buildNotificationPayload } from "@/lib/push/templates";

const NOTIFICATION_TYPE = "birthday" as const;
const DEFAULT_TIME_ZONE = "Europe/Sofia";
const MEMBER_PROCESSING_CONCURRENCY = 2;

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: "year" | "month" | "day") =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

interface BirthdayPlayer {
  id: string;
  full_name: string;
  card_code: string | null;
}

export interface DailyBirthdayResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  timeZone: string;
  nowIso: string;
  birthdayMonth: number;
  birthdayDay: number;
  targetMembers: number;
  alreadySentToday: number;
  agesUpdated: number;
  pushSummary: {
    total: number;
    sent: number;
    failed: number;
    deactivated: number;
  };
}

export async function runDailyBirthdayNotifications(
  now = new Date(),
): Promise<DailyBirthdayResult> {
  const timeZone = DEFAULT_TIME_ZONE;
  const nowIso = now.toISOString();
  const { year, month, day } = getDatePartsInTimeZone(now, timeZone);

  if (!year || !month || !day) {
    return {
      success: false,
      skipped: true,
      reason: "Could not determine current date in configured timezone.",
      timeZone,
      nowIso,
      birthdayMonth: month,
      birthdayDay: day,
      targetMembers: 0,
      alreadySentToday: 0,
      agesUpdated: 0,
      pushSummary: { total: 0, sent: 0, failed: 0, deactivated: 0 },
    };
  }

  const today = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // One statement catches up missed birthdays, including inactive players.
  // Repeated runs do not rewrite rows whose age is already correct.
  const agesUpdated = await prisma.$executeRaw`
    UPDATE players
    SET age = EXTRACT(YEAR FROM age(${today}::date, birth_date))::integer
    WHERE birth_date IS NOT NULL
      AND birth_date <= ${today}::date
      AND age IS DISTINCT FROM EXTRACT(YEAR FROM age(${today}::date, birth_date))::integer
  `;

  // Find all active players whose birthday is today (month+day match)
  const birthdayPlayers = await prisma.$queryRaw<BirthdayPlayer[]>`
    SELECT DISTINCT ON (p.id)
      p.id,
      p.full_name,
      c.card_code
    FROM players p
    LEFT JOIN cards c ON c.player_id = p.id AND c.is_active = true
    WHERE p.is_active = true
      AND p.birth_date IS NOT NULL
      AND EXTRACT(MONTH FROM p.birth_date) = ${month}
      AND EXTRACT(DAY FROM p.birth_date) = ${day}
    ORDER BY p.id, c.created_at DESC
  `;

  if (birthdayPlayers.length === 0) {
    return {
      success: true,
      skipped: true,
      reason: "No members have a birthday today.",
      timeZone,
      nowIso,
      birthdayMonth: month,
      birthdayDay: day,
      targetMembers: 0,
      alreadySentToday: 0,
      agesUpdated,
      pushSummary: { total: 0, sent: 0, failed: 0, deactivated: 0 },
    };
  }

  // Find players already notified today (midnight UTC offset for Sofia timezone)
  const todayMidnightUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const tomorrowMidnightUtc = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

  const alreadySentRows = await prisma.playerNotification.findMany({
    where: {
      type: NOTIFICATION_TYPE,
      sentAt: {
        gte: todayMidnightUtc,
        lt: tomorrowMidnightUtc,
      },
      playerId: { in: birthdayPlayers.map((p) => p.id) },
    },
    select: { playerId: true },
  });

  const alreadySentIds = new Set(alreadySentRows.map((r) => r.playerId));
  const targetPlayers = birthdayPlayers.filter((p) => !alreadySentIds.has(p.id));

  let totalPush = 0;
  let sentPush = 0;
  let failedPush = 0;
  let deactivatedPush = 0;

  for (let i = 0; i < targetPlayers.length; i += MEMBER_PROCESSING_CONCURRENCY) {
    const batch = targetPlayers.slice(i, i + MEMBER_PROCESSING_CONCURRENCY);
    await Promise.all(
      batch.map(async (player) => {
        const payload = buildNotificationPayload({
          type: NOTIFICATION_TYPE,
          memberName: player.full_name,
          cardCode: player.card_code ?? undefined,
        });

        const pushResult = await sendPushToMember(player.id, payload);
        await saveMemberNotificationHistory(player.id, NOTIFICATION_TYPE, payload);

        totalPush += pushResult.total;
        sentPush += pushResult.sent;
        failedPush += pushResult.failed;
        deactivatedPush += pushResult.deactivated;
      }),
    );
  }

  return {
    success: true,
    skipped: false,
    timeZone,
    nowIso,
    birthdayMonth: month,
    birthdayDay: day,
    targetMembers: targetPlayers.length,
    alreadySentToday: alreadySentIds.size,
    agesUpdated,
    pushSummary: {
      total: totalPush,
      sent: sentPush,
      failed: failedPush,
      deactivated: deactivatedPush,
    },
  };
}
