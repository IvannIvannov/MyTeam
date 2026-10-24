import { localToday, summarizeSubscription, type SubscriptionSnapshot } from "./clubSubscriptionDomain";

export type SubscriptionReminder = { key: string; title: string; body: string };

/** Catch up within each trial window; a bill is overdue after its calendar month ends. */
export function subscriptionReminders(subscription: SubscriptionSnapshot, today = localToday()): SubscriptionReminder[] {
  if (subscription.mode === "trial") {
    const end = subscription.trialEndDate;
    if (!end) return [];
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (days > 7) return [];
    const stage = days < 0 ? "expired" : days <= 1 ? "1" : "7";
    return [{ key: `trial:${end}:${stage}`, title: days < 0 ? "Пробният период за MyTeam изтече" : "Пробният период за MyTeam изтича",
      body: days < 0 ? `Безплатният пробен период приключи на ${end.split("-").reverse().join(".")}. Свържете се с администратора за платен абонамент. Не се начисляват такси автоматично.`
        : `Безплатният пробен период е до ${end.split("-").reverse().join(".")} включително. Остават ${days} дни. Свържете се с администратора за продължаване на абонамента.` }];
  }
  const summary = summarizeSubscription("active", subscription, today);
  return summary.outstanding.filter((item) => item.month < today.slice(0, 7)).map((item) => ({
    key: `overdue:${item.month}`, title: "Просрочена такса за MyTeam",
    body: `Абонаментната такса за ${item.month} е просрочена. Дължима сума за месеца: ${item.amount} EUR. Ако вече сте платили, свържете се с администратора за отразяване на плащането.`,
  }));
}
