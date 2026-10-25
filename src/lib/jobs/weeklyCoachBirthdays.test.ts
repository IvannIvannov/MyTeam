import { beforeEach, expect, it, vi } from "vitest";
import { nextBirthdayWeek, runWeeklyCoachBirthdays } from "./weeklyCoachBirthdays";
const mocks = vi.hoisted(() => ({ groups: vi.fn(), create: vi.fn(), push: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { coachGroup: { findMany: mocks.groups }, adminNotification: { createMany: mocks.create } } }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: mocks.push }));
vi.mock("@/lib/adminNotificationEvents", () => ({ publishAdminNotificationCreated: mocks.publish }));
const monday = new Date("2026-10-26T07:00:00Z");
const player = (name: string, date: string) => ({ id: name, fullName: name, birthDate: new Date(date) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.groups.mockResolvedValue([
    { id: "g1", clubId: "c1", name: "Група 1", players: [player("Иван", "2010-11-02"), player("Петър", "2012-11-08"), player("Извън", "2011-11-09")] },
    { id: "g2", clubId: "c2", name: "Група 2", players: [player("Друг", "2014-11-04")] },
    { id: "empty", clubId: "c1", name: "Без рожденици", players: [] },
  ]);
  const keys = new Set<string>();
  mocks.create.mockImplementation(async ({ data }) => { const id = data[0].id; if (keys.has(id)) return { count: 0 }; keys.add(id); return { count: 1 }; });
  mocks.push.mockResolvedValue({ failed: 0 });
});
it("includes exactly the following Monday–Sunday, including both boundaries", async () => {
  expect(nextBirthdayWeek(monday)?.dates).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  expect(await runWeeklyCoachBirthdays(monday)).toMatchObject({ success: true, notifiedGroups: 2 });
  const [club, payload, group] = mocks.push.mock.calls[0];
  expect([club, group]).toEqual(["c1", "g1"]);
  expect(payload.body).toContain("02.11 — Иван"); expect(payload.body).toContain("08.11 — Петър");
  expect(payload.body).not.toContain("Извън"); expect(payload.body).not.toContain("Друг");
  expect(mocks.push.mock.calls[1][2]).toBe("g2");
  expect(mocks.groups.mock.calls[0][0].select.players.where).toMatchObject({ isActive: true, birthDate: { not: null } });
});
it("does no database work before Monday morning or on other weekdays", async () => {
  for (const date of ["2026-10-26T06:59:00Z", "2026-10-27T10:00:00Z", "2026-10-25T21:30:00Z"]) {
    expect(await runWeeklyCoachBirthdays(new Date(date))).toMatchObject({ skipped: true });
  }
  expect(mocks.groups).not.toHaveBeenCalled();
});
it("uses Sofia calendar dates across year boundaries and DST", () => {
  expect(nextBirthdayWeek(new Date("2026-12-28T10:00:00Z"))).toMatchObject({ start: "2027-01-04", end: "2027-01-10" });
  expect(nextBirthdayWeek(new Date("2026-03-23T10:00:00Z"))).toMatchObject({ start: "2026-03-30", end: "2026-04-05" });
  expect(nextBirthdayWeek(new Date("2026-03-22T22:30:00Z"))?.today).toBe("2026-03-23");
});
it("deduplicates concurrent and repeated runs without requiring push devices", async () => {
  await Promise.all([runWeeklyCoachBirthdays(monday), runWeeklyCoachBirthdays(monday)]);
  await runWeeklyCoachBirthdays(monday);
  expect(mocks.push).toHaveBeenCalledTimes(2); expect(mocks.publish).toHaveBeenCalledTimes(2);
});
it("keeps inbox history when push fails and continues to other groups", async () => {
  mocks.push.mockRejectedValueOnce(new Error("delivery unavailable"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await runWeeklyCoachBirthdays(monday)).toMatchObject({ success: true, notifiedGroups: 2, pushWarnings: 1 });
  expect(mocks.create).toHaveBeenCalledTimes(2);
  vi.restoreAllMocks();
});
it("isolates a database failure to the affected group", async () => {
  mocks.create.mockRejectedValueOnce(new Error("write failed"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await runWeeklyCoachBirthdays(monday)).toMatchObject({ success: false, failedGroups: ["g1"], notifiedGroups: 1 });
  vi.restoreAllMocks();
});
