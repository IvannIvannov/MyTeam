import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syncFutureTrainingSessions } from "@/lib/trainingSessions";
vi.mock("@/lib/db", () => ({ prisma: {} }));
const date = "2026-10-21";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T09:00:00Z")); });
afterEach(() => vi.useRealTimers());
function fixture(status = "scheduled", time: string | null = "18:00", removedFromSchedule = false, sessionDate = date) {
  const row = { id: "session", trainingDate: new Date(`${sessionDate}T00:00:00Z`), trainingTime: time, status, removedFromSchedule };
  const tx = {
    $queryRaw: vi.fn(),
    club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow: "calendar_month" }) },
    player: { findMany: vi.fn().mockResolvedValue([{ id: "new", fullName: "New", teamGroup: null }]) },
    trainingSession: { findMany: vi.fn().mockResolvedValue([row]), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn().mockResolvedValue({ id: "session" }) },
    trainingSessionPlayer: { findMany: vi.fn().mockResolvedValue([{ playerId: "removed" }]), deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    trainingOptOut: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
  };
  const sync = (trainingTime = "19:00") => syncFutureTrainingSessions({ tx, clubId: "club", scope: { type: "customGroup", id: "group" }, trainingDates: [sessionDate], trainingDateTimes: { [sessionDate]: trainingTime }, trainingDurationMinutes: 90, trainingFieldId: null, trainingFieldPieceIds: [], todayIso: sessionDate });
  return { tx, sync };
}
it("keeps an explicitly cancelled session cancelled during mixed schedule and roster edits", async () => {
  const { tx, sync } = fixture("cancelled");
  await sync();
  expect(tx.trainingSession.upsert).not.toHaveBeenCalled();
  expect(tx.trainingSessionPlayer.deleteMany).not.toHaveBeenCalled();
  expect(tx.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
});
it.each(["08:00", "11:59"])("preserves attendance when correcting a session which already started at %s Sofia time", async (time) => {
  const { tx, sync } = fixture("scheduled", time);
  await sync();
  expect(tx.trainingSession.upsert).toHaveBeenCalled();
  expect(tx.trainingSessionPlayer.deleteMany).not.toHaveBeenCalled();
  expect(tx.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
});
it("removes only untouched future roster entries, preserving existing absence reasons", async () => {
  const { tx, sync } = fixture();
  await sync();
  expect(tx.trainingSession.upsert).toHaveBeenCalled();
  expect(tx.trainingSessionPlayer.deleteMany).toHaveBeenCalledWith({ where: {
    trainingSessionId: "session", playerId: { notIn: ["new"] }, creditChargedAt: null,
    attendanceRecorded: false, reasonCode: null, reasonText: null,
  } });
  expect(tx.trainingSessionPlayer.createMany).toHaveBeenCalled();
});
it.each(["12:00", "12:01"])("allows schedule edits at or before the existing start time %s", async (time) => {
  const { tx, sync } = fixture("scheduled", time);
  await sync();
  expect(tx.trainingSession.upsert).toHaveBeenCalled();
});
it("conservatively preserves an existing same-day session with an unknown start time", async () => {
  const { tx, sync } = fixture("scheduled", null);
  await sync();
  expect(tx.trainingSession.upsert).toHaveBeenCalled();
  expect(tx.trainingSessionPlayer.deleteMany).not.toHaveBeenCalled();
});
it("still permits intentionally re-adding a removed future session with preserved history", async () => {
  const { tx, sync } = fixture("cancelled", "18:00", true);
  await sync();
  expect(tx.trainingSession.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "scheduled", removedFromSchedule: false }) }));
});
it("still creates new future sessions", async () => {
  const { tx, sync } = fixture();
  tx.trainingSession.findMany.mockResolvedValueOnce([]);
  await sync();
  expect(tx.trainingSession.upsert).toHaveBeenCalled();
});
it("compares winter session times in Sofia rather than UTC", async () => {
  vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
  const { tx, sync } = fixture("scheduled", "11:59", false, "2026-10-26");
  await sync();
  expect(tx.trainingSessionPlayer.deleteMany).not.toHaveBeenCalled();
});
