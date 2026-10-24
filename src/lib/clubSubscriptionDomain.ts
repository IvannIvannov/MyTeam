// Calendar dates and months are local Europe/Sofia values, never UTC timestamps.
export const SUBSCRIPTION_TIME_ZONE = "Europe/Sofia";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SubscriptionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function localToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SUBSCRIPTION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDate(value: unknown): value is string {
  return typeof value === "string" && /^(20|21)\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

export function monthsBetween(first: string, last: string): string[] {
  const result: string[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) result.push(month);
  return result;
}

export function amountCents(value: unknown, maxWholeDigits = 8): number {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : "";
  if (!/^\d+(\.\d{1,2})?$/.test(normalized) || normalized.split(".")[0].length > maxWholeDigits) throw new SubscriptionError("Невалидна сума в EUR.");
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function money(cents: number): string { return (cents / 100).toFixed(2); }

export type SubscriptionSetup = { mode: "contract" } | { mode: "trial"; trialEndDate: string | null } |
  { mode: "paid"; firstBillingMonth: string; amount: string };

export function parseSubscriptionSetup(raw: unknown): SubscriptionSetup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SubscriptionError("Изберете пробен период или платен абонамент.");
  const input = raw as Record<string, unknown>;
  if (input.mode === "contract") return { mode: "contract" };
  if (input.mode === "trial") {
    if (input.trialEndDate !== null && !isDate(input.trialEndDate)) throw new SubscriptionError("Изберете крайна дата или без крайна дата.");
    return { mode: "trial", trialEndDate: input.trialEndDate };
  }
  if (input.mode !== "paid" || !isMonth(input.firstBillingMonth)) throw new SubscriptionError("Невалиден начален месец.");
  const cents = amountCents(input.amount);
  if (cents <= 0) throw new SubscriptionError("Месечната такса трябва да е по-голяма от нула.");
  return { mode: "paid", firstBillingMonth: input.firstBillingMonth, amount: money(cents) };
}

export type Fee = { effectiveMonth: string; amount: string };
export type PaymentView = {
  id: string; paidOn: string; note: string | null; total: string; createdAt: string;
  createdBy: string; voidedAt: string | null; voidedBy: string | null;
  months: { month: string; amount: string }[];
};
export type SubscriptionSnapshot = {
  mode: string; trialEndDate: string | null; firstBillingMonth: string | null;
  fees: Fee[]; payments: PaymentView[];
};
export type SubscriptionStatus = "contract" | "not_activated" | "trial" | "trial_expired" | "active" | "unpaid" | "scheduled";
export type SubscriptionSummary = {
  status: SubscriptionStatus; currentFee: string | null; paidThrough: string | null;
  outstanding: { month: string; amount: string }[]; outstandingTotal: string;
  laterPaidMonths: string[];
};
export type SubscriptionAuditEntry = { id: string; actorId: string; action: string; details: unknown; createdAt: string };
export type ClubSubscriptionSummaryView = {
  mode: string; trialEndDate: string | null; firstBillingMonth: string | null;
  summary: SubscriptionSummary; paidMonths: { month: string; amount: string }[];
};
export type ClubSubscriptionView = {
  id: string; name: string; billingStatus: string;
  subscription: (SubscriptionSnapshot & { version: number; changes?: SubscriptionAuditEntry[] }) | null;
  summary: SubscriptionSummary;
};

// A fee revision must never start inside an already paid period, even across gaps.
export function earliestFeeChangeMonth(firstBillingMonth: string, payments: {
  voidedAt: unknown; months: { month: string }[];
}[]): string {
  let earliest = firstBillingMonth;
  for (const payment of payments) {
    if (payment.voidedAt) continue;
    for (const { month } of payment.months) {
      const afterPaid = nextMonth(month);
      if (afterPaid > earliest) earliest = afterPaid;
    }
  }
  return earliest;
}

export function feeForMonth(fees: Fee[], month: string): string | null {
  let fee: Fee | undefined;
  for (const candidate of fees) {
    if (candidate.effectiveMonth <= month && (!fee || candidate.effectiveMonth > fee.effectiveMonth)) fee = candidate;
  }
  return fee?.amount ?? null;
}

export function summarizeSubscription(billingStatus: string, subscription: SubscriptionSnapshot | null, today = localToday()): SubscriptionSummary {
  const base: SubscriptionSummary = { status: "not_activated", currentFee: null, paidThrough: null, outstanding: [], outstandingTotal: "0.00", laterPaidMonths: [] };
  if (billingStatus !== "active" || !subscription) return base;
  if (subscription.mode === "contract") return { ...base, status: "contract" };
  if (subscription.mode === "trial") return { ...base, status: subscription.trialEndDate && subscription.trialEndDate < today ? "trial_expired" : "trial" };
  const first = subscription.firstBillingMonth!;
  const current = today.slice(0, 7);
  const paid = new Set(subscription.payments.filter((p) => !p.voidedAt).flatMap((p) => p.months.map((m) => m.month)));
  const outstanding = monthsBetween(first, current).filter((m) => !paid.has(m)).map((month) => ({ month, amount: feeForMonth(subscription.fees, month)! }));
  let cursor = first;
  let paidThrough: string | null = null;
  while (paid.has(cursor)) { paidThrough = cursor; cursor = nextMonth(cursor); }
  return { status: outstanding.length ? "unpaid" : first > current ? "scheduled" : "active",
    currentFee: feeForMonth(subscription.fees, current < first ? first : current), paidThrough, outstanding,
    outstandingTotal: money(outstanding.reduce((total, m) => total + amountCents(m.amount), 0)),
    laterPaidMonths: [...paid].filter((m) => m > cursor).sort() };
}
