import { expect, it } from "vitest";
import { buildYearlyPaymentReport, formatRecordedPaymentAmounts } from "./yearlyPaymentReport";

const now = new Date("2026-10-13T10:00:00Z");
const player = {
  firstBillingMonth: "2026-01-01T00:00:00Z",
  paymentWorkflow: "calendar_month",
  paymentLogs: [{ paidFor: "2026-01-01T00:00:00Z", paidAt: "2026-01-05T10:00:00Z" }],
  paymentWaivers: [],
};

it("shows actual historical amounts independent of the player's current fee", () => {
  const report = buildYearlyPaymentReport({ ...player, paymentLogs: [
    { paidFor: "2026-01-01T00:00:00Z", paidAt: "2026-01-05T10:00:00Z", amount: "25.50", currency: "EUR" },
    { paidFor: "2026-02-01T00:00:00Z", paidAt: "2026-02-05T10:00:00Z", amount: "30.00", currency: "EUR" },
    { paidFor: "2026-03-01T00:00:00Z", paidAt: "2026-03-05T10:00:00Z" },
  ] }, 2026, now);
  expect(report.months[0].amountLabel).toBe("25.50 EUR");
  expect(report.months[1].amountLabel).toBe("30.00 EUR");
  expect(report.months[2].amountLabel).toBe("Неизвестна сума (1)");
  expect(report.totalAmountLabel).toBe("55.50 EUR + Неизвестна сума (1)");
});

it("sums cents exactly, preserves zero payments, and keeps currencies separate", () => {
  expect(formatRecordedPaymentAmounts([{ amount: "0.10" }, { amount: "0.20" }, { amount: "0", currency: "USD" }])).toBe("0.30 EUR + 0.00 USD");
});

it("does not treat a single paid month as a fully paid year", () => {
  const report = buildYearlyPaymentReport(player, 2026, now);
  expect(report).toMatchObject({ dueCount: 10, paidDueCount: 1, missingCount: 9, status: "unpaid" });
  expect(report.months[10].status).toBe("not_due");
});

it("excludes months before billing starts and waived months", () => {
  const report = buildYearlyPaymentReport({ ...player,
    firstBillingMonth: "2026-09-01T00:00:00Z",
    paymentWaivers: [{ waivedFor: "2026-10-01T00:00:00Z" }],
  }, 2026, now);
  expect(report).toMatchObject({ dueCount: 1, paidDueCount: 0, missingCount: 1 });
  expect(report.months[1].status).toBe("not_due");
  expect(report.months[9].status).toBe("exempt");
});

it("shows advance payments without adding future months to the collection rate", () => {
  const report = buildYearlyPaymentReport({ ...player, paymentLogs: [
    ...player.paymentLogs,
    { paidFor: "2026-12-01T00:00:00Z", paidAt: "2026-10-01T10:00:00Z" },
    { paidFor: "2026-01-01T00:00:00Z", paidAt: "2026-02-01T10:00:00Z" },
  ] }, 2026, now);
  expect(report).toMatchObject({ dueCount: 10, paidDueCount: 1, paidMonthCount: 2 });
  expect(report.months[0].paidAt?.toISOString()).toBe("2026-02-01T10:00:00.000Z");
  expect(report.months[11]).toMatchObject({ status: "paid", due: false });
});

it("handles fully exempt players, disabled billing and future years without unpaid fees", () => {
  const paymentWaivers = Array.from({ length: 12 }, (_, month) => ({ waivedFor: new Date(Date.UTC(2026, month, 1)).toISOString() }));
  for (const input of [{ ...player, paymentWaivers }, { ...player, firstBillingMonth: null }]) {
    expect(buildYearlyPaymentReport(input, 2026, now)).toMatchObject({ dueCount: 0, missingCount: 0, status: "not_due" });
  }
  expect(buildYearlyPaymentReport(player, 2027, now).dueCount).toBe(0);
  expect(buildYearlyPaymentReport(player, 2026, new Date("2027-02-01T00:00:00Z")).dueCount).toBe(12);
});

it("uses the fee period year, ignores invalid logs, and does not invent monthly debts for other workflows", () => {
  const report = buildYearlyPaymentReport({ ...player, paymentWorkflow: "rolling_30_days", paymentLogs: [
    { paidFor: "2026-12-01T00:00:00Z", paidAt: "2027-01-02T10:00:00Z" },
    { paidFor: "invalid", paidAt: "2026-01-02T10:00:00Z" },
    { paidFor: "2026-01-01T00:00:00Z", paidAt: "invalid" },
  ] }, 2026, new Date("2027-02-01T00:00:00Z"));
  expect(report).toMatchObject({ status: "activity", dueCount: 0, missingCount: 0, paidMonthCount: 1 });
  expect(report.months[11].status).toBe("paid");
});
