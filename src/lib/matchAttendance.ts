import { prisma } from "@/lib/db";
import { getTodayIsoDateInTimeZone } from "@/lib/training";
import { matchPlayerWhere, type MatchAttendance } from "@/lib/matchAttendanceRules";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { publishTrainingAttendanceUpdated } from "@/lib/trainingAttendanceEvents";
import { sendPushToClubAdmins } from "@/lib/push/adminService";
import { saveAdminNotificationHistory } from "@/lib/push/adminHistory";
import { sendPushToMember } from "@/lib/push/service";
import { MATCH_ABSENCE_REASONS } from "@/lib/matchAttendanceRules";

export async function getMatchAttendance(clubId: string, matchId: string) {
  const match = await prisma.clubMatch.findFirst({ where: { id: matchId, clubId } });
  if (!match) return null;
  if (!match.attendanceEnabled) return { enabled: false, players: [] };
  const players = await prisma.player.findMany({
    where: matchPlayerWhere(match), orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, teamGroup: true, matchAttendance: { where: { matchId }, select: { present: true, reasonCode: true, reasonText: true } } },
  });
  return { enabled: true, players: players.map(({ matchAttendance, ...player }) => ({ ...player, present: matchAttendance[0]?.present ?? true, reasonCode: matchAttendance[0]?.reasonCode ?? null, reasonText: matchAttendance[0]?.reasonText ?? null })) };
}

export async function changeMatchAttendance(input: { clubId: string; matchId: string; playerId: string; attendance: MatchAttendance; byCoach: boolean }) {
  const result = await prisma.$transaction(async (tx) => {
    // Serialize against game rescheduling/deletion while checking eligibility.
    await tx.$queryRaw`SELECT id FROM club_matches WHERE id = ${input.matchId}::uuid FOR UPDATE`;
    const match = await tx.clubMatch.findFirst({ where: { id: input.matchId, clubId: input.clubId, attendanceEnabled: true, ...(!input.byCoach ? { matchDate: { gte: getTodayIsoDateInTimeZone("Europe/Sofia") } } : {}) }, include: { customGroup: { select: { coachGroupId: true } } } });
    if (!match) return null;
    const player = await tx.player.findFirst({ where: { ...matchPlayerWhere(match), id: input.playerId }, select: { id: true, fullName: true, cards: { where: { isActive: true }, select: { cardCode: true } } } });
    if (!player) return null;
    const previous = await tx.clubMatchPlayer.findUnique({ where: { matchId_playerId: { matchId: match.id, playerId: player.id } } });
    const changed = (previous?.present ?? true) !== input.attendance.present || (previous?.reasonCode ?? null) !== input.attendance.reasonCode || (previous?.reasonText ?? null) !== input.attendance.reasonText;
    await tx.clubMatchPlayer.upsert({ where: { matchId_playerId: { matchId: match.id, playerId: player.id } }, create: { matchId: match.id, playerId: player.id, ...input.attendance }, update: input.attendance });
    return { match, player, changed };
  });
  if (!result) return false;
  const { match, player, changed } = result;
  for (const { cardCode } of player.cards) publishMemberUpdated(cardCode, "training-updated");
  publishTrainingAttendanceUpdated(input.clubId, match.matchDate);
  if (!changed) return true;
  const date = new Date(match.matchDate + "T12:00:00Z").toLocaleDateString("bg-BG", { timeZone: "Europe/Sofia" });
  const label = input.attendance.reasonCode ? MATCH_ABSENCE_REASONS[input.attendance.reasonCode as keyof typeof MATCH_ABSENCE_REASONS] : "";
  const reason = input.attendance.present ? "" : " Причина: " + (input.attendance.reasonText || label) + ".";
  const payload = {
    title: "Промяна в присъствието за мач",
    body: player.fullName + (input.attendance.present ? " потвърди присъствие" : " отбеляза отсъствие") + " за мач на " + date + " · " + match.matchTime + (match.opponent ? " срещу " + match.opponent : "") + "." + reason,
    url: "/admin/members?clubId=" + encodeURIComponent(input.clubId),
    icon: "/myteam-logo.webp", badge: "/myteam-logo.webp", tag: "match-attendance-" + match.id + "-" + player.id,
    data: { type: "training_reminder" as const, matchId: match.id },
  };
  const coachGroupId = match.customGroup?.coachGroupId ?? null;
  const tasks: Promise<unknown>[] = [saveAdminNotificationHistory({ clubId: input.clubId, playerId: player.id, coachGroupId, type: "match_attendance", payload }), sendPushToClubAdmins(input.clubId, payload, coachGroupId)];
  if (input.byCoach) tasks.push(sendPushToMember(player.id, { ...payload, body: "Треньорът промени присъствието Ви за мач на " + date + ": " + (input.attendance.present ? "Присъства" : "Отсъства") + ".", url: player.cards[0] ? "/member/" + encodeURIComponent(player.cards[0].cardCode) : "/" }, "training_reminder"));
  const notifications = await Promise.allSettled(tasks);
  for (const result of notifications) if (result.status === "rejected") console.error("Match attendance notification failed:", result.reason);
  return true;
}
