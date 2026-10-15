import { test } from "node:test";
import assert from "node:assert/strict";
import { coveredMonths, buildReport } from "./report-iris-reconciliation.mjs";

const payment = {
  id: "one", playerId: "player", paymentHash: "hash-one", orderId: "order-one",
  status: "WAITING", amount: "255.00", currency: "EUR",
  paidFor: "2026-09-01T00:00:00Z", paidThrough: "2026-11-01T00:00:00Z",
};
const confirmed = { status: "CONFIRMED", confirmedAttempts: 1, creationModeKnown: true };

test("preserves advance periods across a year boundary", () => {
  assert.deepEqual(coveredMonths({ ...payment, paidFor: "2026-12-01", paidThrough: "2027-02-01" }),
    ["2026-12", "2027-01", "2027-02"]);
});

test("reports partially recorded periods without moving the unpaid month", () => {
  const logs = ["09", "10"].map((month) => ({ id: month, playerId: "player",
    paidFor: `2026-${month}-01`, recordedBy: "member", amount: null, currency: "EUR" }));
  const report = buildReport([payment], logs, new Map([["one", confirmed]]));
  assert.equal(report.payments[0].coverage, "PARTIALLY_RECORDED");
  assert.deepEqual(report.payments[0].months.map((month) => month.existingLogs.length), [1, 1, 0]);
  assert.equal(report.payments[0].months[2].month, "2026-11");
  assert.equal(report.payments[0].months[0].existingLogs[0].amount, null);
});

test("flags overlapping successful links but excludes abandoned links", () => {
  const second = { ...payment, id: "two", paymentHash: "hash-two" };
  const third = { ...payment, id: "three", paymentHash: "hash-three" };
  const checks = new Map([["one", confirmed], ["two", { ...confirmed, confirmedAttempts: 2 }],
    ["three", { status: "WAITING", creationModeKnown: true }]]);
  const report = buildReport([payment, second, third], [], checks);
  assert.deepEqual(report.payments[0].months[0].otherConfirmedLinks, ["hash-two"]);
  assert.ok(report.payments[0].flags.includes("OVERLAPPING_CONFIRMED_LINKS"));
  assert.ok(report.payments[1].flags.includes("MULTIPLE_CONFIRMED_ATTEMPTS"));
  assert.equal(report.summary.confirmed, 2);
});

test("retains failed requests and separately flags training credits for review", () => {
  const report = buildReport([{ ...payment, trainingCredits: 10 }], [],
    new Map([["one", { error: "HTTP 403" }]]));
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.confirmed, 0);
  assert.equal(report.payments[0].apiStatus, null);
  assert.ok(report.payments[0].flags.includes("TRAINING_CREDITS_REVIEW"));
});
