import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMatchScheduleRange } from "@/lib/matchScheduleWindow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> },
) {
  const { cardCode } = await params;
  const normalizedCardCode = cardCode.trim().toUpperCase();

  const card = await prisma.card.findFirst({
    where: { cardCode: normalizedCardCode, isActive: true },
    select: {
      player: {
        select: {
          id: true,
          clubId: true,
          teamGroup: true,
          isActive: true,
        },
      },
    },
  });

  if (!card?.player?.isActive) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { id: playerId, clubId, teamGroup } = card.player;

  // Fetch the custom group IDs this player belongs to
  const customGroupMemberships = await prisma.clubCustomTrainingGroupPlayer.findMany({
    where: { playerId },
    select: { groupId: true },
  });
  const playerCustomGroupIds = new Set(customGroupMemberships.map((m) => m.groupId));

  const { from: todayIso, to: endIso } = getMatchScheduleRange();

  const allMatches = await prisma.clubMatch.findMany({
    where: { clubId, matchDate: { gte: todayIso, lte: endIso } },
    orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }],
    select: { attendanceEnabled: true, players: { where: { playerId }, select: { present: true, reasonCode: true, reasonText: true } }, id: true, customGroupId: true, description: true, category: true, eventType: true, opponent: true, location: true, matchDate: true, matchTime: true, durationMinutes: true, isHome: true, teamGroups: true },
  });

  const matches = allMatches.filter((m) => {
    // Custom-group match: only visible to members of that specific group
    if (m.customGroupId !== null) {
      return playerCustomGroupIds.has(m.customGroupId);
    }
    // Club-wide or team-group match
    return m.teamGroups.length === 0 || (teamGroup !== null && m.teamGroups.includes(teamGroup));
  });

  // Strip customGroupId before sending to client
  return NextResponse.json({ matches: matches.map((match) => ({
    id: match.id, description: match.description, category: match.category, eventType: match.eventType, opponent: match.opponent, location: match.location,
    matchDate: match.matchDate, matchTime: match.matchTime, durationMinutes: match.durationMinutes,
    isHome: match.isHome, teamGroups: match.teamGroups, attendanceEnabled: match.attendanceEnabled,
    present: match.players[0]?.present ?? true,
    reasonCode: match.players[0]?.reasonCode ?? null,
    reasonText: match.players[0]?.reasonText ?? null,
  })) });
}
