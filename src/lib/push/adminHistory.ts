import { prisma } from "@/lib/db";
import type { PushNotificationPayload } from "@/lib/push/types";
import { publishAdminNotificationCreated } from "@/lib/adminNotificationEvents";

const prismaAdmin = prisma as unknown as {
  adminNotification: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    count: (args: Record<string, unknown>) => Promise<number>;
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  };
};

export async function saveAdminNotificationHistory(input: {
  clubId: string;
  type: string;
  payload: PushNotificationPayload;
  playerId?: string | null;
  coachGroupId?: string | null;
}) {
  const saved = await prismaAdmin.adminNotification.create({
    data: {
      clubId: input.clubId,
      playerId: input.playerId ?? null,
      coachGroupId: input.coachGroupId ?? null,
      type: input.type,
      title: input.payload.title,
      body: input.payload.body,
      url: input.payload.url,
    },
  });

  try {
    publishAdminNotificationCreated(input.clubId);
  } catch (error) {
    console.error("Admin notification SSE publish error:", error);
  }

  return saved;
}

export async function getClubAdminNotifications(input: {
  clubId: string;
  playerId?: string | null;
  coachGroupId?: string | null;
  excludeCoachPageMessages?: boolean;
}) {
  const where: Record<string, unknown> = { clubId: input.clubId };
  if (input.excludeCoachPageMessages && !input.coachGroupId) {
    where.NOT = { type: { in: ["admin_message", "myteam_message"] }, coachGroupId: { not: null } };
  }
  if (input.playerId) {
    where.playerId = input.playerId;
  }
  if (input.coachGroupId) {
    where.OR = [
      { coachGroupId: input.coachGroupId },
      {
        coachGroupId: null,
        player: { coachGroups: { some: { id: input.coachGroupId } } },
      },
    ];
  }
  return await prismaAdmin.adminNotification.findMany({
    where,
    orderBy: {
      sentAt: "desc",
    },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      url: true,
      sentAt: true,
      readAt: true,
      playerId: true,
      coachGroupId: true,
    },
  });
}

export async function getClubAdminUnreadCount(input: {
  clubId: string;
  playerId?: string | null;
  coachGroupId?: string | null;
  excludeCoachPageMessages?: boolean;
}) {
  const where: Record<string, unknown> = { clubId: input.clubId, readAt: null };
  if (input.excludeCoachPageMessages && !input.coachGroupId) {
    where.NOT = { type: { in: ["admin_message", "myteam_message"] }, coachGroupId: { not: null } };
  }
  if (input.playerId) {
    where.playerId = input.playerId;
  }
  if (input.coachGroupId) {
    where.OR = [
      { coachGroupId: input.coachGroupId },
      {
        coachGroupId: null,
        player: { coachGroups: { some: { id: input.coachGroupId } } },
      },
    ];
  }
  return await prismaAdmin.adminNotification.count({ where });
}

export async function markClubAdminNotificationsRead(input: {
  clubId: string;
  playerId?: string | null;
  coachGroupId?: string | null;
  excludeCoachPageMessages?: boolean;
}) {
  const where: Record<string, unknown> = { clubId: input.clubId, readAt: null };
  if (input.excludeCoachPageMessages && !input.coachGroupId) {
    where.NOT = { type: { in: ["admin_message", "myteam_message"] }, coachGroupId: { not: null } };
  }
  if (input.playerId) {
    where.playerId = input.playerId;
  }
  if (input.coachGroupId) {
    where.OR = [
      { coachGroupId: input.coachGroupId },
      {
        coachGroupId: null,
        player: { coachGroups: { some: { id: input.coachGroupId } } },
      },
    ];
  }
  return await prismaAdmin.adminNotification.updateMany({
    where,
    data: {
      readAt: new Date(),
    },
  });
}
