import { isoDateToUtcMidnight } from "@/lib/training";
import { prisma } from "@/lib/db";
import { getRollingThirtyDayPaymentWindow } from "@/lib/paymentStatus";

export class TrainingCheckInError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function trainingCheckInRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const to = isoDateToUtcMidnight(today);
  const from = new Date(to.getTime() - 3 * 86400000);
  return { from, to };
}

// The caller holds the player's row lock for the entire transaction.
export async function chargeTrainingCheckIn(tx: Pick<typeof prisma, "player" | "trainingSessionPlayer" | "trainingOptOut">, playerId: string, trainingSessionId: string) {
  const player = await tx.player.findUniqueOrThrow({ where: { id: playerId }, include: { club: true, paymentLogs: { orderBy: { paidFor: "desc" }, take: 1 } } });
  const row = await tx.trainingSessionPlayer.findUnique({ where: { trainingSessionId_playerId: { trainingSessionId, playerId } }, include: { trainingSession: true } });
  const range = trainingCheckInRange();
  if (!row || row.trainingSession.clubId !== player.clubId || row.trainingSession.status !== "scheduled" || row.trainingSession.trainingDate < range.from || row.trainingSession.trainingDate > range.to) throw new TrainingCheckInError("Тренировката не е достъпна за чекиране.", 409);
  if (!["training_credits", "training_credits_30_days"].includes(player.club.paymentWorkflow)) throw new TrainingCheckInError("Чекирането изисква плащане с брой тренировки.");
  if (row.present) return { player, training: row.trainingSession, charged: false, changed: false };
  if (player.club.paymentWorkflow === "training_credits_30_days" && !(getRollingThirtyDayPaymentWindow({ paidDates: player.paymentLogs.map((log) => log.paidFor) })?.remainingDays)) throw new TrainingCheckInError("30-дневният срок е изтекъл.");
  if (player.remainingTrainingCredits <= 0) throw new TrainingCheckInError("Няма оставащи тренировки.");
  const charged = !row.creditChargedAt;
  const updated = charged ? await tx.player.update({ where: { id: playerId }, data: { remainingTrainingCredits: { decrement: 1 }, status: player.remainingTrainingCredits > 1 ? "paid" : "overdue" } }) : player;
  await tx.trainingSessionPlayer.update({ where: { id: row.id }, data: { present: true, attendanceRecorded: true, reasonCode: null, reasonText: null, ...(charged ? { creditChargedAt: new Date() } : {}) } });
  if (row.trainingSession.scopeType !== "coachGroup") await tx.trainingOptOut.deleteMany({ where: { playerId, trainingDate: row.trainingSession.trainingDate } });
  return { player: updated, training: row.trainingSession, charged, changed: true };
}
