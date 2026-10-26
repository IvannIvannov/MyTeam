import { prisma } from "@/lib/db";
import { summarizeSubscription, type ClubSubscriptionSummaryView } from "./clubSubscriptionDomain";

/** Club-facing projection: do not expose notes, administrator IDs, or audit details. */
export async function getClubSubscriptionSummary(clubId: string): Promise<ClubSubscriptionSummaryView | null> {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: {
    billingStatus: true, platformSubscription: { select: {
      mode: true, trialEndDate: true, firstBillingMonth: true,
      fees: { select: { effectiveMonth: true, amount: true } },
      payments: { where: { voidedAt: null }, select: { months: { select: { month: true, amount: true } } } },
    } },
  } });
  const stored = club?.platformSubscription;
  if (club?.billingStatus !== "active" || !stored) return null;
  const snapshot = { ...stored, fees: stored.fees.map((f) => ({ ...f, amount: f.amount.toFixed(2) })),
    payments: stored.payments.map((p) => ({ ...p, id: "", paidOn: "", note: null, createdAt: "", createdBy: "", total: "0", voidedAt: null, voidedBy: null,
      months: p.months.map((m) => ({ ...m, amount: m.amount.toFixed(2) })) })) };
  return { mode: stored.mode, trialEndDate: stored.trialEndDate, firstBillingMonth: stored.firstBillingMonth,
    summary: summarizeSubscription(club.billingStatus, snapshot),
    paidMonths: stored.mode === "contract" ? [] : snapshot.payments.flatMap((p) => p.months).sort((a, b) => a.month.localeCompare(b.month)) };
}
