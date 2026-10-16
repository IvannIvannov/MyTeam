import { expect, it } from "vitest";
import { hasUnsavedFeeChanges } from "@/lib/feeDraft";

const settings = { paymentAmount: "85.00", groups: [{ id: "a", paymentAmount: null }],
  players: [{ id: "p", paymentAmount: "60.00", billingCoachGroupId: null, coachGroupIds: ["a", "b"] }] };
const draft = { clubAmount: "85.00", groupFees: {}, personalFees: {}, choices: {} };
it("does not warn when untouched or when a value is restored with different formatting", () => {
  expect(hasUnsavedFeeChanges(settings, draft)).toBe(false);
  expect(hasUnsavedFeeChanges(settings, { ...draft, clubAmount: "85", personalFees: { p: "60,00" } })).toBe(false);
});
it("warns for fee edits and invalid/cleared amounts so they are not silently lost", () => {
  expect(hasUnsavedFeeChanges(settings, { ...draft, clubAmount: "90" })).toBe(true);
  expect(hasUnsavedFeeChanges(settings, { ...draft, personalFees: { p: "" } })).toBe(true);
  expect(hasUnsavedFeeChanges(settings, { ...draft, personalFees: { p: "0" } })).toBe(true);
});
it("treats explicit group pricing differently from inheritance even at the same amount", () => {
  expect(hasUnsavedFeeChanges(settings, { ...draft, groupFees: { a: "85" } })).toBe(true);
  expect(hasUnsavedFeeChanges(settings, { ...draft, groupFees: { a: "" } })).toBe(false);
});
it("includes billing-group choices, membership assignments and group deletion", () => {
  expect(hasUnsavedFeeChanges(settings, { ...draft, choices: { p: "a" } })).toBe(true);
  expect(hasUnsavedFeeChanges(settings, { ...draft, assignments: { p: ["b", "a"] } })).toBe(false);
  expect(hasUnsavedFeeChanges(settings, { ...draft, assignments: { p: ["a"] } })).toBe(true);
  expect(hasUnsavedFeeChanges(settings, { ...draft, deleteGroupId: "a" })).toBe(true);
});
