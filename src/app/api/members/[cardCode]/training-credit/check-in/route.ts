import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { buildNotificationPayload } from "@/lib/push/templates";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";
import { chargeTrainingCheckIn, TrainingCheckInError, trainingCheckInRange } from "@/lib/trainingCheckIn";
import { utcDateToIsoDate } from "@/lib/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ cardCode: string }> };

async function authorized(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const payload = token ? await verifyAdminToken(token) : null;
  return payload && (payload.roles.includes("admin") || payload.roles.includes("coach"));
}

function errorResponse(error: unknown) {
  if (error instanceof TrainingCheckInError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Training check-in error:", error);
  return NextResponse.json({ error: "Неуспешно чекиране. Опитайте отново." }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: Context) {
  if (!await authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { cardCode } = await params;
    const card = await prisma.card.findFirst({ where: { cardCode: cardCode.trim().toUpperCase(), isActive: true, player: { isActive: true } }, select: { playerId: true, player: { select: { clubId: true, club: { select: { paymentWorkflow: true, name: true } } } } } });
    if (!card) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (!["training_credits", "training_credits_30_days"].includes(card.player.club.paymentWorkflow)) throw new TrainingCheckInError("Чекирането изисква плащане с брой тренировки.");
    const range = trainingCheckInRange();
    const [rows, coachGroups, customGroups, trainingGroups] = await Promise.all([
      prisma.trainingSessionPlayer.findMany({
        where: { playerId: card.playerId, present: false, trainingSession: { clubId: card.player.clubId, status: "scheduled", trainingDate: { gte: range.from, lte: range.to } } },
        include: { trainingSession: true },
        orderBy: [{ trainingSession: { trainingDate: "desc" } }, { trainingSession: { trainingTime: "desc" } }, { trainingSessionId: "asc" }],
      }),
      prisma.coachGroup.findMany({ where: { clubId: card.player.clubId }, select: { id: true, name: true } }),
      prisma.clubCustomTrainingGroup.findMany({ where: { clubId: card.player.clubId }, select: { id: true, name: true } }),
      prisma.clubTrainingScheduleGroup.findMany({ where: { clubId: card.player.clubId }, select: { id: true, name: true } }),
    ]);
    const names = new Map<string, string>([
      ...coachGroups.map((g) => [`coach_group:${g.id}`, g.name] as const),
      ...customGroups.map((g) => [`custom_group:${g.id}`, g.name] as const),
      ...trainingGroups.map((g) => [`training_group:${g.id}`, g.name] as const),
    ]);
    return NextResponse.json({ trainings: rows.map((row) => ({
      id: row.trainingSessionId, date: utcDateToIsoDate(row.trainingSession.trainingDate), time: row.trainingSession.trainingTime,
      groupName: names.get(row.trainingSession.scopeKey) || (row.trainingSession.teamGroup !== null ? `Отбор ${row.trainingSession.teamGroup}` : card.player.club.name),
      reasonCode: row.reasonCode, reasonText: row.reasonText, charged: !!row.creditChargedAt,
    })) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!await authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const trainingSessionId = body?.trainingSessionId;
    if (typeof trainingSessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trainingSessionId)) throw new TrainingCheckInError("Изберете тренировка.");
    const { cardCode } = await params;
    const normalizedCardCode = cardCode.trim().toUpperCase();
    const result = await prisma.$transaction(async (tx) => {
      const card = await tx.card.findFirst({ where: { cardCode: normalizedCardCode, isActive: true, player: { isActive: true } }, select: { playerId: true } });
      if (!card) throw new TrainingCheckInError("Member not found", 404);
      // Serialize check-ins for a player, even when they select different trainings.
      await tx.$queryRaw`SELECT id FROM players WHERE id = ${card.playerId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM training_sessions WHERE id = ${trainingSessionId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM training_session_players WHERE training_session_id = ${trainingSessionId}::uuid AND player_id = ${card.playerId}::uuid FOR UPDATE`;
      return chargeTrainingCheckIn(tx, card.playerId, trainingSessionId);
    });
    if (result.changed) {
      publishMemberUpdated(normalizedCardCode, "status-updated");
      publishTrainingAttendanceUpdated(result.player.clubId, utcDateToIsoDate(result.training.trainingDate));
      const pushPayload = buildNotificationPayload({ type: "trainer_message", memberName: result.player.fullName.trim(), trainerMessage: `Отчетено е присъствие за тренировка на ${result.training.trainingDate.toLocaleDateString("bg-BG", { timeZone: "UTC" })}${result.training.trainingTime ? ` в ${result.training.trainingTime}` : ""}. Остават ${result.player.remainingTrainingCredits} тренировки.`, url: `/member/${normalizedCardCode}` });
      try {
        await saveMemberNotificationHistory(result.player.id, "trainer_message", pushPayload);
        await sendPushToMember(result.player.id, pushPayload);
      } catch (error) { console.error("Training check-in notification error:", error); }
    }
    return NextResponse.json({ success: true, remainingTrainingCredits: result.player.remainingTrainingCredits, status: result.player.status, charged: result.charged });
  } catch (error) { return errorResponse(error); }
}
