import type { prisma } from "@/lib/db";
import type { CoachTraining } from "@/lib/coachTrainingSchedule";

export type CoachTrainingLimit = { sessionId?: string; recurrenceId?: string; maxSpots: number | null };
export function parseCoachTrainingLimits(raw: unknown): CoachTrainingLimit[] {
  if (!Array.isArray(raw)) throw new Error("Invalid training place limits");
  return raw.map((value) => {
    if (!value || typeof value !== "object" || (!value.sessionId && !value.recurrenceId) || (value.sessionId && value.recurrenceId)) throw new Error("Select a session or recurring time for the place limit");
    if (value.maxSpots !== null && (!Number.isInteger(value.maxSpots) || value.maxSpots < 1 || value.maxSpots > 200)) throw new Error("Местата трябва да са между 1 и 200.");
    return { sessionId: value.sessionId, recurrenceId: value.recurrenceId, maxSpots: value.maxSpots };
  });
}

export async function applyCoachTrainingLimits(tx: Pick<typeof prisma, "limitedTrainingEvent" | "limitedTrainingRegistration" | "trainingSessionPlayer">, clubId: string, groupId: string, trainings: CoachTraining[], limits: CoachTrainingLimit[]) {
  for (const item of trainings) {
    if (item.status !== "scheduled") continue;
    const limit = limits.find((l) => l.sessionId === item.id) ?? limits.find((l) => l.recurrenceId && l.recurrenceId === item.recurrenceId);
    if (!limit) continue;
    const scopeKey = `coach_group:${groupId}:session:${item.id}`;
    const existing = await tx.limitedTrainingEvent.findFirst({ where: { clubId, scopeKey }, select: { id: true, maxSpots: true } });
    if (limit.maxSpots === null) {
      if (existing) {
        await tx.trainingSessionPlayer.updateMany({ where: { trainingSessionId: item.id, reasonCode: "limited_event" }, data: { present: true, reasonCode: null, reasonText: null } });
        await tx.limitedTrainingEvent.delete({ where: { id: existing.id } });
      }
      continue;
    }
    if (!existing) {
      await tx.limitedTrainingEvent.create({ data: { clubId, scopeKey, scopeId: groupId, trainingDate: new Date(`${item.date}T00:00:00Z`), maxSpots: limit.maxSpots } });
      await tx.trainingSessionPlayer.updateMany({ where: { trainingSessionId: item.id }, data: { present: false, reasonCode: "limited_event", reasonText: null } });
    } else if (existing.maxSpots !== limit.maxSpots) {
      await tx.limitedTrainingEvent.update({ where: { id: existing.id }, data: { maxSpots: limit.maxSpots } });
      const registrations = await tx.limitedTrainingRegistration.findMany({ where: { eventId: existing.id }, select: { playerId: true }, orderBy: { registeredAt: "asc" } });
      for (let i = Math.min(existing.maxSpots, limit.maxSpots); i < Math.min(Math.max(existing.maxSpots, limit.maxSpots), registrations.length); i++) {
        const present = i < limit.maxSpots;
        await tx.trainingSessionPlayer.updateMany({ where: { trainingSessionId: item.id, playerId: registrations[i].playerId }, data: { present, reasonCode: present ? null : "limited_event", reasonText: null } });
      }
    }
  }
}
