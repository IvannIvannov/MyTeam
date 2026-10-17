import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { prisma, withPrismaPoolRetry } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.roles.some((role) => role === "admin" || role === "coach")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clubId = request.nextUrl.searchParams.get("clubId")?.trim();
  if (!clubId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clubId)) {
    return NextResponse.json({ error: "Невалиден клуб." }, { status: 400 });
  }

  try {
    const players = await withPrismaPoolRetry(() => prisma.player.findMany({
      where: { clubId, isActive: true },
      select: {
        id: true,
        fullName: true,
        _count: { select: { pushSubscriptions: { where: { isActive: true } } } },
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }));
    return NextResponse.json({
      players: players.map((player) => ({
        id: player.id,
        fullName: player.fullName,
        activeDeviceCount: player._count.pushSubscriptions,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to fetch player push device counts:", error);
    return NextResponse.json({ error: "Неуспешно зареждане на устройствата." }, { status: 500 });
  }
}
