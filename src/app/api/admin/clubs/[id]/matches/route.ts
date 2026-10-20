import { isMatchCategory } from "@/lib/matchCategory";
import { isMatchEventType } from "@/lib/matchEventType";
import { matchPlayerWhere } from "@/lib/matchAttendanceRules";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { isIsoDate, isValidTrainingTime, getTodayIsoDateInTimeZone } from "@/lib/training";
import { getMatchOverlapWarnings } from "@/lib/matchConflicts";
import { sendMatchScheduleNotifications } from "@/lib/push/matchScheduleNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXED_TIME_ZONE = "Europe/Sofia";
const MATCH_WINDOW_DAYS = 60;

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

function normalizeTeamGroups(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const unique = Array.from(
    new Set(
      raw
        .map((v) => Number.parseInt(String(v ?? "").trim(), 10))
        .filter((v) => Number.isInteger(v) && v >= 0),
    ),
  );
  return unique.sort((a, b) => a - b);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const todayIso = getTodayIsoDateInTimeZone(FIXED_TIME_ZONE);
  const endDate = new Date(`${todayIso}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + MATCH_WINDOW_DAYS - 1);
  const endIso = endDate.toISOString().slice(0, 10);

  const matches = await prisma.clubMatch.findMany({
    where: {
      clubId: id,
      matchDate: { gte: todayIso, lte: endIso },
    },
    orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }],
    select: {
      id: true,
      customGroupId: true,
      description: true, category: true, eventType: true, opponent: true,
      location: true,
      matchDate: true,
      matchTime: true,
      durationMinutes: true,
      isHome: true,
      teamGroups: true,
      homeScore: true,
      awayScore: true,
    },
  });

  return NextResponse.json({ matches });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const club = await prisma.club.findUnique({ where: { id }, select: { id: true } });
  if (!club) return NextResponse.json({ error: "Club not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (!isMatchCategory(body.category)) return NextResponse.json({ error: "Изберете Контрола или Официален." }, { status: 400 });
  if (typeof body.description !== "undefined" && typeof body.description !== "string") return NextResponse.json({ error: "Невалидно описание." }, { status: 400 });
  const description = String(body.description ?? "").trim();
  if (description.length > 2000) return NextResponse.json({ error: "Описанието е твърде дълго (максимум 2000 знака)." }, { status: 400 });

  const eventType = body.eventType === undefined ? "match" : body.eventType;
  if (!isMatchEventType(eventType)) return NextResponse.json({ error: "Невалиден вид събитие." }, { status: 400 });

  const opponent = String(body.opponent ?? "").trim();
  if (opponent.length > 200) return NextResponse.json({ error: "Съперник е твърде дълъг." }, { status: 400 });

  const location = String(body.location ?? "").trim();
  if (!location) return NextResponse.json({ error: "Място е задължително." }, { status: 400 });
  if (location.length > 200) return NextResponse.json({ error: "Място е твърде дълго." }, { status: 400 });

  const matchDate = String(body.matchDate ?? "").trim();
  if (!isIsoDate(matchDate)) return NextResponse.json({ error: "Невалидна дата." }, { status: 400 });

  const matchTime = String(body.matchTime ?? "").trim();
  if (!isValidTrainingTime(matchTime)) return NextResponse.json({ error: "Невалиден час." }, { status: 400 });

  const durationRaw = Number.parseInt(String(body.durationMinutes ?? "90").trim(), 10);
  const durationMinutes = Number.isInteger(durationRaw) && durationRaw >= 1 && durationRaw <= 1440 ? durationRaw : 90;

  const isHome = body.isHome !== false;

  const teamGroups = normalizeTeamGroups(body.teamGroups);

  const customGroupIdRaw = typeof body.customGroupId === "string" ? body.customGroupId.trim() : null;
  const customGroupId = customGroupIdRaw || null;

  const warnings = await getMatchOverlapWarnings({ clubId: id, matchDate, matchTime, durationMinutes, isHome });
  const matchConflictWarning = warnings.length ? warnings.join("\n") : null;

  const roster = await prisma.player.findMany({ where: matchPlayerWhere({ clubId: id, customGroupId, teamGroups }), select: { id: true } });
  const match = await prisma.clubMatch.create({
    data: { description, category: body.category, clubId: id, customGroupId, eventType, opponent, location, matchDate, matchTime, durationMinutes, isHome, teamGroups, attendanceEnabled: true, players: { create: roster.map((player) => ({ playerId: player.id })) } },
    select: { id: true, customGroupId: true, description: true, category: true, eventType: true, opponent: true, location: true, matchDate: true, matchTime: true, durationMinutes: true, isHome: true, teamGroups: true },
  });

  let notifications = null;
  try {
    let notifyPlayerIds: string[] | undefined;
    let notifyTeamGroups: number[] | undefined;
    if (match.customGroupId) {
      const members = await prisma.clubCustomTrainingGroupPlayer.findMany({
        where: { groupId: match.customGroupId },
        select: { playerId: true },
      });
      notifyPlayerIds = members.map((m) => m.playerId);
    } else if (match.teamGroups.length > 0) {
      notifyTeamGroups = match.teamGroups;
    }
    notifications = await sendMatchScheduleNotifications({
      clubId: id,
      action: "created",
      match,
      playerIds: notifyPlayerIds,
      teamGroups: notifyTeamGroups,
    });
  } catch (error) {
    console.error("Match schedule notifications failed:", error);
  }

  return NextResponse.json(matchConflictWarning ? { match, notifications, warning: matchConflictWarning } : { match, notifications }, { status: 201 });
}
