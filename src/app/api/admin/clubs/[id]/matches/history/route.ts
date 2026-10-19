import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getTodayIsoDateInTimeZone, isIsoDate } from "@/lib/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !await verifyAdminToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId } = await params;
  const search = request.nextUrl.searchParams;
  const from = search.get("from")?.trim() || "";
  const to = search.get("to")?.trim() || "";
  const opponent = search.get("search")?.trim() || "";
  const coachGroupId = search.get("coachGroupId")?.trim() || null;
  const customGroupId = search.get("customGroupId")?.trim() || null;
  const rawPage = search.get("page") || "1";
  const page = Number(rawPage);
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to) || opponent.length > 200 ||
    !/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 100000 ||
    [coachGroupId, customGroupId].some((id) => id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ error: "Невалиден период или филтър." }, { status: 400 });
  }
  try {
    const [club, coach] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { id: true } }),
      coachGroupId ? prisma.coachGroup.findFirst({ where: { id: coachGroupId, clubId }, select: { players: { select: { teamGroup: true } } } }) : null,
    ]);
    if (!club || (coachGroupId && !coach)) return NextResponse.json({ error: "Клубът или треньорската група не е намерен." }, { status: 404 });
    const today = getTodayIsoDateInTimeZone("Europe/Sofia");
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const filters: Prisma.ClubMatchWhereInput[] = [
      { OR: [{ matchDate: { lt: today } }, { matchDate: today, matchTime: { lte: time } }] },
    ];
    if (coachGroupId && coach) {
      const years = [...new Set(coach.players.map((player) => player.teamGroup).filter((year): year is number => year !== null))];
      filters.push({ OR: [
        { customGroup: { coachGroupId } },
        { customGroupId: null, OR: [{ teamGroups: { isEmpty: true } }, { teamGroups: { hasSome: years } }] },
      ] });
    }
    if (opponent) filters.push({ OR: [{ opponent: { contains: opponent, mode: "insensitive" } }, { location: { contains: opponent, mode: "insensitive" } }] });
    const where: Prisma.ClubMatchWhereInput = {
      clubId, AND: filters,
      ...((from || to) ? { matchDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    if (customGroupId) filters.push({ customGroupId });
    const [total, matches, customGroups, recentForm] = await Promise.all([
      prisma.clubMatch.count({ where }),
      prisma.clubMatch.findMany({ where, orderBy: [{ matchDate: "desc" }, { matchTime: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
        select: { id: true, description: true, category: true, eventType: true, opponent: true, location: true, matchDate: true, matchTime: true, durationMinutes: true, isHome: true, teamGroups: true, attendanceEnabled: true, homeScore: true, awayScore: true, customGroup: { select: { name: true } } },
      }),
      prisma.clubCustomTrainingGroup.findMany({ where: { clubId, ...(coachGroupId ? { coachGroupId } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.clubMatch.findMany({
        where: { ...where, homeScore: { not: null }, awayScore: { not: null } },
        orderBy: [{ matchDate: "desc" }, { matchTime: "desc" }, { id: "desc" }], take: 5,
        select: { id: true, description: true, category: true, eventType: true, opponent: true, matchDate: true, homeScore: true, awayScore: true, isHome: true },
      }),
    ]);
    return NextResponse.json({ matches, total, page, pageSize: PAGE_SIZE, customGroups, recentForm });
  } catch (error) {
    console.error("Game history failed:", error);
    return NextResponse.json({ error: "Неуспешно зареждане на историята на мачовете." }, { status: 500 });
  }
}
