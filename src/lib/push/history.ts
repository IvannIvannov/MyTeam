import { prisma } from "@/lib/db";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { isTrainingNotificationPaused } from "@/lib/push/trainingPause";
import type { NotificationTemplateType, PushNotificationPayload } from "@/lib/push/types";

export async function saveMemberNotificationHistory(
  memberId: string,
  type: NotificationTemplateType,
  payload: PushNotificationPayload
) {
  if (await isTrainingNotificationPaused(memberId, payload, type)) return null;

  const saved = await prisma.playerNotification.create({
    data: {
      playerId: memberId,
      type,
      title: payload.title,
      body: payload.body,
      url: payload.url,
    },
  });

  try {
    const cards = await prisma.card.findMany({
      where: {
        playerId: memberId,
        isActive: true,
      },
      select: { cardCode: true },
    });
    for (const card of cards) {
      publishMemberUpdated(card.cardCode, "notification-created");
    }
  } catch (error) {
    console.error("Notification SSE publish error:", error);
  }

  return saved;
}

export async function getMemberNotifications(memberId: string) {
  return await prisma.playerNotification.findMany({
    where: {
      playerId: memberId,
    },
    orderBy: {
      sentAt: "desc",
    },
  });
}

export async function markNotificationAsRead(notificationId: string) {
  return await prisma.playerNotification.update({
    where: {
      id: notificationId,
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function getUnreadNotificationCount(memberId: string) {
  return await prisma.playerNotification.count({
    where: {
      playerId: memberId,
      readAt: null,
    },
  });
}
