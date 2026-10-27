import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";
import { buildNotificationPayload } from "@/lib/push/templates";
import { sendPushToMember } from "@/lib/push/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.roles.includes("admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { message, audience, clubIds } = body as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim() || message.trim().length > 1000) {
    return NextResponse.json({ error: "Въведете съобщение до 1000 символа." }, { status: 400 });
  }
  if (audience !== "all" && audience !== "clubs") {
    return NextResponse.json({ error: "Изберете получатели." }, { status: 400 });
  }
  if (audience === "clubs" && (!Array.isArray(clubIds) || !clubIds.length ||
      clubIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
    return NextResponse.json({ error: "Изберете поне един валиден клуб." }, { status: 400 });
  }

  try {
    const selectedIds = audience === "clubs" ? [...new Set(clubIds as string[])] : [];
    if (audience === "clubs") {
      const count = await prisma.club.count({ where: { id: { in: selectedIds } } });
      if (count !== selectedIds.length) {
        return NextResponse.json({ error: "Избран клуб не съществува." }, { status: 400 });
      }
    }
    const players = await prisma.player.findMany({
      where: audience === "clubs" ? { clubId: { in: selectedIds } } : {},
      select: { id: true, cards: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { cardCode: true } } },
    });
    if (!players.length) return NextResponse.json({ error: "Няма състезатели в избрания обхват." }, { status: 404 });
    const summary = { total: 0, sent: 0, failed: 0, deactivated: 0 };
    let failedPlayers = 0;
    // Bound concurrency when broadcasting across every club.
    for (let offset = 0; offset < players.length; offset += 20) {
      await Promise.all(players.slice(offset, offset + 20).map(async player => {
        try {
          const payload = buildNotificationPayload({ type: "myteam_message", trainerMessage: message.trim(),
            url: player.cards[0] ? `/member/${player.cards[0].cardCode}` : "/" });
          const result = await sendPushToMember(player.id, payload, "myteam_message");
          summary.total += result.total;
          summary.sent += result.sent;
          summary.failed += result.failed;
          summary.deactivated += result.deactivated;
        } catch (error) {
          failedPlayers += 1;
          console.error("Player notification send error:", error);
        }
      }));
    }
    return NextResponse.json({ targetedPlayers: players.length, failedPlayers, summary });
  } catch (error) {
    console.error("Admin player broadcast error:", error);
    return NextResponse.json({ error: "Неуспешно изпращане на известия." }, { status: 500 });
  }
}
