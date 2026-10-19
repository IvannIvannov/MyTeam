import { isMatchEventType } from "@/lib/matchEventType";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { isIsoDate, isValidTrainingTime } from "@/lib/training";
import { getMatchOverlapWarnings } from "@/lib/matchConflicts";
import { hasMatchFinished, parseMatchResult } from "@/lib/matchResult";
import {
  hasMatchScheduleChanged,
  sendMatchScheduleNotifications,
} from "@/lib/push/matchScheduleNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; matchId: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, matchId } = await params;

  const existing = await prisma.clubMatch.findFirst({
    where: { id: matchId, clubId: id },
    select: {
      id: true,
      customGroupId: true,
      eventType: true, opponent: true,
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
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  if (Object.hasOwn(body, "eventType")) {
    if (!isMatchEventType(body.eventType)) return NextResponse.json({ error: "Невалиден вид събитие." }, { status: 400 });
    update.eventType = body.eventType;
  }
  if (Object.hasOwn(body, "opponent")) {
    const opponent = String(body.opponent ?? "").trim();
    if (opponent.length > 200) return NextResponse.json({ error: "Съперник е твърде дълъг." }, { status: 400 });
    update.opponent = opponent;
  }
  if (Object.hasOwn(body, "location")) {
    const location = String(body.location ?? "").trim();
    if (!location) return NextResponse.json({ error: "Място е задължително." }, { status: 400 });
    if (location.length > 200) return NextResponse.json({ error: "Място е твърде дълго." }, { status: 400 });
    update.location = location;
  }
  if (Object.hasOwn(body, "matchDate")) {
    const matchDate = String(body.matchDate ?? "").trim();
    if (!isIsoDate(matchDate)) return NextResponse.json({ error: "Невалидна дата." }, { status: 400 });
    update.matchDate = matchDate;
  }
  if (Object.hasOwn(body, "matchTime")) {
    const matchTime = String(body.matchTime ?? "").trim();
    if (!isValidTrainingTime(matchTime)) return NextResponse.json({ error: "Невалиден час." }, { status: 400 });
    update.matchTime = matchTime;
  }
  if (Object.hasOwn(body, "durationMinutes")) {
    const raw = Number.parseInt(String(body.durationMinutes ?? "").trim(), 10);
    if (!Number.isInteger(raw) || raw < 1 || raw > 1440) return NextResponse.json({ error: "Невалидна продължителност." }, { status: 400 });
    update.durationMinutes = raw;
  }
  if (Object.hasOwn(body, "isHome")) {
    update.isHome = Boolean(body.isHome);
  }
  if (Object.hasOwn(body, "teamGroups")) {
    update.teamGroups = normalizeTeamGroups(body.teamGroups);
  }
  if (Object.hasOwn(body, "customGroupId")) {
    const raw = typeof body.customGroupId === "string" ? body.customGroupId.trim() : null;
    update.customGroupId = raw || null;
  }

  let matchConflictWarning: string | null = null;
  const finalDate = (update.matchDate as string | undefined) ?? existing.matchDate;
  const finalTime = (update.matchTime as string | undefined) ?? existing.matchTime;
  const finalDuration = (update.durationMinutes as number | undefined) ?? existing.durationMinutes;
  const finalTeamGroups = (update.teamGroups as number[] | undefined) ?? existing.teamGroups;
  const finalCustomGroupId = (update.customGroupId as string | null | undefined) ?? existing.customGroupId;
  const finalIsHome = (update.isHome as boolean | undefined) ?? existing.isHome;
  const finalTiming = { matchDate: finalDate, matchTime: finalTime, durationMinutes: finalDuration };
  const hasResultUpdate = Object.hasOwn(body, "homeScore") || Object.hasOwn(body, "awayScore");
  if (hasResultUpdate) {
    const result = parseMatchResult(body);
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    if (!body.expectedResult || typeof body.expectedResult !== "object" || Array.isArray(body.expectedResult)) {
      return NextResponse.json({ error: "Липсва първоначалният резултат. Презаредете данните и опитайте отново." }, { status: 400 });
    }
    const expected = parseMatchResult(body.expectedResult as Record<string, unknown>);
    if ("error" in expected) return NextResponse.json({ error: "Невалиден първоначален резултат." }, { status: 400 });
    if (existing.homeScore !== expected.homeScore || existing.awayScore !== expected.awayScore) {
      return NextResponse.json({ error: "Резултатът е променен от друг потребител. Презаредете данните и опитайте отново." }, { status: 409 });
    }
    if (result.homeScore !== null && (!hasMatchFinished(existing) || !hasMatchFinished(finalTiming))) {
      return NextResponse.json({ error: "Резултат може да се зададе само след края на мача." }, { status: 400 });
    }
    Object.assign(update, result);
  }
  if (existing.homeScore !== null && !hasMatchFinished(finalTiming) && !(hasResultUpdate && update.homeScore === null)) {
    return NextResponse.json({ error: "Изчистете резултата, преди да преместите мача в бъдещето." }, { status: 400 });
  }
  const scheduleChanged = finalDate !== existing.matchDate || finalTime !== existing.matchTime || finalDuration !== existing.durationMinutes || finalIsHome !== existing.isHome || finalCustomGroupId !== existing.customGroupId || JSON.stringify(finalTeamGroups) !== JSON.stringify(existing.teamGroups);
  if (scheduleChanged) {
    const warnings = await getMatchOverlapWarnings({ clubId: id, matchDate: finalDate, matchTime: finalTime, durationMinutes: finalDuration, isHome: finalIsHome, excludeMatchId: matchId });
    matchConflictWarning = warnings.length ? warnings.join("\n") : null;
  }

  const match = await prisma.clubMatch.update({
    // Keep result and schedule validation valid through the write. PostgreSQL
    // rechecks this predicate after a concurrent writer releases the row lock.
    where: {
      id: matchId,
      clubId: id,
      matchDate: existing.matchDate,
      matchTime: existing.matchTime,
      durationMinutes: existing.durationMinutes,
      homeScore: existing.homeScore,
      awayScore: existing.awayScore,
    },
    data: update,
    select: { id: true, customGroupId: true, eventType: true, opponent: true, location: true, matchDate: true, matchTime: true, durationMinutes: true, isHome: true, teamGroups: true, homeScore: true, awayScore: true },
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return null;
    throw error;
  });
  if (!match) {
    return NextResponse.json({ error: "Мачът е променен от друг потребител. Презаредете данните и опитайте отново." }, { status: 409 });
  }

  let notifications = null;
  if (hasMatchScheduleChanged(existing, match)) {
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
        action: "updated",
        previousMatch: existing,
        match,
        playerIds: notifyPlayerIds,
        teamGroups: notifyTeamGroups,
      });
    } catch (error) {
      console.error("Match schedule update notifications failed:", error);
    }
  }

  return NextResponse.json(matchConflictWarning ? { match, notifications, warning: matchConflictWarning } : { match, notifications });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; matchId: string }> },
) {
  const session = await verifySession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, matchId } = await params;

  const existing = await prisma.clubMatch.findFirst({ where: { id: matchId, clubId: id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.clubMatch.delete({ where: { id: matchId } });

  return NextResponse.json({ success: true });
}
