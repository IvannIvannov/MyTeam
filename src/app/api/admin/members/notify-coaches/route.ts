import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";
import { buildNotificationPayload } from "@/lib/push/templates";
import { saveAdminNotificationHistory } from "@/lib/push/adminHistory";
import { sendPushToClubAdmins } from "@/lib/push/adminService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.roles.some(role => role === "admin" || role === "coach")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Невалидни данни" }, { status: 400 });
  const raw = body as { clubId?: unknown; coachGroupIds?: unknown; message?: unknown };
  if (!isUuid(raw.clubId) || !Array.isArray(raw.coachGroupIds) || !raw.coachGroupIds.length ||
      raw.coachGroupIds.length > 500 || !raw.coachGroupIds.every(isUuid)) {
    return NextResponse.json({ error: "Изберете валиден клуб и треньорски групи" }, { status: 400 });
  }
  if (typeof raw.message !== "string" || !raw.message.trim()) {
    return NextResponse.json({ error: "Въведете съобщение" }, { status: 400 });
  }
  const clubId = raw.clubId;
  const notificationType = session.roles.includes("admin") ? "myteam_message" : "admin_message";
  const groupIds = [...new Set(raw.coachGroupIds as string[])];
  const groups = await prisma.coachGroup.findMany({ where: { clubId, id: { in: groupIds } }, select: { id: true } });
  if (groups.length !== groupIds.length) {
    return NextResponse.json({ error: "Треньорската група не принадлежи на този клуб" }, { status: 400 });
  }
  let delivered = 0;
  let sent = 0;
  let failed = 0;
  let pushFailed = 0;
  for (const group of groups) {
    const payload = buildNotificationPayload({
      type: "admin_message", trainerMessage: raw.message.trim(),
      url: `/admin/members?clubId=${encodeURIComponent(clubId)}&coachGroupId=${encodeURIComponent(group.id)}`,
    });
    payload.title = "Съобщение до треньори";
    // Store the page message even when no device is subscribed or push fails.
    try {
      await saveAdminNotificationHistory({ clubId, coachGroupId: group.id, type: notificationType, payload });
      delivered += 1;
    } catch {
      failed += 1;
      continue;
    }
    try {
      const result = await sendPushToClubAdmins(clubId, payload, group.id);
      sent += result.sent;
      pushFailed += result.failed;
    } catch { pushFailed += 1; }
  }
  return NextResponse.json({ success: failed === 0, delivered, sent, failed, pushFailed });
}
