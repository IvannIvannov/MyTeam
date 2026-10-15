export type YearlyMonthStatus = "paid" | "unpaid" | "exempt" | "not_due";
type RecordedPayment = { amount?: string | null; currency?: string };

export function formatRecordedPaymentAmounts(payments: RecordedPayment[]): string {
  if (!payments.length) return "—";
  const totals = new Map<string, number>();
  let unknown = 0;
  for (const payment of payments) {
    const amount = payment.amount;
    const currency = payment.currency ?? "EUR";
    if (amount == null || !/^\d+(\.\d{1,2})?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) {
      unknown++;
      continue;
    }
    const [whole, fraction = ""] = amount.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    totals.set(currency, (totals.get(currency) ?? 0) + cents);
  }
  const labels = [...totals].map(([currency, cents]) => `${(cents / 100).toFixed(2)} ${currency}`);
  if (unknown) labels.push(`Неизвестна сума (${unknown})`);
  return labels.join(" + ");
}

type ReportInput = {
  firstBillingMonth: string | null;
  paymentWorkflow: string;
  paymentLogs: Array<{ paidFor: string; paidAt: string } & RecordedPayment>;
  paymentWaivers: Array<{ waivedFor: string }>;
};

function monthIndex(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function buildYearlyPaymentReport(player: ReportInput, year: number, now = new Date()) {
  const calendarBilling = player.paymentWorkflow === "calendar_month";
  const start = monthIndex(player.firstBillingMonth);
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const waivers = new Set(player.paymentWaivers.map((waiver) => monthIndex(waiver.waivedFor)));
  const payments = new Map<number, Date>();
  const amounts = new Map<number, RecordedPayment[]>();
  for (const log of player.paymentLogs) {
    const month = monthIndex(log.paidFor);
    const paidAt = new Date(log.paidAt);
    if (month === null || Number.isNaN(paidAt.getTime()) || paidAt > now) continue;
    amounts.set(month, [...(amounts.get(month) ?? []), log]);
    const previous = payments.get(month);
    if (!previous || paidAt > previous) payments.set(month, paidAt);
  }
  const months = Array.from({ length: 12 }, (_, month) => {
    const index = year * 12 + month;
    const paidAt = payments.get(index) ?? null;
    const due = calendarBilling && start !== null && index >= start && index <= current && !waivers.has(index);
    const status: YearlyMonthStatus = paidAt ? "paid"
      : calendarBilling && waivers.has(index) ? "exempt"
      : due ? "unpaid" : "not_due";
    return { status, paidAt, due, amountLabel: formatRecordedPaymentAmounts(amounts.get(index) ?? []) };
  });
  const dueCount = months.filter((month) => month.due).length;
  const paidDueCount = months.filter((month) => month.due && month.status === "paid").length;
  const missingCount = dueCount - paidDueCount;
  const status: "activity" | "unpaid" | "paid" | "not_due" = !calendarBilling ? "activity"
    : missingCount > 0 ? "unpaid" : dueCount > 0 ? "paid" : "not_due";
  return {
    months, calendarBilling, dueCount, paidDueCount, missingCount,
    paidMonthCount: months.filter((month) => month.status === "paid").length,
    totalAmountLabel: formatRecordedPaymentAmounts(Array.from({ length: 12 }, (_, month) => amounts.get(year * 12 + month) ?? []).flat()),
    status,
  };
}
