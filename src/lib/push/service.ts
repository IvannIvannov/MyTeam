import webpush from "web-push";
import { prisma } from "@/lib/db";
import { getVapidConfig } from "@/lib/push/vapid";
import { serializePushPayload } from "@/lib/push/payload";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { isTrainingNotificationPaused } from "@/lib/push/trainingPause";
import type {
  BrowserPushSubscription,
  PushNotificationPayload,
  NotificationTemplateType,
} from "@/lib/push/types";

let isWebPushConfigured = false;
const MIN_AGE_FOR_404_DEACTIVATION_MS = 24 * 60 * 60 * 1000;

function ensureWebPushConfigured() {
  if (isWebPushConfigured) {
    return;
  }

  const vapid = getVapidConfig();
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  isWebPushConfigured = true;
}

function getPushErrorStatusCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeError = error as { statusCode?: number };
  return typeof maybeError.statusCode === "number" ? maybeError.statusCode : null;
}

function shouldDeactivateSubscription(statusCode: number | null, createdAt: Date) {
  if (statusCode === 410) {
    return true;
  }

  if (statusCode === 404) {
    return Date.now() - createdAt.getTime() >= MIN_AGE_FOR_404_DEACTIVATION_MS;
  }

  return false;
}

export interface SavePushSubscriptionInput {
  memberId: string;
  subscription: BrowserPushSubscription;
  userAgent?: string | null;
  device?: string | null;
}

export async function savePushSubscription(input: SavePushSubscriptionInput) {
  return await prisma.pushSubscription.upsert({
    where: {
      playerId_endpoint: {
        playerId: input.memberId,
        endpoint: input.subscription.endpoint,
      },
    },
    update: {
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      userAgent: input.userAgent ?? undefined,
      device: input.device ?? undefined,
      isActive: true,
    },
    create: {
      playerId: input.memberId,
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      userAgent: input.userAgent ?? undefined,
      device: input.device ?? undefined,
      isActive: true,
    },
  });
}

export async function deactivatePushSubscription(endpoint: string, memberId?: string) {
  return await prisma.pushSubscription.updateMany({
    where: {
      endpoint,
      ...(memberId ? { playerId: memberId } : {}),
    },
    data: {
      isActive: false,
    },
  });
}

export async function hasOtherActivePushSubscriptions(endpoint: string, memberId: string) {
  const count = await prisma.pushSubscription.count({
    where: {
      endpoint,
      isActive: true,
      playerId: {
        not: memberId,
      },
    },
  });

  return count > 0;
}

export interface SendPushResult {
  total: number;
  sent: number;
  failed: number;
  deactivated: number;
}

export async function sendPushToMember(
  memberId: string,
  payload: PushNotificationPayload,
  notificationType?: NotificationTemplateType
): Promise<SendPushResult> {
  if (await isTrainingNotificationPaused(memberId, payload, notificationType)) {
    return { total: 0, sent: 0, failed: 0, deactivated: 0 };
  }

  // Always save to notification history when a type is given, regardless of push subscription status
  if (notificationType) {
    try {
      await saveMemberNotificationHistory(memberId, notificationType, payload);
    } catch (error) {
      console.error("Failed to save notification history:", error);
    }
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      playerId: memberId,
      isActive: true,
    },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      createdAt: true,
    },
  });

  if (subscriptions.length === 0) {
    return { total: 0, sent: 0, failed: 0, deactivated: 0 };
  }

  ensureWebPushConfigured();

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  const body = serializePushPayload(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          body
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = getPushErrorStatusCode(error);

        if (shouldDeactivateSubscription(statusCode, subscription.createdAt)) {
          deactivated += 1;
          await prisma.pushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false },
          });
        } else if (statusCode === 404) {
          console.warn(
            "Push endpoint returned 404 but was kept active because it is too new:",
            subscription.id
          );
        }

        console.error("Push delivery error:", error);
      }
    })
  );

  return {
    total: subscriptions.length,
    sent,
    failed,
    deactivated,
  };
}
