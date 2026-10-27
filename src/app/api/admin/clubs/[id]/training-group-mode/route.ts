import { ENABLE_TEAM_GROUP_ERROR } from "@/lib/playerFields";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

function normalizeMode(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (value === "team_group" || value === "custom_group") {
    return value;
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.roles.includes("admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const trainingGroupMode = normalizeMode((body as { trainingGroupMode?: unknown }).trainingGroupMode);
  if (!trainingGroupMode) {
    return NextResponse.json({ error: "Invalid trainingGroupMode." }, { status: 400 });
  }

  try {
    const club = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM clubs WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.club.findUnique({ where: { id }, select: { playerFields: true } });
      if (!current) return null;
      if (trainingGroupMode === "team_group" && !current.playerFields.includes("teamGroup")) return false;
      return tx.club.update({ where: { id }, data: { trainingGroupMode }, select: { id: true, trainingGroupMode: true } });
    });
    if (club === null) return NextResponse.json({ error: "Club not found" }, { status: 404 });
    if (club === false) return NextResponse.json({ error: ENABLE_TEAM_GROUP_ERROR }, { status: 409 });
    return NextResponse.json(club);
  } catch (error) {
    console.error("Training group mode PATCH error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
