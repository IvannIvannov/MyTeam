import { describe, expect, it } from "vitest";
import { amountCents, feeForMonth, isDate, isMonth, localToday, money, nextMonth, parseSubscriptionSetup, summarizeSubscription, type PaymentView, type SubscriptionSnapshot } from "./clubSubscriptionDomain";

const payment = (months: string[], voidedAt: string | null = null): PaymentView => ({ id: "p", paidOn: "2026-10-24", note: null, total: money(months.length * 1000), createdAt: "2026-10-24T10:00:00Z", createdBy: "admin", voidedAt, voidedBy: null, months: months.map((month) => ({ month, amount: "10.00" })) });
const paid = (payments: PaymentView[] = []): SubscriptionSnapshot => ({ mode: "paid", trialEndDate: null, firstBillingMonth: "2026-09", fees: [{ effectiveMonth: "2026-09", amount: "10.00" }, { effectiveMonth: "2026-11", amount: "15.00" }], payments });

describe("club subscription calendar accounting", () => {
  it("keeps a skipped month outstanding even if later months were paid", () => {
    const summary = summarizeSubscription("active", paid([payment(["2026-09", "2026-11", "2026-12"])]), "2026-11-12");
    expect(summary).toMatchObject({ status: "unpaid", paidThrough: "2026-09", outstanding: [{ month: "2026-10", amount: "10.00" }], outstandingTotal: "10.00", laterPaidMonths: ["2026-11", "2026-12"] });
  });
  it("extends coverage across December and into the next year", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    const subscription = { ...paid([payment(["2026-12", "2027-01", "2027-02"])]), firstBillingMonth: "2026-12" };
    expect(summarizeSubscription("active", subscription, "2027-01-31")).toMatchObject({ status: "active", paidThrough: "2027-02", outstandingTotal: "0.00" });
  });
  it("uses effective revisions for unpaid months without repricing paid snapshots", () => {
    const subscription = paid([payment(["2026-09", "2026-11"])]);
    subscription.fees = [{ effectiveMonth: "2026-09", amount: "12.50" }, { effectiveMonth: "2026-11", amount: "20.00" }];
    expect(summarizeSubscription("active", subscription, "2026-12-01").outstanding).toEqual([{ month: "2026-10", amount: "12.50" }, { month: "2026-12", amount: "20.00" }]);
    expect(subscription.payments[0].months[1].amount).toBe("10.00");
  });
  it("reopens only voided payment months", () => {
    expect(summarizeSubscription("active", paid([payment(["2026-09"], "2026-10-24"), payment(["2026-10"])]), "2026-10-24").outstanding).toEqual([{ month: "2026-09", amount: "10.00" }]);
  });
  it("does not charge or expire a paid subscription before its first billable month", () => {
    expect(summarizeSubscription("active", { ...paid(), firstBillingMonth: "2027-01", fees: [{ effectiveMonth: "2027-01", amount: "10.00" }] }, "2026-10-24")).toMatchObject({ status: "scheduled", outstanding: [], currentFee: "10.00" });
  });
  it("keeps trials active through the selected final local day, without creating debt", () => {
    const trial = { mode: "trial", trialEndDate: "2026-10-24", firstBillingMonth: null, fees: [], payments: [] };
    expect(summarizeSubscription("active", trial, "2026-10-24")).toMatchObject({ status: "trial", outstanding: [] });
    expect(summarizeSubscription("active", trial, "2026-10-25")).toMatchObject({ status: "trial_expired", outstanding: [] });
    expect(summarizeSubscription("active", { ...trial, trialEndDate: null }, "2099-12-31").status).toBe("trial");
    expect(summarizeSubscription("demo", trial).status).toBe("not_activated");
  });
  it("uses Sofia calendar dates including around DST changes", () => {
    expect(localToday(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25");
    expect(localToday(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-26");
  });
  it("finds a fee regardless of ordering and stops it at the next revision", () => {
    const fees = [{ effectiveMonth: "2027-01", amount: "30.00" }, { effectiveMonth: "2026-10", amount: "20.00" }];
    expect(feeForMonth(fees, "2026-12")).toBe("20.00");
    expect(feeForMonth(fees, "2027-02")).toBe("30.00");
    expect(feeForMonth(fees, "2026-09")).toBeNull();
  });
});

describe("subscription setup validation", () => {
  it("requires an explicit end-date choice and accepts a valid leap day", () => {
    expect(() => parseSubscriptionSetup({ mode: "trial" })).toThrow();
    expect(parseSubscriptionSetup({ mode: "trial", trialEndDate: null })).toEqual({ mode: "trial", trialEndDate: null });
    expect(isDate("2028-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "x"]) expect(isDate(date)).toBe(false);
    for (const month of ["2026-13", "2026-1", "2026-00", "2026-10-01"]) expect(isMonth(month)).toBe(false);
  });
  it("requires a positive fixed fee and valid first billing month", () => {
    for (const amount of ["0", "-1", "10.001", "1e3", "NaN", "100000000"]) expect(() => parseSubscriptionSetup({ mode: "paid", firstBillingMonth: "2026-10", amount })).toThrow();
    expect(parseSubscriptionSetup({ mode: "paid", firstBillingMonth: "2026-10", amount: "12,50" })).toEqual({ mode: "paid", firstBillingMonth: "2026-10", amount: "12.50" });
    expect(amountCents("0.29") + amountCents("0.01")).toBe(30);
  });
});

it("contract subscriptions never accrue in-app fees even with historical billing records", () => {
  expect(parseSubscriptionSetup({ mode: "contract" })).toEqual({ mode: "contract" });
  expect(summarizeSubscription("active", { ...paid(), mode: "contract" }, "2027-06-01")).toMatchObject({ status: "contract", currentFee: null, outstanding: [], outstandingTotal: "0.00", paidThrough: null });
});
