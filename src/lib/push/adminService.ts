import webpush from "web-push";
import { prisma } from "@/lib/db";
import { getVapidConfig } from "@/lib/push/vapid";
import { serializePushPayload } from "@/lib/push/payload";
import type { BrowserPushSubscription, PushNotificationPayload } from "@/lib/push/types";

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

export interface SaveAdminPushSubscriptionInput {
  clubId: string;
  subscription: BrowserPushSubscription;
  userAgent?: string | null;
  device?: string | null;
  coachGroupId?: string | null;
}

export async function saveAdminPushSubscription(input: SaveAdminPushSubscriptionInput) {
  return await prisma.adminPushSubscription.upsert({
    where: {
      clubId_endpoint: {
        clubId: input.clubId,
        endpoint: input.subscription.endpoint,
      },
    },
    update: {
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      userAgent: input.userAgent ?? undefined,
      device: input.device ?? undefined,
      coachGroupId: input.coachGroupId ?? null,
      isActive: true,
    },
    create: {
      clubId: input.clubId,
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      userAgent: input.userAgent ?? undefined,
      device: input.device ?? undefined,
      coachGroupId: input.coachGroupId ?? null,
      isActive: true,
    },
  });
}

export async function deactivateAdminPushSubscription(clubId: string, endpoint: string) {
  return await prisma.adminPushSubscription.updateMany({
    where: {
      clubId,
      endpoint,
    },
    data: {
      isActive: false,
    },
  });
}

export async function isAdminPushSubscriptionActive(
  clubId: string,
  endpoint: string,
  coachGroupId: string | null = null,
) {
  const row = await prisma.adminPushSubscription.findUnique({
    where: {
      clubId_endpoint: {
        clubId,
        endpoint,
      },
    },
    select: {
      isActive: true,
      coachGroupId: true,
    },
  });

  return Boolean(row?.isActive && (row.coachGroupId ?? null) === coachGroupId);
}

export interface SendAdminPushResult {
  total: number;
  sent: number;
  failed: number;
  deactivated: number;
}

export async function sendPushToClubAdmins(
  clubId: string,
  payload: PushNotificationPayload,
  coachGroupId?: string | null,
): Promise<SendAdminPushResult> {
  const subscriptions = await prisma.adminPushSubscription.findMany({
    where: {
      clubId,
      isActive: true,
      ...(coachGroupId != null
        ? { coachGroupId }
        : { coachGroupId: null }),
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
          body,
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = getPushErrorStatusCode(error);

        if (shouldDeactivateSubscription(statusCode, subscription.createdAt)) {
          deactivated += 1;
          await prisma.adminPushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false },
          });
        } else if (statusCode === 404) {
          console.warn(
            "Admin push endpoint returned 404 but was kept active because it is too new:",
            subscription.id,
          );
        }

        console.error("Admin push delivery error:", error);
      }
    }),
  );

  return {
    total: subscriptions.length,
    sent,
    failed,
    deactivated,
  };
}

export async function sendPushToAllClubAdminScopes(
  clubId: string,
  payload: PushNotificationPayload,
): Promise<SendAdminPushResult> {
  const subscriptions = await prisma.adminPushSubscription.findMany({
    where: {
      clubId,
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
          body,
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = getPushErrorStatusCode(error);

        if (shouldDeactivateSubscription(statusCode, subscription.createdAt)) {
          deactivated += 1;
          await prisma.adminPushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false },
          });
        } else if (statusCode === 404) {
          console.warn(
            "Admin push endpoint returned 404 but was kept active because it is too new:",
            subscription.id,
          );
        }

        console.error("Admin push delivery error:", error);
      }
    }),
  );

  return {
    total: subscriptions.length,
    sent,
    failed,
    deactivated,
  };
}
