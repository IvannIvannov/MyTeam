import { prisma } from "@/lib/db";
import { localToday } from "@/lib/clubSubscriptionDomain";
import { subscriptionReminders } from "@/lib/clubSubscriptionReminders";
import { deliverSubscriptionNotification, saveSubscriptionNotification } from "@/lib/clubSubscriptions";

/** Row locking serializes this job with payments, trial changes, and other workers. */
export async function runClubSubscriptionReminders(now = new Date()) {
  const today = localToday(now);
  const clubs = await prisma.club.findMany({ where: { billingStatus: "active", platformSubscription: { isNot: null } }, select: { id: true } });
  const result = { success: true, today, notifiedClubs: 0, reminders: 0, failedClubs: [] as string[], pushWarnings: 0 };
  for (const { id: clubId } of clubs) {
    try {
      const notice = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM clubs WHERE id = ${clubId}::uuid FOR UPDATE`;
        const club = await tx.club.findUnique({ where: { id: clubId }, select: { billingStatus: true } });
        if (club?.billingStatus !== "active") return null;
        const stored = await tx.clubSubscription.findUnique({ where: { clubId }, include: {
          fees: true, payments: { include: { months: true } }, reminders: true,
        } });
        if (!stored) return null;
        const candidates = subscriptionReminders({ ...stored,
          fees: stored.fees.map((f) => ({ ...f, amount: f.amount.toFixed(2) })),
          payments: stored.payments.map((p) => ({ ...p, total: p.total.toFixed(2), createdAt: p.createdAt.toISOString(), voidedAt: p.voidedAt?.toISOString() ?? null,
            months: p.months.map((m) => ({ ...m, amount: m.amount.toFixed(2) })) })),
        }, today);
        const sent = new Set(stored.reminders.map((r) => r.key));
        const pending = candidates.filter((r) => !sent.has(r.key));
        if (!pending.length) return null;
        const payload = { title: pending[0].title, body: pending.map((r) => r.body).join("\n\n"), url: `/admin/members?clubId=${clubId}` };
        await saveSubscriptionNotification(tx, clubId, payload);
        await tx.clubSubscriptionReminder.createMany({ data: pending.map((r) => ({ clubId, key: r.key })) });
        return { payload, count: pending.length };
      }, { timeout: 15000 });
      if (notice) {
        const delivery = await deliverSubscriptionNotification(clubId, notice.payload);
        result.notifiedClubs++; result.reminders += notice.count;
        if (delivery.warning) result.pushWarnings++;
      }
    } catch (error) {
      console.error("Subscription reminder failed for club:", clubId, error);
      result.success = false; result.failedClubs.push(clubId);
    }
  }
  return result;
}
