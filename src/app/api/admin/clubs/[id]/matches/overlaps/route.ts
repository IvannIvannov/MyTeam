import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { isIsoDate, isValidTrainingTime } from "@/lib/training";
import { getMatchOverlapWarnings } from "@/lib/matchConflicts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !await verifyAdminToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const query = request.nextUrl.searchParams;
  const matchDate = query.get("date") ?? "";
  const matchTime = query.get("time") ?? "";
  const durationMinutes = Number(query.get("duration"));
  const excludeMatchId = query.get("excludeMatchId") || undefined;
  if (!isIsoDate(matchDate) || !isValidTrainingTime(matchTime) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 || (excludeMatchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(excludeMatchId))) {
    return NextResponse.json({ error: "Невалидни данни за мача." }, { status: 400 });
  }
  const warnings = await getMatchOverlapWarnings({ clubId: id, matchDate, matchTime, durationMinutes, isHome: query.get("isHome") === "true", excludeMatchId });
  return NextResponse.json({ warnings });
}
