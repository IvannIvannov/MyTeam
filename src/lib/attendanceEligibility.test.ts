import { expect, it } from "vitest";
import { attendancePercentage, isEligibleForTraining, isEligibleForMembership } from "./attendanceEligibility";

it.each([
  ["2026-10-20T12:00:00Z", "2026-10-19", "17:00", false],
  ["2026-10-20T12:00:00Z", "2026-10-20", "14:59", false],
  ["2026-10-20T12:00:01Z", "2026-10-20", "15:00", false],
  ["2026-10-20T12:00:00Z", "2026-10-20", "15:00", true],
  ["2026-10-20T12:00:00Z", "2026-10-20", null, false],
  ["2026-10-20T12:00:00Z", "2026-10-21", null, true],
  ["2026-12-20T12:00:00Z", "2026-12-20", "14:00", true],
  ["2026-10-19T22:00:00Z", "2026-10-20", "00:30", false],
])("registration %s, session %s %s => %s", (registration, date, time, eligible) => {
  expect(isEligibleForTraining(new Date(registration), date, time)).toBe(eligible);
});

it("uses separate enrollment intervals for moves and rejoining", () => {
  const player = { createdAt: new Date("2026-01-01T00:00:00Z"), attendanceMemberships: [
    { scopeKey: "custom_group:a", joinedAt: new Date("2026-10-10T12:00:00Z"), leftAt: new Date("2026-10-12T12:00:00Z") },
    { scopeKey: "custom_group:a", joinedAt: new Date("2026-10-15T12:00:00Z"), leftAt: null },
  ] };
  expect(isEligibleForMembership(player, "2026-10-09", "17:00", "custom_group:a")).toBe(false);
  expect(isEligibleForMembership(player, "2026-10-11", "17:00", "custom_group:a")).toBe(true);
  expect(isEligibleForMembership(player, "2026-10-13", "17:00", "custom_group:a")).toBe(false);
  expect(isEligibleForMembership(player, "2026-10-16", "17:00", "custom_group:a")).toBe(true);
  expect(isEligibleForMembership(player, "2026-10-16", "17:00", "custom_group:b")).toBe(false);
});

it("keeps recorded attendance before registration and honors an explicit imported start", () => {
  const player = { createdAt: new Date("2026-10-20T12:00:00Z"), attendanceStartedAt: new Date("2026-10-01T00:00:00Z") };
  expect(isEligibleForMembership(player, "2026-10-02", "17:00", "club")).toBe(true);
  expect(isEligibleForMembership(player, "2026-09-20", "17:00", "club")).toBe(false);
  expect(isEligibleForMembership(player, "2026-09-20", "17:00", "club", true)).toBe(true);
});

it("does not invent a start date for existing memberships", () => {
  const player = { createdAt: new Date("2026-10-10T00:00:00Z"), attendanceMemberships: [{ scopeKey: "coach_group:a", joinedAt: null, leftAt: null }] };
  expect(isEligibleForMembership(player, "2026-10-11", "17:00", "coach_group:a")).toBe(true);
  expect(isEligibleForMembership(player, "2026-10-09", "17:00", "coach_group:a")).toBe(false);
});

it("excludes ineligible dates and members from attendance percentages", () => {
  expect(attendancePercentage([undefined, { present: true }, { present: false }])).toBe(50);
  expect(attendancePercentage([undefined, { present: true }])).toBe(100);
  expect(attendancePercentage([undefined])).toBeNull();
});
