import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { sendPushToClubAdmins } from "@/lib/push/adminService";
import { sendPushToMember } from "@/lib/push/service";
import { saveAdminNotificationHistory } from "@/lib/push/adminHistory";
import { buildNotificationPayload } from "@/lib/push/templates";
import type { PushNotificationPayload } from "@/lib/push/types";
import { isIsoDate } from "@/lib/training";
import { resolveLimitedTrainingSessionId, setLimitedSessionAttendance } from "@/lib/limitedTrainingSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatBgDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function bgOrdinal(n: number): string {
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return `${n}-ти`;
  if (lastOne === 1) return `${n}-ви`;
  if (lastOne === 2) return `${n}-ри`;
  return `${n}-ти`;
}

function buildRegistrationPayload(input: {
  clubId: string;
  playerName: string;
  trainingDate: string;
  action: "registered" | "cancelled";
  spotsRemaining?: number;
  waitlistPosition?: number | null;
  coachGroupId?: string | null;
}): PushNotificationPayload {
  const formattedDate = formatBgDate(input.trainingDate);
  let body: string;
  if (input.action === "registered") {
    if (input.waitlistPosition != null) {
      body = `${input.playerName} се записа в чакалнята (${bgOrdinal(input.waitlistPosition)} на опашката) за тренировката на ${formattedDate}.`;
    } else {
      const spotsText = typeof input.spotsRemaining === "number"
        ? ` Остават ${input.spotsRemaining} свободни места.`
        : "";
      body = `${input.playerName} се записа за тренировката на ${formattedDate}.${spotsText}`;
    }
  } else {
    body = `${input.playerName} отказа записването за тренировката на ${formattedDate}.`;
  }
  return {
    title: "Записване за тренировка",
    body,
    url: input.coachGroupId
      ? `/admin/members?clubId=${encodeURIComponent(input.clubId)}&coachGroupId=${encodeURIComponent(input.coachGroupId)}`
      : `/admin/members?clubId=${encodeURIComponent(input.clubId)}`,
    icon: "/myteam-logo.webp",
    badge: "/myteam-logo.webp",
    tag: "training-registration",
    data: {
      type: "training_registration",
      clubId: input.clubId,
      trainingDate: input.trainingDate,
      action: input.action,
    },
  };
}

async function resolvePlayer(cardCode: string) {
  const normalized = cardCode.trim().toUpperCase();
  const card = await prisma.card.findFirst({
    where: { cardCode: normalized, isActive: true },
    select: {
      playerId: true,
      player: {
        select: {
          id: true,
          fullName: true,
          clubId: true,
          teamGroup: true,
          customTrainingGroups: { select: { group: { select: { id: true } } } },
          coachGroups: { select: { id: true } },
        },
      },
    },
  });

  if (!card?.player) return null;

  return {
    playerId: card.playerId,
    playerName: card.player.fullName,
    clubId: card.player.clubId,
    teamGroup: card.player.teamGroup,
    customGroupIds: card.player.customTrainingGroups.map((g) => g.group.id),
    coachGroupIds: card.player.coachGroups.map((g) => g.id),
  };
}

async function resolvePushCoachGroupId(scopeKey: string): Promise<string | null> {
  if (scopeKey.startsWith("coach_group:")) {
    return scopeKey.split(":")[1];
  }
  if (scopeKey.startsWith("custom_group:")) {
    const groupId = scopeKey.slice("custom_group:".length);
    const group = await prisma.clubCustomTrainingGroup.findUnique({
      where: { id: groupId },
      select: { coachGroupId: true },
    });
    return group?.coachGroupId ?? null;
  }
  return null;
}

function isPlayerInScope(
  player: { teamGroup: number | null; customGroupIds: string[]; coachGroupIds: string[] },
  scopeKey: string,
): boolean {
  if (scopeKey.startsWith("team_group:")) {
    const tg = parseInt(scopeKey.slice("team_group:".length), 10);
    return player.teamGroup === tg;
  }
  if (scopeKey.startsWith("custom_group:")) {
    const cgId = scopeKey.slice("custom_group:".length);
    return player.customGroupIds.includes(cgId);
  }
  if (scopeKey.startsWith("coach_group:")) {
    const coachGId = scopeKey.split(":")[1];
    return player.coachGroupIds.includes(coachGId);
  }
  return false;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> },
) {
  const { cardCode } = await params;
  const player = await resolvePlayer(cardCode);

  if (!player) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const trainingDate = typeof b.trainingDate === "string" ? b.trainingDate.trim() : "";
  const limitedEventId = typeof b.limitedEventId === "string" ? b.limitedEventId.trim() : "";

  if (!isIsoDate(trainingDate)) {
    return NextResponse.json({ error: "Invalid trainingDate" }, { status: 400 });
  }
  if (!limitedEventId) {
    return NextResponse.json({ error: "limitedEventId is required" }, { status: 400 });
  }

  const event = await prisma.limitedTrainingEvent.findFirst({
    where: { id: limitedEventId, clubId: player.clubId },
    select: {
      id: true,
      scopeKey: true,
      maxSpots: true,
      _count: { select: { registrations: true } },
    },
  });

  const pushCoachGroupId = event ? await resolvePushCoachGroupId(event.scopeKey) : null;

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!isPlayerInScope(player, event.scopeKey)) {
    return NextResponse.json({ error: "Player is not in the scope of this event" }, { status: 403 });
  }
  const trainingSessionId = await resolveLimitedTrainingSessionId(player.clubId, event.scopeKey, new Date(`${trainingDate}T00:00:00Z`));
  if (trainingSessionId && !await prisma.trainingSession.findFirst({ where: { id: trainingSessionId, clubId: player.clubId, status: "scheduled", trainingDate: new Date(`${trainingDate}T00:00:00Z`) }, select: { id: true } })) return NextResponse.json({ error: "Training is cancelled or unavailable" }, { status: 404 });

  // Check if already registered (idempotent)
  const existing = await prisma.limitedTrainingRegistration.findFirst({
    where: { eventId: event.id, playerId: player.playerId },
    select: { id: true },
  });

  if (!existing) {
    await prisma.limitedTrainingRegistration.create({
      data: { eventId: event.id, playerId: player.playerId },
    });
  }

  // Fetch all registrations ordered by time to determine confirmed vs waitlist
  const allRegs = await prisma.limitedTrainingRegistration.findMany({
    where: { eventId: event.id },
    select: { playerId: true },
    orderBy: { registeredAt: "asc" },
  });

  const totalCount = allRegs.length;
  const playerIndex = allRegs.findIndex((r) => r.playerId === player.playerId);
  const position = playerIndex >= 0 ? playerIndex + 1 : totalCount;
  const isConfirmed = position <= event.maxSpots;
  const waitlistPosition = isConfirmed ? null : position - event.maxSpots;

  const sessionAttendanceHandled = await setLimitedSessionAttendance(player.clubId, event.scopeKey, [player.playerId], isConfirmed, new Date(`${trainingDate}T00:00:00Z`));
  if (isConfirmed && !sessionAttendanceHandled) {
    // Remove the auto-created opt-out so the player shows as attending
    await prisma.trainingOptOut.deleteMany({
      where: {
        playerId: player.playerId,
        trainingDate: new Date(trainingDate + "T00:00:00.000Z"),
        reasonCode: "limited_event",
      },
    });
  }
  // If waitlisted, keep the opt-out — not yet a confirmed attendee

  publishMemberUpdated(cardCode, "training-updated");
  publishTrainingAttendanceUpdated(player.clubId, trainingDate);

  const spotsRemaining = Math.max(0, event.maxSpots - totalCount);

  const payload = buildRegistrationPayload({
    clubId: player.clubId,
    playerName: player.playerName,
    trainingDate,
    action: "registered",
    spotsRemaining: isConfirmed ? spotsRemaining : undefined,
    waitlistPosition: isConfirmed ? null : waitlistPosition,
    coachGroupId: pushCoachGroupId,
  });

  try {
    await saveAdminNotificationHistory({
      clubId: player.clubId,
      playerId: player.playerId,
      coachGroupId: pushCoachGroupId,
      type: "training_registration",
      payload,
    });
  } catch (error) {
    console.error("Training registration history save error:", error);
  }

  try {
    await sendPushToClubAdmins(player.clubId, payload, pushCoachGroupId);
  } catch (error) {
    console.error("Training registration push send error:", error);
  }

  return NextResponse.json({
    success: true,
    position,
    isConfirmed,
    waitlistPosition,
    spotsRemaining,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> },
) {
  const { cardCode } = await params;
  const player = await resolvePlayer(cardCode);

  if (!player) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const trainingDate = typeof b.trainingDate === "string" ? b.trainingDate.trim() : "";
  const limitedEventId = typeof b.limitedEventId === "string" ? b.limitedEventId.trim() : "";

  if (!isIsoDate(trainingDate)) {
    return NextResponse.json({ error: "Invalid trainingDate" }, { status: 400 });
  }
  if (!limitedEventId) {
    return NextResponse.json({ error: "limitedEventId is required" }, { status: 400 });
  }

  const event = await prisma.limitedTrainingEvent.findFirst({
    where: { id: limitedEventId, clubId: player.clubId },
    select: { id: true, scopeKey: true, maxSpots: true },
  });

  const pushCoachGroupId = event ? await resolvePushCoachGroupId(event.scopeKey) : null;

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const trainingDateUtc = new Date(trainingDate + "T00:00:00.000Z");

  // Read all registrations BEFORE deletion to know the canceller's position and who's first on waitlist
  const allRegsBefore = await prisma.limitedTrainingRegistration.findMany({
    where: { eventId: event.id },
    select: { playerId: true },
    orderBy: { registeredAt: "asc" },
  });
  const cancellerIndex = allRegsBefore.findIndex((r) => r.playerId === player.playerId);
  const wasConfirmed = cancellerIndex >= 0 && cancellerIndex + 1 <= event.maxSpots;
  // The player who was first on the waitlist (index = maxSpots, 0-based)
  const firstWaitlistedPlayerId =
    wasConfirmed && allRegsBefore.length > event.maxSpots
      ? (allRegsBefore[event.maxSpots]?.playerId ?? null)
      : null;

  await prisma.limitedTrainingRegistration.deleteMany({
    where: { eventId: event.id, playerId: player.playerId },
  });

  // Restore the opt-out so the canceller is back to absent
  if (!await setLimitedSessionAttendance(player.clubId, event.scopeKey, [player.playerId], false, trainingDateUtc)) await prisma.trainingOptOut.upsert({
    where: { playerId_trainingDate: { playerId: player.playerId, trainingDate: trainingDateUtc } },
    create: { playerId: player.playerId, trainingDate: trainingDateUtc, reasonCode: "limited_event" },
    update: {},
  });

  // Promote the first waitlisted player now that a confirmed spot opened up
  if (firstWaitlistedPlayerId) {
    if (!await setLimitedSessionAttendance(player.clubId, event.scopeKey, [firstWaitlistedPlayerId], true, trainingDateUtc)) await prisma.trainingOptOut.deleteMany({
      where: { playerId: firstWaitlistedPlayerId, trainingDate: trainingDateUtc, reasonCode: "limited_event" },
    });
    const promotedData = await prisma.player.findUnique({
      where: { id: firstWaitlistedPlayerId },
      select: { cards: { where: { isActive: true }, select: { cardCode: true }, take: 1 } },
    });
    const promotedCardCode = promotedData?.cards[0]?.cardCode;
    if (promotedCardCode) {
      const promotionPayload = buildNotificationPayload({
        type: "limited_training_promoted",
        trainingDate,
        url: `/member/${encodeURIComponent(promotedCardCode)}`,
      });
      try {
        await sendPushToMember(firstWaitlistedPlayerId, promotionPayload, "limited_training_promoted");
      } catch (e) {
        console.error("Waitlist promotion push error:", e);
      }
      publishMemberUpdated(promotedCardCode, "training-updated");
    }
  }

  publishMemberUpdated(cardCode, "training-updated");
  publishTrainingAttendanceUpdated(player.clubId, trainingDate);

  const payload = buildRegistrationPayload({
    clubId: player.clubId,
    playerName: player.playerName,
    trainingDate,
    action: "cancelled",
    coachGroupId: pushCoachGroupId,
  });

  try {
    await saveAdminNotificationHistory({
      clubId: player.clubId,
      playerId: player.playerId,
      coachGroupId: pushCoachGroupId,
      type: "training_registration",
      payload,
    });
  } catch (error) {
    console.error("Training registration cancel history save error:", error);
  }

  try {
    await sendPushToClubAdmins(player.clubId, payload, pushCoachGroupId);
  } catch (error) {
    console.error("Training registration cancel push send error:", error);
  }

  return NextResponse.json({ success: true });
}
