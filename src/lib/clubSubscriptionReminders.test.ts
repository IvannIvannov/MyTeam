import { describe, expect, it } from "vitest";
import { subscriptionReminders } from "./clubSubscriptionReminders";
import type { SubscriptionSnapshot } from "./clubSubscriptionDomain";
const trial = (end: string | null): SubscriptionSnapshot => ({ mode: "trial", trialEndDate: end, firstBillingMonth: null, fees: [], payments: [] });
describe("subscription reminder policy", () => {
  it("skips unlimited trials and trials outside the reminder window", () => {
    expect(subscriptionReminders(trial(null), "2026-10-24")).toEqual([]);
    expect(subscriptionReminders(trial("2026-11-01"), "2026-10-24")).toEqual([]);
  });
  it("uses stable keys for 7-day, 1-day and expired windows, with inclusive end dates", () => {
    expect(subscriptionReminders(trial("2026-10-31"), "2026-10-24")[0].key).toBe("trial:2026-10-31:7");
    expect(subscriptionReminders(trial("2026-10-31"), "2026-10-29")[0].key).toBe("trial:2026-10-31:7");
    expect(subscriptionReminders(trial("2026-10-31"), "2026-10-30")[0].key).toBe("trial:2026-10-31:1");
    expect(subscriptionReminders(trial("2026-10-31"), "2026-10-31")[0].key).toBe("trial:2026-10-31:1");
    expect(subscriptionReminders(trial("2026-10-31"), "2026-11-01")[0].key).toBe("trial:2026-10-31:expired");
  });
  it("starts a new reminder cycle after a trial is extended", () => {
    expect(subscriptionReminders(trial("2026-11-07"), "2026-11-01")[0].key).toBe("trial:2026-11-07:7");
  });
  it("marks only past unpaid calendar months overdue, preserves gaps and excludes active payments", () => {
    const subscription: SubscriptionSnapshot = { ...trial(null), mode: "paid", firstBillingMonth: "2026-12", fees: [{ effectiveMonth: "2026-12", amount: "10.00" }], payments: [{
      id: "p", paidOn: "2026-12-01", createdAt: "2026-12-01", createdBy: "admin", total: "10", note: null, voidedAt: null, voidedBy: null, months: [{ month: "2027-01", amount: "10.00" }],
    }] };
    expect(subscriptionReminders(subscription, "2026-12-31")).toEqual([]);
    expect(subscriptionReminders(subscription, "2027-02-01").map((r) => r.key)).toEqual(["overdue:2026-12"]);
    subscription.payments[0].voidedAt = "2027-02-01";
    expect(subscriptionReminders(subscription, "2027-02-01").map((r) => r.key)).toEqual(["overdue:2026-12", "overdue:2027-01"]);
  });
});

it("never reminds contract clubs even with historical trial dates and unpaid fees", () => {
  expect(subscriptionReminders({ ...trial("2026-10-24"), mode: "contract", firstBillingMonth: "2026-01", fees: [{ effectiveMonth: "2026-01", amount: "10.00" }] }, "2026-10-24")).toEqual([]);
});
