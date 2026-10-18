import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { changeMatchAttendance } from "@/lib/matchAttendance";
import { parseMatchAttendance } from "@/lib/matchAttendanceRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ cardCode: string; matchId: string }> }) {
  const { cardCode, matchId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) return NextResponse.json({ error: "Невалиден мач." }, { status: 400 });
  const card = await prisma.card.findFirst({ where: { cardCode: cardCode.trim().toUpperCase(), isActive: true, player: { isActive: true } }, select: { player: { select: { id: true, clubId: true } } } });
  if (!card?.player) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const attendance = parseMatchAttendance(await request.json().catch(() => ({})));
  if ("error" in attendance) return NextResponse.json(attendance, { status: 400 });
  const saved = await changeMatchAttendance({ clubId: card.player.clubId, matchId, playerId: card.player.id, attendance, byCoach: false });
  return saved ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Мачът не е достъпен за промяна." }, { status: 404 });
}
