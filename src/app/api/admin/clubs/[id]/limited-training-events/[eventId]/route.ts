import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { buildNotificationPayload } from "@/lib/push/templates";
import { sendPushToMember } from "@/lib/push/service";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { setLimitedSessionAttendance } from "@/lib/limitedTrainingSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getPlayerIdsInScope(clubId: string, scopeKey: string): Promise<string[]> {
  if (scopeKey.startsWith("team_group:")) {
    const tg = parseInt(scopeKey.slice("team_group:".length), 10);
    const players = await prisma.player.findMany({
      where: { clubId, teamGroup: tg, isActive: true },
      select: { id: true },
    });
    return players.map((p) => p.id);
  }
  if (scopeKey.startsWith("custom_group:")) {
    const groupId = scopeKey.slice("custom_group:".length);
    const members = await prisma.clubCustomTrainingGroupPlayer.findMany({
      where: { groupId },
      select: { playerId: true, player: { select: { isActive: true } } },
    });
    return members.filter((m) => m.player.isActive).map((m) => m.playerId);
  }
  if (scopeKey.startsWith("coach_group:")) {
    const groupId = scopeKey.split(":")[1];
    const players = await prisma.player.findMany({
      where: { coachGroups: { some: { id: groupId } }, clubId, isActive: true },
      select: { id: true },
    });
    return players.map((p) => p.id);
  }
  return [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, eventId } = await params;

  try {
    const event = await prisma.limitedTrainingEvent.findFirst({
      where: { id: eventId, clubId: id },
      select: {
        id: true,
        scopeKey: true,
        scopeId: true,
        teamGroup: true,
        trainingDate: true,
        maxSpots: true,
        registrations: {
          select: {
            id: true,
            playerId: true,
            registeredAt: true,
            player: { select: { fullName: true } },
          },
          orderBy: { registeredAt: "asc" },
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const registrations = event.registrations.map((r, idx) => ({
      position: idx + 1,
      playerId: r.playerId,
      fullName: r.player.fullName,
      registeredAt: r.registeredAt.toISOString(),
      isConfirmed: idx + 1 <= event.maxSpots,
    }));

    return NextResponse.json({
      event: {
        id: event.id,
        scopeKey: event.scopeKey,
        scopeId: event.scopeId,
        teamGroup: event.teamGroup,
        trainingDate: event.trainingDate.toISOString().slice(0, 10),
        maxSpots: event.maxSpots,
      },
      registrations,
      spotsRemaining: Math.max(0, event.maxSpots - registrations.length),
    });
  } catch (error) {
    console.error("Limited training event GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, eventId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const maxSpots = typeof b.maxSpots === "number" ? b.maxSpots : Number(b.maxSpots);

  if (!Number.isInteger(maxSpots) || maxSpots < 1 || maxSpots > 200) {
    return NextResponse.json({ error: "maxSpots must be an integer between 1 and 200" }, { status: 400 });
  }

  try {
    const existing = await prisma.limitedTrainingEvent.findFirst({
      where: { id: eventId, clubId: id },
      select: { id: true, maxSpots: true, trainingDate: true, scopeKey: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const oldMaxSpots = existing.maxSpots;
    const trainingDateUtc = existing.trainingDate;
    const trainingDateStr = trainingDateUtc.toISOString().slice(0, 10);

    // Fetch all registrations ordered by sign-up time to determine who changes status
    const allRegs = await prisma.limitedTrainingRegistration.findMany({
      where: { eventId },
      select: {
        playerId: true,
        player: { select: { cards: { where: { isActive: true }, select: { cardCode: true }, take: 1 } } },
      },
      orderBy: { registeredAt: "asc" },
    });

    const updated = await prisma.limitedTrainingEvent.update({
      where: { id: eventId },
      data: { maxSpots },
      select: {
        id: true,
        scopeKey: true,
        trainingDate: true,
        maxSpots: true,
        _count: { select: { registrations: true } },
      },
    });

    if (maxSpots > oldMaxSpots) {
      // Spots increased: promote players who were on the waitlist and are now confirmed
      // They are at 0-based indices [oldMaxSpots, min(newMaxSpots, total) - 1]
      const newlyConfirmed = allRegs.slice(oldMaxSpots, maxSpots);
      for (const reg of newlyConfirmed) {
        if (!await setLimitedSessionAttendance(id, updated.scopeKey, [reg.playerId], true, trainingDateUtc)) await prisma.trainingOptOut.deleteMany({
          where: { playerId: reg.playerId, trainingDate: trainingDateUtc, reasonCode: "limited_event" },
        });
        const cardCode = reg.player.cards[0]?.cardCode;
        if (cardCode) {
          const payload = buildNotificationPayload({
            type: "limited_training_promoted",
            trainingDate: trainingDateStr,
            url: `/member/${encodeURIComponent(cardCode)}`,
          });
          try {
            await sendPushToMember(reg.playerId, payload, "limited_training_promoted");
          } catch (e) {
            console.error("Waitlist promotion push error:", e);
          }
          publishMemberUpdated(cardCode, "training-updated");
        }
      }
    } else if (maxSpots < oldMaxSpots) {
      // Spots decreased: demote players who were confirmed and are now on the waitlist
      // They are at 0-based indices [newMaxSpots, min(oldMaxSpots, total) - 1]
      const newlyWaitlisted = allRegs.slice(maxSpots, oldMaxSpots);
      for (const reg of newlyWaitlisted) {
        if (!await setLimitedSessionAttendance(id, updated.scopeKey, [reg.playerId], false, trainingDateUtc)) await prisma.trainingOptOut.upsert({
          where: { playerId_trainingDate: { playerId: reg.playerId, trainingDate: trainingDateUtc } },
          create: { playerId: reg.playerId, trainingDate: trainingDateUtc, reasonCode: "limited_event" },
          update: {},
        });
        const cardCode = reg.player.cards[0]?.cardCode;
        if (cardCode) {
          const payload = buildNotificationPayload({
            type: "limited_training_waitlisted",
            trainingDate: trainingDateStr,
            url: `/member/${encodeURIComponent(cardCode)}`,
          });
          try {
            await sendPushToMember(reg.playerId, payload, "limited_training_waitlisted");
          } catch (e) {
            console.error("Waitlist demotion push error:", e);
          }
          publishMemberUpdated(cardCode, "training-updated");
        }
      }
    }

    if (maxSpots !== oldMaxSpots && allRegs.length > 0) {
      publishTrainingAttendanceUpdated(id, trainingDateStr);
    }

    return NextResponse.json({
      event: {
        id: updated.id,
        scopeKey: updated.scopeKey,
        trainingDate: trainingDateStr,
        maxSpots: updated.maxSpots,
        registeredCount: updated._count.registrations,
      },
    });
  } catch (error) {
    console.error("Limited training event PATCH error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, eventId } = await params;

  try {
    const existing = await prisma.limitedTrainingEvent.findFirst({
      where: { id: eventId, clubId: id },
      select: { id: true, scopeKey: true, trainingDate: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Clean up auto-created opt-outs before deleting the event
    try {
      const playerIds = await getPlayerIdsInScope(id, existing.scopeKey);
      if (playerIds.length > 0) {
        if (!await setLimitedSessionAttendance(id, existing.scopeKey, playerIds, true, existing.trainingDate)) await prisma.trainingOptOut.deleteMany({
          where: {
            playerId: { in: playerIds },
            trainingDate: existing.trainingDate,
            reasonCode: "limited_event",
          },
        });
      }
    } catch (cleanupError) {
      console.error("Limited event opt-out cleanup error:", cleanupError);
    }

    await prisma.limitedTrainingEvent.delete({ where: { id: eventId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Limited training event DELETE error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
