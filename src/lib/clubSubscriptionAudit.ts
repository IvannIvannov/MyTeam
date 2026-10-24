import type { SubscriptionAuditEntry } from "./clubSubscriptionDomain";
export const subscriptionAuditLabels: Record<string, string> = {
  setup: "Настроен абонамент", initial_trial: "Начален пробен период", trial: "Променен пробен период",
  start_paid: "Активиран платен абонамент", fee: "Променена месечна такса", payment: "Записано плащане", void: "Анулирано плащане",
};
export function subscriptionAuditDescription(entry: SubscriptionAuditEntry): string {
  const d = entry.details && typeof entry.details === "object" && !Array.isArray(entry.details) ? entry.details as Record<string, unknown> : {};
  const text = (key: string) => typeof d[key] === "string" ? d[key] as string : "—";
  const trial = (value: unknown) => typeof value === "string" ? `до ${value.split("-").reverse().join(".")}` : "без крайна дата";
  const months = Array.isArray(d.months) ? d.months.filter((m): m is string => typeof m === "string").join(", ") : "—";
  switch (entry.action) {
    case "trial": return `${trial(d.before)} → ${trial(d.after)}`;
    case "fee": return `${text("oldAmount")} → ${text("newAmount")} EUR / месец · В сила от ${text("effectiveMonth")}`;
    case "start_paid": return `${text("amount")} EUR / месец · Първи месец: ${text("firstBillingMonth")}`;
    case "setup": return d.mode === "paid" ? `${text("amount")} EUR / месец · От ${text("firstBillingMonth")}` : `Пробен период ${trial(d.trialEndDate)}`;
    case "initial_trial": return "Безплатен пробен период без крайна дата (миграция)";
    case "payment": return `${text("total")} EUR · Месеци: ${months} · Дата на плащане: ${text("paidOn")}`;
    case "void": return `${text("total")} EUR · Отново неплатени месеци: ${months}`;
    default: return "Записана промяна на абонамента";
  }
}
