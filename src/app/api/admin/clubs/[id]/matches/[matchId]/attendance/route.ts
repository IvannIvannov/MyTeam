import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { changeMatchAttendance, getMatchAttendance } from "@/lib/matchAttendance";
import { parseMatchAttendance } from "@/lib/matchAttendanceRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; matchId: string }> };
async function session(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? verifyAdminToken(token) : null;
}
export async function GET(request: NextRequest, { params }: Context) {
  if (!await session(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, matchId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) return NextResponse.json({ error: "Невалиден мач." }, { status: 400 });
  const result = await getMatchAttendance(id, matchId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Мачът не е намерен." }, { status: 404 });
}
export async function PATCH(request: NextRequest, { params }: Context) {
  if (!await session(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, matchId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) return NextResponse.json({ error: "Невалиден мач." }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const attendance = parseMatchAttendance(body);
  if ("error" in attendance) return NextResponse.json(attendance, { status: 400 });
  if (typeof body?.playerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.playerId)) return NextResponse.json({ error: "Невалиден играч." }, { status: 400 });
  const saved = await changeMatchAttendance({ clubId: id, matchId, playerId: body.playerId, attendance, byCoach: true });
  return saved ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Мачът или играчът не е достъпен за промяна." }, { status: 404 });
}
