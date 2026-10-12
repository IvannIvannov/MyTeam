import { prisma } from "@/lib/db";
import { saveMemberNotificationHistory } from "@/lib/push/history";
import { sendPushToMember } from "@/lib/push/service";
import type { CoachTraining } from "@/lib/coachTrainingSchedule";

export async function notifyCoachTrainingChanges(clubId: string, groupId: string, previous: CoachTraining[], next: CoachTraining[]) {
  const before = new Map(previous.map((t) => [t.id, t]));
  const after = new Map(next.map((t) => [t.id, t]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((id) => {
    const a = before.get(id), b = after.get(id);
    return !a || !b || a.date !== b.date || a.trainingTime !== b.trainingTime || a.trainingDurationMinutes !== b.trainingDurationMinutes || a.trainingFieldId !== b.trainingFieldId || [...a.trainingFieldPieceIds].sort().join() !== [...b.trainingFieldPieceIds].sort().join() || a.status !== b.status;
  });
  if (!changed.length) return;
  const [members, fields] = await Promise.all([
    prisma.player.findMany({ where: { clubId, isActive: true, coachGroups: { some: { id: groupId } } }, select: { id: true, cards: { where: { isActive: true }, take: 1, select: { cardCode: true } } } }),
    prisma.field.findMany({ where: { clubId }, select: { id: true, name: true, pieces: { select: { id: true, name: true } } } }),
  ]);
  for (const id of changed) {
    const item = after.get(id) ?? before.get(id)!;
    const cancelled = !after.has(id) || item.status === "cancelled";
    if (cancelled && before.get(id)?.status === "cancelled") continue;
    const field = fields.find((f) => f.id === item.trainingFieldId);
    const pieces = field?.pieces.filter((p) => item.trainingFieldPieceIds.includes(p.id)).map((p) => p.name).join(", ");
    const title = cancelled ? "Отменена тренировка" : before.has(id) ? "Променена тренировка" : "Нова тренировка";
    for (let i = 0; i < members.length; i += 4) {
      await Promise.allSettled(members.slice(i, i + 4).map(async (member) => {
        const payload = { title, body: `${item.date} · ${item.trainingTime} · ${item.trainingDurationMinutes} мин.${field ? ` · ${field.name}${pieces ? ` (${pieces})` : ""}` : ""}`, tag: `training-session-${id}`, data: { type: cancelled ? "training_cancelled" : "training_reminder", trainingDate: item.date, trainingSessionId: id }, url: member.cards[0] ? `/member/${member.cards[0].cardCode}` : "/" };
        await saveMemberNotificationHistory(member.id, "training_reminder", payload);
        await sendPushToMember(member.id, payload);
      }));
    }
  }
}
