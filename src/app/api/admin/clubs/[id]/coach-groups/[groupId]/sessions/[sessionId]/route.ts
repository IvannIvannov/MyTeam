import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { utcDateToIsoDate } from "@/lib/training";

export const runtime = "nodejs";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; groupId: string; sessionId: string }> }) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !await verifyAdminToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId, groupId, sessionId } = await params;
  const session = await prisma.trainingSession.findFirst({ where: { id: sessionId, clubId, scopeType: "coachGroup", scopeId: groupId } });
  if (!session) return NextResponse.json({ error: "Training not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.playerId !== "string" || typeof body.present !== "boolean") return NextResponse.json({ error: "Player and attendance are required" }, { status: 400 });
  const reasonCode = body.present ? null : body.reasonCode ?? null;
  if (reasonCode !== null && !["injury", "sick", "other"].includes(reasonCode)) return NextResponse.json({ error: "Invalid absence reason" }, { status: 400 });
  const reasonText = body.present ? null : String(body.reasonText ?? "").trim() || null;
  const result = await prisma.trainingSessionPlayer.updateMany({ where: { trainingSessionId: session.id, playerId: body.playerId }, data: { present: body.present, reasonCode, reasonText, attendanceRecorded: true } });
  if (!result.count) return NextResponse.json({ error: "Player not enrolled in training" }, { status: 404 });
  publishTrainingAttendanceUpdated(clubId, utcDateToIsoDate(session.trainingDate));
  return NextResponse.json({ success: true });
}
