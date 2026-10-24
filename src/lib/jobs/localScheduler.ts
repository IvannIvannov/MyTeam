let schedulerStarted = false;
let schedulerRunning = false;

export async function startLocalSchedulers() {
  if (schedulerStarted) {
    return;
  }
  schedulerStarted = true;

  const [{ runMonthlyMembershipPaymentReminder }, { runMonthlyOverduePaymentReminder }] =
    await Promise.all([
      import("@/lib/jobs/monthlyMembershipPaymentReminder"),
      import("@/lib/jobs/monthlyOverduePaymentReminder"),
    ]);

  const { runClubSubscriptionReminders } = await import("@/lib/jobs/clubSubscriptionReminders");

  const run = async (options?: {
    forceMembership?: boolean;
    skipMembership?: boolean;
    forceOverdue?: boolean;
    skipOverdue?: boolean;
  }) => {
    if (schedulerRunning) {
      console.log("Local monthly schedulers skipped: previous run still in progress.");
      return;
    }

    schedulerRunning = true;
    try {
      try {
        const subscriptionResult = await runClubSubscriptionReminders();
        console.log("Club subscription reminders:", subscriptionResult);
      } catch (error) {
        console.error("Local club subscription reminders failed:", error);
      }
      const membershipResult = options?.skipMembership
        ? {
            success: true,
            skipped: true,
            reason: "Membership reminder skipped by startup configuration.",
          }
        : await runMonthlyMembershipPaymentReminder(new Date(), {
            ignoreSchedule: Boolean(options?.forceMembership),
          });
      const overdueResult = options?.skipOverdue
        ? {
            success: true,
            skipped: true,
            reason: "Overdue reminder skipped by startup configuration.",
          }
        : await runMonthlyOverduePaymentReminder(new Date(), {
            ignoreSchedule: Boolean(options?.forceOverdue),
          });

      if (!membershipResult.skipped) {
        console.log("Monthly reminder job executed:", membershipResult);
      } else {
        console.log("Monthly reminder job skipped:", membershipResult.reason);
      }

      if (!overdueResult.skipped) {
        console.log("Monthly overdue reminder job executed:", overdueResult);
      } else {
        console.log("Monthly overdue reminder job skipped:", overdueResult.reason);
      }
    } catch (error) {
      console.error("Local monthly schedulers failed:", error);
    } finally {
      schedulerRunning = false;
    }
  };

  // Check club subscriptions and player overdue dues on startup; check all jobs hourly.
  void run({ skipMembership: true, forceOverdue: true });
  setInterval(() => {
    void run();
  }, 60 * 60 * 1000);
}
