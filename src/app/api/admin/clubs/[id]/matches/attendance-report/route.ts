import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { isIsoDate } from "@/lib/training";
import { buildMatchAttendanceReport } from "@/lib/matchAttendanceReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !await verifyAdminToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId } = await params;
  const search = request.nextUrl.searchParams;
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: "Невалиден период." }, { status: 400 });
  }
  const playerId = search.get("playerId")?.trim() || null;
  const coachGroupId = search.get("coachGroupId")?.trim() || null;
  const customGroupId = search.get("customTrainingGroupId")?.trim() || null;
  const trainingGroupId = search.get("trainingGroupId")?.trim() || null;
  const year = search.get("teamGroup");
  const teamGroup = year !== null && year !== "" ? Number(year) : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ([playerId, coachGroupId, customGroupId, trainingGroupId].some((value) => value && !uuid.test(value)) ||
      (teamGroup !== null && !Number.isInteger(teamGroup)) ||
      [customGroupId !== null, trainingGroupId !== null, teamGroup !== null].filter(Boolean).length > 1 ||
      (playerId && (customGroupId || trainingGroupId || teamGroup !== null))) {
    return NextResponse.json({ error: "Невалиден филтър." }, { status: 400 });
  }
  try {
    const [club, coach, custom, combined] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { id: true } }),
      coachGroupId ? prisma.coachGroup.findFirst({ where: { id: coachGroupId, clubId }, select: { id: true } }) : null,
      customGroupId ? prisma.clubCustomTrainingGroup.findFirst({ where: { id: customGroupId, clubId, ...(coachGroupId ? { coachGroupId } : {}) }, select: { id: true } }) : null,
      trainingGroupId ? prisma.clubTrainingScheduleGroup.findFirst({ where: { id: trainingGroupId, clubId }, select: { teamGroups: true } }) : null,
    ]);
    if (!club || (coachGroupId && !coach) || (customGroupId && !custom) || (trainingGroupId && !combined)) {
      return NextResponse.json({ error: "Клубът или групата не е намерен." }, { status: 404 });
    }
    const where: Prisma.PlayerWhereInput = {
      clubId, isActive: true,
      ...(playerId ? { id: playerId } : {}),
      ...(coachGroupId ? { coachGroups: { some: { id: coachGroupId } } } : {}),
      ...(customGroupId ? { customTrainingGroups: { some: { groupId: customGroupId } } } : {}),
      ...(combined ? { teamGroup: { in: combined.teamGroups } } : teamGroup !== null ? { teamGroup } : {}),
    };
    const [players, matches] = await Promise.all([
      prisma.player.findMany({ where, select: { id: true, fullName: true, teamGroup: true, customTrainingGroups: { select: { groupId: true } } }, orderBy: { fullName: "asc" } }),
      prisma.clubMatch.findMany({
        where: {
          clubId, attendanceEnabled: true, matchDate: { gte: from, lte: to },
          ...(customGroupId ? { OR: [{ customGroupId }, { customGroupId: null }] } : coachGroupId ? { OR: [{ customGroup: { coachGroupId } }, { customGroupId: null }] } : {}),
        },
        select: { id: true, matchDate: true, matchTime: true, opponent: true, customGroupId: true, teamGroups: true, players: { select: { playerId: true, present: true, reasonCode: true, reasonText: true } } },
        orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }, { id: "asc" }],
      }),
    ]);
    if (playerId && players.length === 0) return NextResponse.json({ error: "Играчът не е намерен." }, { status: 404 });
    return NextResponse.json(buildMatchAttendanceReport(matches, players));
  } catch (error) {
    console.error("Game attendance report failed:", error);
    return NextResponse.json({ error: "Неуспешно зареждане на присъствията за мачове." }, { status: 500 });
  }
}
