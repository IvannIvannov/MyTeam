import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { UUID_PATTERN } from "@/lib/clubSubscriptionDomain";
import { prisma } from "@/lib/db";

export async function authorizeFacebookClub(request: NextRequest, clubId: string) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session || !token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID_PATTERN.test(clubId)) return NextResponse.json({ error: "Invalid club" }, { status: 400 });
  // Matches existing admin/coach club authorization. Unscoped sessions are club-wide.
  if (!session.roles.includes("admin") && session.defaultClubId && session.defaultClubId !== clubId) return NextResponse.json({ error: "Профилът ви няма достъп до този клуб.", code: "FACEBOOK_CLUB_FORBIDDEN" }, { status: 403 });
  if (!await prisma.club.findUnique({ where: { id: clubId }, select: { id: true } })) return NextResponse.json({ error: "Club not found" }, { status: 404 });
  return { token, session };
}
