import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getClubAdminNotifications, getClubAdminUnreadCount } from "@/lib/push/adminHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

async function ensureClubExists(clubId: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true },
  });
  return Boolean(club);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clubId } = await params;
  if (!(await ensureClubExists(clubId))) {
    return NextResponse.json({ error: "Club not found." }, { status: 404 });
  }

  const playerIdRaw = request.nextUrl.searchParams.get("playerId");
  const playerId = playerIdRaw && playerIdRaw.trim() ? playerIdRaw.trim() : null;
  const coachGroupIdRaw = request.nextUrl.searchParams.get("coachGroupId");
  const coachGroupId = coachGroupIdRaw && coachGroupIdRaw.trim() ? coachGroupIdRaw.trim() : null;

  try {
    const [notifications, unreadCount] = await Promise.all([
      getClubAdminNotifications({ clubId, playerId, coachGroupId }),
      getClubAdminUnreadCount({ clubId, playerId, coachGroupId }),
    ]);

    const normalizedNotifications = Array.isArray(notifications)
      ? notifications
          .map((item) => {
            const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
            if (!raw) {
              return null;
            }
            return {
              id: String(raw.id ?? ""),
              type: String(raw.type ?? ""),
              title: String(raw.title ?? ""),
              body: String(raw.body ?? ""),
              url: raw.url ? String(raw.url) : null,
              sentAt: String(raw.sentAt ?? ""),
              readAt: raw.readAt ? String(raw.readAt) : null,
              playerId: raw.playerId ? String(raw.playerId) : null,
              coachGroupId: raw.coachGroupId ? String(raw.coachGroupId) : null,
            };
          })
          .filter((item): item is {
            id: string;
            type: string;
            title: string;
            body: string;
            url: string | null;
            sentAt: string;
            readAt: string | null;
            playerId: string | null;
            coachGroupId: string | null;
          } => item !== null)
      : [];

    const playerIds = Array.from(
      new Set(
        normalizedNotifications
          .map((item) => item.playerId)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );

    const [players, trainingGroups] = await Promise.all([
      playerIds.length > 0
        ? prisma.player.findMany({
            where: {
              id: { in: playerIds },
            },
            select: {
              id: true,
              teamGroup: true,
            },
          })
        : Promise.resolve([]),
      prisma.clubTrainingScheduleGroup.findMany({
        where: { clubId },
        select: {
          id: true,
          name: true,
          teamGroups: true,
        },
      }),
    ]);

    const playerTeamGroupById = new Map(
      players.map((item) => [item.id, typeof item.teamGroup === "number" ? item.teamGroup : null] as const),
    );

    const notificationsWithMeta = normalizedNotifications.map((item) => {
      const teamGroup = item.playerId ? playerTeamGroupById.get(item.playerId) ?? null : null;
      const matchedTrainingGroups =
        typeof teamGroup === "number"
          ? trainingGroups
              .filter((group) => Array.isArray(group.teamGroups) && group.teamGroups.includes(teamGroup))
              .map((group) => ({ id: group.id, name: group.name }))
          : [];

      return {
        ...item,
        teamGroup,
        trainingGroups: matchedTrainingGroups,
      };
    });

    return NextResponse.json({
      notifications: notificationsWithMeta,
      unreadCount,
    });
  } catch (error) {
    console.error("Admin notifications fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications." }, { status: 500 });
  }
}
