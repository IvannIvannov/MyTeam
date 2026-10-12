import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { markClubAdminNotificationsRead } from "@/lib/push/adminHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

async function ensureClubExists(clubId: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true },
  });
  return Boolean(club);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clubId } = await params;
  if (!(await ensureClubExists(clubId))) {
    return NextResponse.json({ error: "Club not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const playerIdRaw = (body as { playerId?: unknown }).playerId;
  const playerId = typeof playerIdRaw === "string" && playerIdRaw.trim() ? playerIdRaw.trim() : null;
  const coachGroupIdRaw = (body as { coachGroupId?: unknown }).coachGroupId;
  const coachGroupId =
    typeof coachGroupIdRaw === "string" && coachGroupIdRaw.trim() ? coachGroupIdRaw.trim() : null;

  try {
    const updated = await markClubAdminNotificationsRead({ clubId, playerId, coachGroupId });
    return NextResponse.json({ success: true, markedRead: updated.count });
  } catch (error) {
    console.error("Admin notifications read error:", error);
    return NextResponse.json({ error: "Failed to mark notifications as read." }, { status: 500 });
  }
}
