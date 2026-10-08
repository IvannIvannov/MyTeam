import { prisma } from "@/lib/db";
import type { NotificationTemplateType, PushNotificationPayload } from "@/lib/push/types";

const TRAINING_TYPES = new Set([
  "training_reminder",
  "training_cancelled",
  "limited_training_created",
  "limited_training_promoted",
  "limited_training_waitlisted",
]);

function trainingMonth(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  const bg = /^\d{2}\.(\d{2})\.(\d{4})\.?$/.exec(value);
  const year = iso?.[1] ?? bg?.[2];
  const month = iso?.[2] ?? bg?.[1];
  if (!year || !month || Number(month) < 1 || Number(month) > 12) return null;
  return `${year}-${month}-01T00:00:00.000Z`;
}

export async function isTrainingNotificationPaused(
  memberId: string,
  payload: PushNotificationPayload,
  type?: NotificationTemplateType,
): Promise<boolean> {
  const notificationType = type ?? payload.data?.type;
  if (typeof notificationType !== "string" || !TRAINING_TYPES.has(notificationType)) return false;

  const dates = Array.isArray(payload.data?.trainingDates)
    ? payload.data.trainingDates
    : [payload.data?.trainingDate];
  let months = Array.from(new Set(dates.map(trainingMonth).filter((month): month is string => month !== null)));
  if (months.length === 0) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Sofia", year: "numeric", month: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")!.value;
    const month = parts.find((part) => part.type === "month")!.value;
    months = [`${year}-${month}-01T00:00:00.000Z`];
  }

  const waivers = await prisma.paymentWaiver.findMany({
    where: { playerId: memberId, waivedFor: { in: months.map((month) => new Date(month)) } },
    select: { waivedFor: true },
  });
  const pausedMonths = new Set(waivers.map((waiver) => waiver.waivedFor.toISOString()));
  return months.every((month) => pausedMonths.has(month));
}
