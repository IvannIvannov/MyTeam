import { prisma } from "@/lib/db";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";
import type { PushNotificationPayload } from "@/lib/push/types";

const MEMBER_PROCESSING_CONCURRENCY = 4;

export interface TrainingScheduleNotificationSummary {
  targetedMembers: number;
  total: number;
  sent: number;
  failed: number;
  deactivated: number;
  historySaved: number;
  coachPush: {
    total: number;
    sent: number;
    failed: number;
    deactivated: number;
  };
}

function areSameDates(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function shouldNotifyForTrainingDatesChange(
  previousDates: string[],
  nextDates: string[],
) {
  if (nextDates.length === 0) {
    return false;
  }
  return !areSameDates(previousDates, nextDates);
}

export async function sendTrainingScheduleNotifications(input: {
  clubId: string;
  teamGroups?: number[];
  playerIds?: string[];
  previousDates: string[];
  trainingDates: string[];
}): Promise<TrainingScheduleNotificationSummary> {
  const uniqueTeamGroups = Array.from(new Set(input.teamGroups ?? [])).filter((value) => Number.isInteger(value));
  const uniquePlayerIds = Array.from(new Set(input.playerIds ?? [])).filter(Boolean);
  if ((uniqueTeamGroups.length === 0 && uniquePlayerIds.length === 0) || input.trainingDates.length === 0) {
    return {
      targetedMembers: 0,
      total: 0,
      sent: 0,
      failed: 0,
      deactivated: 0,
      historySaved: 0,
      coachPush: { total: 0, sent: 0, failed: 0, deactivated: 0 },
    };
  }

  const members = await prisma.player.findMany({
    where: {
      clubId: input.clubId,
      isActive: true,
      ...(uniquePlayerIds.length > 0
        ? { id: { in: uniquePlayerIds } }
        : { teamGroup: { in: uniqueTeamGroups } }),
    },
    select: {
      id: true,
      fullName: true,
      cards: {
        where: { isActive: true },
        select: { cardCode: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const summary: TrainingScheduleNotificationSummary = {
    targetedMembers: members.length,
    total: 0,
    sent: 0,
    failed: 0,
    deactivated: 0,
    historySaved: 0,
    coachPush: { total: 0, sent: 0, failed: 0, deactivated: 0 },
  };

  if (members.length === 0) {
    return summary;
  }

  const payloadTemplate = buildTrainingSchedulePayload({
    previousDates: input.previousDates,
    nextDates: input.trainingDates,
  });

  for (let index = 0; index < members.length; index += MEMBER_PROCESSING_CONCURRENCY) {
    const batch = members.slice(index, index + MEMBER_PROCESSING_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (member) => {
        const payload: PushNotificationPayload = {
          ...payloadTemplate,
          url: member.cards[0] ? `/member/${member.cards[0].cardCode}` : "/",
        };

        let historySaved = 0;
        try {
          const saved = await saveMemberNotificationHistory(member.id, "training_reminder", payload);
          historySaved = saved ? 1 : 0;
        } catch (error) {
          console.error("Training schedule notification history save failed:", error);
        }

        try {
          const push = await sendPushToMember(member.id, payload);
          return { ...push, historySaved };
        } catch (error) {
          console.error("Training schedule push send failed:", error);
          return {
            total: 0,
            sent: 0,
            failed: 1,
            deactivated: 0,
            historySaved,
          };
        }
      }),
    );

    for (const result of results) {
      summary.total += result.total;
      summary.sent += result.sent;
      summary.failed += result.failed;
      summary.deactivated += result.deactivated;
      summary.historySaved += result.historySaved;
    }
  }

  return summary;
}

function uniqueSortedDates(dates: string[]) {
  return Array.from(new Set(dates.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function parseDateFromIso(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function formatBgDate(iso: string) {
  const date = parseDateFromIso(iso);
  return date.toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateList(dates: string[]) {
  return dates.map(formatBgDate).join(", ");
}

function formatPeriodFromDates(dates: string[]) {
  if (dates.length === 0) {
    return "";
  }
  const sorted = uniqueSortedDates(dates);
  if (sorted.length === 1) {
    return formatBgDate(sorted[0]);
  }
  return `${formatBgDate(sorted[0])} - ${formatBgDate(sorted[sorted.length - 1])}`;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function diffDates(previousDates: string[], nextDates: string[]) {
  const today = getTodayIso();
  const prev = uniqueSortedDates(previousDates);
  const next = uniqueSortedDates(nextDates);
  const nextSet = new Set(next);
  const prevSet = new Set(prev);

  const removed = prev.filter((date) => !nextSet.has(date) && date >= today);
  const added = next.filter((date) => !prevSet.has(date));

  return { prev, next, removed, added };
}

function buildTrainingScheduleMessage(previousDates: string[], nextDates: string[]) {
  const { prev, next, removed, added } = diffDates(previousDates, nextDates);
  const previousLast = prev[prev.length - 1] ?? "";
  const onlyExtendedAfterPreviousPeriod =
    prev.length > 0 &&
    removed.length === 0 &&
    added.length > 0 &&
    added.every((date) => date > previousLast);

  if (prev.length === 0 || onlyExtendedAfterPreviousPeriod) {
    const period = formatPeriodFromDates(prev.length === 0 ? next : added);
    return `Насрочен тренировъчен график за периода ${period}`;
  }

  const changePeriod = formatPeriodFromDates(uniqueSortedDates([...prev, ...next]));
  const base = `Промяна в тренировъчния график за периода ${changePeriod}`;

  if (removed.length > 0 && added.length > 0 && removed.length === added.length) {
    if (removed.length === 1) {
      return `${base}, тренировката на ${formatBgDate(removed[0])} беше преместена на ${formatBgDate(added[0])}`;
    }

    return `${base}, тренировките на ${formatDateList(removed)} бяха преместени на ${formatDateList(added)}`;
  }

  if (removed.length > 0 && added.length > 0) {
    return `${base}, добавени тренировки: ${formatDateList(added)}; отменени тренировки: ${formatDateList(removed)}`;
  }

  if (added.length > 0) {
    if (added.length === 1) {
      return `${base}, добавена тренировка на ${formatBgDate(added[0])}`;
    }
    return `${base}, добавени тренировки: ${formatDateList(added)}`;
  }

  if (removed.length > 0) {
    if (removed.length === 1) {
      return `${base}, отменена тренировка на ${formatBgDate(removed[0])}`;
    }
    return `${base}, отменени тренировки: ${formatDateList(removed)}`;
  }

  return `${base}.`;
}

function buildTrainingSchedulePayload(input: {
  previousDates: string[];
  nextDates: string[];
}): PushNotificationPayload {
  const body = buildTrainingScheduleMessage(input.previousDates, input.nextDates);
  const { added, removed } = diffDates(input.previousDates, input.nextDates);
  return {
    title: "Тренировъчен график",
    body,
    icon: "/myteam-logo.webp",
    badge: "/myteam-logo.webp",
    tag: "training-schedule-updated",
    data: {
      type: "training_reminder",
      trainingDates: uniqueSortedDates([...added, ...removed]),
    },
  };
}
