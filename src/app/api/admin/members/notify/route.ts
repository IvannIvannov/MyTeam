import { NextRequest, NextResponse } from "next/server";
import { prisma, withPrismaPoolRetry } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { buildNotificationPayload } from "@/lib/push/templates";
import { sendPushToMember } from "@/lib/push/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = session.roles.includes("admin");
  const isCoach = session.roles.includes("coach");
  if (!isAdmin && !isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body as {
    memberIds?: unknown;
    message?: unknown;
    clubId?: unknown;
    coachGroupId?: unknown;
  };

  if (typeof raw.message !== "string" || !raw.message.trim()) {
    return NextResponse.json({ error: "message е задължително" }, { status: 400 });
  }
  const message = raw.message.trim();

  if (!Array.isArray(raw.memberIds) || raw.memberIds.length === 0) {
    return NextResponse.json({ error: "memberIds е задължително" }, { status: 400 });
  }
  if (raw.memberIds.length > 500) {
    return NextResponse.json({ error: "Прекалено много memberIds (max 500)" }, { status: 400 });
  }
  const memberIds = (raw.memberIds as unknown[]).filter(isUuid);
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Невалидни memberIds" }, { status: 400 });
  }

  if (!isUuid(raw.clubId)) {
    return NextResponse.json({ error: "Невалиден clubId" }, { status: 400 });
  }
  const clubId: string = raw.clubId;

  const coachGroupId =
    typeof raw.coachGroupId === "string" && raw.coachGroupId.trim()
      ? raw.coachGroupId.trim()
      : null;

  if (coachGroupId !== null && !UUID_RE.test(coachGroupId)) {
    return NextResponse.json({ error: "Невалиден coachGroupId" }, { status: 400 });
  }

  const allowedPlayers = await withPrismaPoolRetry(() =>
    prisma.player.findMany({
      where: {
        id: { in: memberIds },
        clubId,
        isActive: true,
        ...(coachGroupId ? { coachGroups: { some: { id: coachGroupId } } } : {}),
      },
      select: {
        id: true,
        fullName: true,
        cards: {
          select: { cardCode: true },
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    })
  );

  const targeted = memberIds.length;
  const skipped = targeted - allowedPlayers.length;

  if (allowedPlayers.length === 0) {
    return NextResponse.json({ success: true, targeted, sent: 0, skipped: targeted, failed: 0 });
  }

  let totalSent = 0;
  let totalFailed = 0;

  await Promise.all(
    allowedPlayers.map(async (player) => {
      const memberName = player.fullName.trim();
      const cardCode = player.cards[0]?.cardCode ?? null;
      const url = cardCode ? `/member/${cardCode}` : "/";

      const payload = buildNotificationPayload({
        type: "trainer_message",
        memberName,
        trainerMessage: message,
        url,
      });

      try {
        const result = await sendPushToMember(player.id, payload, "trainer_message");
        totalSent += result.sent;
        totalFailed += result.failed;
      } catch {
        totalFailed += 1;
      }
    })
  );

  return NextResponse.json({
    success: true,
    targeted,
    sent: totalSent,
    skipped,
    failed: totalFailed,
  });
}
