import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { buildNotificationPayload } from "@/lib/push/templates";
import { sendPushToClubAdmins } from "@/lib/push/adminService";
import { saveAdminNotificationHistory } from "@/lib/push/adminHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.roles.includes("admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { clubIds?: unknown; message?: unknown; includeCoachGroupPages?: unknown };

  if (typeof payload.message !== "string" || !payload.message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const rawClubIds = Array.isArray(payload.clubIds)
    ? payload.clubIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
    : [];

  if (rawClubIds.length === 0) {
    return NextResponse.json({ error: "clubIds is required" }, { status: 400 });
  }

  const message = payload.message.trim();
  const includeCoachGroupPages = payload.includeCoachGroupPages === true;

  const clubs = await prisma.club.findMany({
    where: { id: { in: rawClubIds } },
    select: {
      id: true,
      coachGroups: {
        select: { id: true },
      },
    },
  });
  if (clubs.length === 0) {
    return NextResponse.json({ error: "No clubs found" }, { status: 404 });
  }

  const results = await Promise.all(
    clubs.map(async (club) => {
      const scopes: Array<{ coachGroupId: string | null; url: string }> = [
        {
          coachGroupId: null,
          url: `/admin/members?clubId=${encodeURIComponent(club.id)}`,
        },
        ...(includeCoachGroupPages
          ? club.coachGroups.map((group) => ({
              coachGroupId: group.id,
              url: `/admin/members?clubId=${encodeURIComponent(club.id)}&coachGroupId=${encodeURIComponent(group.id)}`,
            }))
          : []),
      ];

      const scopeResults = await Promise.all(
        scopes.map(async (scope) => {
          const pushPayload = buildNotificationPayload({
            type: "admin_message",
            trainerMessage: message,
            url: scope.url,
          });
          const sendResult = await sendPushToClubAdmins(
            club.id,
            pushPayload,
            scope.coachGroupId,
          );
          await saveAdminNotificationHistory({
            clubId: club.id,
            type: "myteam_message",
            payload: pushPayload,
            coachGroupId: scope.coachGroupId,
          });
          return sendResult;
        }),
      );

      const sendResult = scopeResults.reduce(
        (acc, result) => {
          acc.total += result.total;
          acc.sent += result.sent;
          acc.failed += result.failed;
          acc.deactivated += result.deactivated;
          return acc;
        },
        { total: 0, sent: 0, failed: 0, deactivated: 0 },
      );

      return { clubId: club.id, ...sendResult };
    }),
  );

  const summary = results.reduce(
    (acc, r) => { acc.total += r.total; acc.sent += r.sent; acc.failed += r.failed; acc.deactivated += r.deactivated; return acc; },
    { total: 0, sent: 0, failed: 0, deactivated: 0 },
  );

  return NextResponse.json({ success: true, ...summary, results });
}
