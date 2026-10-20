import { updateClubFees, FeeSettingsError } from "@/lib/clubFees";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function verifySession(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  return token ? await verifyAdminToken(token) : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clubId, groupId } = await params;
  if (!UUID_REGEX.test(clubId) || !UUID_REGEX.test(groupId)) {
    return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String((body as { name?: unknown }).name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "name must be at most 100 characters" }, { status: 400 });
  }

  const result = await prisma.coachGroup.updateMany({
    where: { id: groupId, clubId },
    data: { name },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
  }

  const updated = await prisma.coachGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, createdAt: true, updatedAt: true, _count: { select: { players: true } } },
  });

  return NextResponse.json({
    id: updated!.id,
    name: updated!.name,
    createdAt: updated!.createdAt,
    updatedAt: updated!.updatedAt,
    playerCount: updated!._count.players,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  const session = await verifySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clubId, groupId } = await params;
  if (!UUID_REGEX.test(clubId) || !UUID_REGEX.test(groupId)) {
    return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
  }

  try {
    await updateClubFees(clubId, { deleteGroupId: groupId });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof FeeSettingsError) return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: error.status });
    console.error("Coach group deletion error", error);
    return NextResponse.json({ error: "Грешка при изтриване" }, { status: 500 });
  }
}
