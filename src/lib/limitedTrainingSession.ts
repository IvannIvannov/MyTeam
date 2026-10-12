import { prisma } from "@/lib/db";

export function getLimitedTrainingSessionId(scopeKey: string): string | null {
  return /^coach_group:[0-9a-f-]{36}:session:([0-9a-f-]{36})$/i.exec(scopeKey)?.[1] ?? null;
}

export async function resolveLimitedTrainingSessionId(clubId: string, scopeKey: string, trainingDate?: Date) {
  const id = getLimitedTrainingSessionId(scopeKey);
  if (id) return id;
  if (!/^coach_group:[0-9a-f-]{36}$/i.test(scopeKey) || !trainingDate) return null;
  const original = await prisma.trainingSession.findFirst({ where: { clubId, scopeKey, scopeType: "coachGroup", trainingDate }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return original?.id ?? null;
}

export async function setLimitedSessionAttendance(clubId: string, scopeKey: string, playerIds: string[], present: boolean, trainingDate?: Date) {
  const trainingSessionId = await resolveLimitedTrainingSessionId(clubId, scopeKey, trainingDate);
  if (!trainingSessionId) return false;
  const players = await prisma.player.findMany({ where: { clubId, id: { in: playerIds }, isActive: true }, select: { id: true, fullName: true, teamGroup: true } });
  await prisma.trainingSessionPlayer.createMany({ data: players.map((p) => ({ trainingSessionId, playerId: p.id, playerName: p.fullName, teamGroup: p.teamGroup })), skipDuplicates: true });
  await prisma.trainingSessionPlayer.updateMany({ where: { trainingSessionId, playerId: { in: playerIds }, trainingSession: { clubId } }, data: { present, reasonCode: present ? null : "limited_event", reasonText: null } });
  return true;
}
