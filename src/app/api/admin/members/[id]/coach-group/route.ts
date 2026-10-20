import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updateClubFees, FeeSettingsError } from "@/lib/clubFees";
import { verifyAdminToken } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds = (body as { coachGroupIds?: unknown }).coachGroupIds;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ error: "coachGroupIds must be an array" }, { status: 400 });
  }

  const coachGroupIds = rawIds.map((v) => String(v ?? "").trim()).filter(Boolean);
  for (const gid of coachGroupIds) {
    if (!UUID_REGEX.test(gid)) {
      return NextResponse.json({ error: `Invalid coachGroupId: ${gid}` }, { status: 400 });
    }
  }

  const player = await prisma.player.findUnique({
    where: { id },
    select: { id: true, clubId: true, coachGroups: { select: { id: true } } },
  });

  if (!player) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (coachGroupIds.length > 0) {
    const validGroups = await prisma.coachGroup.findMany({
      where: { id: { in: coachGroupIds }, clubId: player.clubId },
      select: { id: true },
    });
    if (validGroups.length !== coachGroupIds.length) {
      return NextResponse.json({ error: "One or more coach groups not found" }, { status: 404 });
    }
  }

  try {
    await updateClubFees(player.clubId, {
      assignments: { [id]: coachGroupIds },
      ...((body as { billingCoachGroupId?: string }).billingCoachGroupId ? { billingChoices: { [id]: (body as { billingCoachGroupId: string }).billingCoachGroupId } } : {}),
    });
    return NextResponse.json({ success: true, id, coachGroupIds });
  } catch (error) {
    if (error instanceof FeeSettingsError) return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: error.status });
    throw error;
  }
}
