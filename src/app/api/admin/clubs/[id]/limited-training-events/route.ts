import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { sendPushToMember } from "@/lib/push/service";
import { buildNotificationPayload } from "@/lib/push/templates";
import { getLimitedTrainingSessionId, setLimitedSessionAttendance } from "@/lib/limitedTrainingSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPE_KEY_RE = /^(team_group:\d+|custom_group:[0-9a-f-]{36}|coach_group:[0-9a-f-]{36}(?::session:[0-9a-f-]{36})?)$/i;

function isIsoDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

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
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const from = request.nextUrl.searchParams.get("from")?.trim() ?? "";
  const to = request.nextUrl.searchParams.get("to")?.trim() ?? "";
  const scopeKey = request.nextUrl.searchParams.get("scopeKey")?.trim() ?? "";
  const date = request.nextUrl.searchParams.get("date")?.trim() ?? "";

  const where: Record<string, unknown> = { clubId: id };

  if (date && isIsoDate(date)) {
    where.trainingDate = new Date(date + "T00:00:00.000Z");
  } else if (from && to && isIsoDate(from) && isIsoDate(to)) {
    where.trainingDate = {
      gte: new Date(from + "T00:00:00.000Z"),
      lte: new Date(to + "T00:00:00.000Z"),
    };
  }

  if (scopeKey) {
    where.scopeKey = scopeKey;
  }

  try {
    const events = await prisma.limitedTrainingEvent.findMany({
      where,
      select: {
        id: true,
        scopeKey: true,
        scopeId: true,
        teamGroup: true,
        trainingDate: true,
        maxSpots: true,
        createdAt: true,
        _count: { select: { registrations: true } },
      },
      orderBy: { trainingDate: "asc" },
    });

    return NextResponse.json(
      events.map((e) => ({
        id: e.id,
        scopeKey: e.scopeKey,
        scopeId: e.scopeId,
        teamGroup: e.teamGroup,
        trainingDate: e.trainingDate.toISOString().slice(0, 10),
        maxSpots: e.maxSpots,
        registeredCount: e._count.registrations,
        createdAt: e.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    console.error("Limited training events GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const scopeKey = typeof b.scopeKey === "string" ? b.scopeKey.trim() : "";
  const scopeId = typeof b.scopeId === "string" ? b.scopeId.trim() || null : null;
  const teamGroup = b.teamGroup === null || b.teamGroup === undefined ? null : Number(b.teamGroup);
  const trainingDate = typeof b.trainingDate === "string" ? b.trainingDate.trim() : "";
  const maxSpots = typeof b.maxSpots === "number" ? b.maxSpots : Number(b.maxSpots);

  if (!VALID_SCOPE_KEY_RE.test(scopeKey)) {
    return NextResponse.json({ error: "Invalid scopeKey format" }, { status: 400 });
  }
  if (!isIsoDate(trainingDate)) {
    return NextResponse.json({ error: "Invalid trainingDate" }, { status: 400 });
  }
  if (!Number.isInteger(maxSpots) || maxSpots < 1 || maxSpots > 200) {
    return NextResponse.json({ error: "maxSpots must be an integer between 1 and 200" }, { status: 400 });
  }
  if (teamGroup !== null && !Number.isInteger(teamGroup)) {
    return NextResponse.json({ error: "Invalid teamGroup" }, { status: 400 });
  }

  try {
    const club = await prisma.club.findUnique({ where: { id }, select: { id: true } });
    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    const trainingDateUtc = new Date(trainingDate + "T00:00:00.000Z");
    const trainingSessionId = getLimitedTrainingSessionId(scopeKey);
    if (trainingSessionId && !await prisma.trainingSession.findFirst({ where: { id: trainingSessionId, clubId: id, scopeId: scopeKey.split(":")[1], scopeType: "coachGroup", status: "scheduled", trainingDate: trainingDateUtc }, select: { id: true } })) return NextResponse.json({ error: "Training not found" }, { status: 404 });

    const event = await prisma.limitedTrainingEvent.create({
      data: {
        clubId: id,
        scopeKey,
        scopeId: scopeId || null,
        teamGroup: teamGroup,
        trainingDate: trainingDateUtc,
        maxSpots,
      },
      select: {
        id: true,
        scopeKey: true,
        scopeId: true,
        teamGroup: true,
        trainingDate: true,
        maxSpots: true,
        createdAt: true,
      },
    });

    // Auto-opt-out all players in scope so attendance starts at zero.
    // Admin manually marks who actually showed up on the day.
    // Also notify each player via push so they know to sign up.
    try {
      const playerIds = await getPlayerIdsInScope(id, scopeKey);
      if (playerIds.length > 0) {
        if (!await setLimitedSessionAttendance(id, scopeKey, playerIds, false, trainingDateUtc)) await prisma.trainingOptOut.createMany({
          data: playerIds.map((playerId) => ({
            playerId,
            trainingDate: trainingDateUtc,
            reasonCode: "limited_event",
          })),
          skipDuplicates: true,
        });

        // Send push to each player — fire-and-forget, non-fatal
        const playersWithCards = await prisma.player.findMany({
          where: { id: { in: playerIds } },
          select: {
            id: true,
            cards: { where: { isActive: true }, select: { cardCode: true }, take: 1 },
          },
        });

        await Promise.all(
          playersWithCards.map(async (p) => {
            const cardCode = p.cards[0]?.cardCode;
            if (!cardCode) return;
            const payload = buildNotificationPayload({
              type: "limited_training_created",
              trainingDate,
              maxSpots,
              url: `/member/${encodeURIComponent(cardCode)}`,
            });
            try {
              await sendPushToMember(p.id, payload, "limited_training_created");
            } catch (e) {
              console.error("Limited event player push error:", e);
            }
          }),
        );
      }
    } catch (optOutError) {
      console.error("Limited event auto opt-out error:", optOutError);
      // Non-fatal: event was created, opt-outs are best-effort
    }

    return NextResponse.json({
      event: {
        id: event.id,
        scopeKey: event.scopeKey,
        scopeId: event.scopeId,
        teamGroup: event.teamGroup,
        trainingDate: event.trainingDate.toISOString().slice(0, 10),
        maxSpots: event.maxSpots,
        registeredCount: 0,
        createdAt: event.createdAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const e = error as { code?: string };
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A limited event already exists for this scope and date" }, { status: 409 });
    }
    console.error("Limited training events POST error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
