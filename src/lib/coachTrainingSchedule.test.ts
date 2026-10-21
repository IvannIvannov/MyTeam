import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { coachTrainingsConflict, expandCoachRecurrences, parseCoachTraining, writeCoachTrainings, type CoachTraining } from "./coachTrainingSchedule";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const groupId = "10000000-0000-4000-8000-000000000001";
const firstId = "10000000-0000-4000-8000-000000000002";
const secondId = "10000000-0000-4000-8000-000000000003";
const ruleId = "10000000-0000-4000-8000-000000000004";
const training = (patch: Partial<CoachTraining> = {}): CoachTraining => ({ id: firstId, date: "2026-10-12", trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: groupId, trainingFieldPieceIds: ["north"], recurrenceId: null, status: "scheduled", note: "", ...patch });

describe("multiple coach trainings", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T07:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("allows consecutive trainings, other fields, disjoint sections, and cancellations", () => {
    const a = training();
    expect(coachTrainingsConflict(a, training({ trainingTime: "10:00" }))).toBe(false);
    expect(coachTrainingsConflict(a, training({ trainingFieldId: secondId }))).toBe(false);
    expect(coachTrainingsConflict(a, training({ trainingFieldPieceIds: ["south"] }))).toBe(false);
    expect(coachTrainingsConflict(a, training({ status: "cancelled" }))).toBe(false);
    expect(coachTrainingsConflict(a, training({ trainingFieldId: null }))).toBe(false);
    expect(coachTrainingsConflict(a, training({ date: "2026-10-13" }))).toBe(false);
  });
  it("rejects shared sections and whole-field overlaps, respecting each duration", () => {
    expect(coachTrainingsConflict(training(), training({ trainingTime: "09:59", trainingFieldPieceIds: ["north", "south"] }))).toBe(true);
    expect(coachTrainingsConflict(training(), training({ trainingFieldPieceIds: [] }))).toBe(true);
    expect(coachTrainingsConflict(training({ trainingDurationMinutes: 90 }), training({ trainingTime: "10:00" }))).toBe(true);
  });
  it("retains occurrence identity, cancellation, and notes when a recurring time changes", () => {
    const existing = training({ recurrenceId: ruleId, status: "cancelled", note: "Keep this" });
    const rules = [{ id: ruleId, weekday: 1, trainingTime: "18:00", trainingDurationMinutes: 90, trainingFieldId: secondId, trainingFieldPieceIds: [] }];
    const rows = expandCoachRecurrences(rules, [existing], "2026-10-12", 8);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: firstId, trainingTime: "18:00", status: "cancelled", note: "Keep this", trainingDurationMinutes: 90 });
    expect(rows[1].date).toBe("2026-10-19");
    expect(rows[1].id).not.toBe(firstId);
  });
  it("supports several recurring times on a weekday with independent fields", () => {
    const rules = [{ id: ruleId, weekday: 1, trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: groupId, trainingFieldPieceIds: [] }, { id: secondId, weekday: 1, trainingTime: "18:00", trainingDurationMinutes: 90, trainingFieldId: secondId, trainingFieldPieceIds: [] }];
    expect(expandCoachRecurrences(rules, [], "2026-10-12", 1).map((r) => [r.trainingTime, r.trainingFieldId])).toEqual([["09:00", groupId], ["18:00", secondId]]);
  });
  it("does not recreate a rescheduled occurrence on its original day", () => {
    const existing = training({ date: "2026-10-13", recurrenceId: ruleId, recurrenceDate: "2026-10-12" });
    const rule = { id: ruleId, weekday: 1, trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: groupId, trainingFieldPieceIds: [] };
    expect(expandCoachRecurrences([rule], [existing], "2026-10-12", 1)).toEqual([expect.objectContaining({ id: firstId, date: "2026-10-13", recurrenceDate: "2026-10-12" })]);
  });
  it("rejects invalid dates, IDs, and sessions crossing midnight", () => {
    expect(() => parseCoachTraining({ ...training(), id: "bad" })).toThrow();
    expect(() => parseCoachTraining({ ...training(), date: "2026-02-30" })).toThrow();
    expect(() => parseCoachTraining({ ...training(), trainingTime: "23:30" })).toThrow("same day");
  });

  function writer(existing: unknown[]) {
    return {
      $queryRaw: vi.fn(),
      club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow: "training_credits" }) },
      trainingSession: { findMany: vi.fn().mockResolvedValue(existing), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      trainingSessionPlayer: { createMany: vi.fn() },
      player: { findMany: vi.fn().mockResolvedValue([{ id: "player", fullName: "Player", teamGroup: 2015 }]) },
      coachGroup: { update: vi.fn() },
    };
  }
  it("editing one training preserves its attendance and starts another independently", async () => {
    const tx = writer([{ id: firstId, trainingDate: new Date("2026-10-12T00:00:00Z"), note: "", status: "scheduled", players: [{ playerId: "player", present: false, reasonCode: "sick", attendanceRecorded: true }] }]);
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [training({ trainingTime: "10:00" }), training({ id: secondId, trainingTime: "18:00" })], []);
    expect(tx.trainingSession.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: firstId } }));
    expect(tx.trainingSessionPlayer.createMany).toHaveBeenCalledOnce();
    expect(tx.trainingSessionPlayer.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ trainingSessionId: secondId, playerId: "player", present: false })]);
    expect(tx.trainingSession.delete).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.trainingSession.findMany.mock.invocationCallOrder[0]);
  });
  it("preserves a charge timestamp even if attendanceRecorded is false", async () => {
    const tx = writer([{ id: firstId, trainingDate: new Date("2026-10-12T00:00:00Z"), note: null, status: "scheduled", players: [{ present: false, attendanceRecorded: false, creditChargedAt: new Date() }] }]);
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [], []);
    expect(tx.trainingSession.update).toHaveBeenCalledWith({ where: { id: firstId }, data: { status: "cancelled" } });
    expect(tx.trainingSession.delete).not.toHaveBeenCalled();
  });
  it("does not add new members to an already locked roster", async () => {
    const tx = writer([{ id: firstId, trainingDate: new Date("2026-10-12"), trainingTime: "18:00", rosterLockedAt: new Date(), players: [] }]);
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [training({ trainingTime: "19:00" })], []);
    expect(tx.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
  });
  it("does not seed a started roster when moving its time forward", async () => {
    const tx = writer([{ id: firstId, trainingDate: new Date("2026-10-12"), trainingTime: "09:00", rosterLockedAt: null, players: [] }]);
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [training({ trainingTime: "18:00" })], []);
    expect(tx.trainingSessionPlayer.createMany).not.toHaveBeenCalled();
  });
  it("cancels instead of deleting a locked session with default attendance", async () => {
    const tx = writer([{ id: firstId, trainingDate: new Date("2026-10-12"), trainingTime: "18:00", rosterLockedAt: new Date(), players: [{ present: true, attendanceRecorded: false }] }]);
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [], []);
    expect(tx.trainingSession.delete).not.toHaveBeenCalled();
    expect(tx.trainingSession.update).toHaveBeenCalledWith({ where: { id: firstId }, data: { status: "cancelled" } });
  });
  it.each(["calendar_month", "rolling_30_days", "training_credits", "training_credits_30_days"])("uses the right default for %s", async (paymentWorkflow) => {
    const tx = writer([]);
    tx.club.findUniqueOrThrow.mockResolvedValue({ paymentWorkflow });
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [training()], []);
    expect(tx.trainingSessionPlayer.createMany.mock.calls[0][0].data[0].present).toBe(paymentWorkflow === "calendar_month" || paymentWorkflow === "rolling_30_days");
  });
  it("removal cancels recorded sessions, deletes untouched future sessions, and preserves past ones", async () => {
    const tx = writer([
      { id: firstId, trainingDate: new Date("2026-10-12T00:00:00Z"), note: "Recorded note", status: "scheduled", players: [] },
      { id: secondId, trainingDate: new Date("2026-10-13T00:00:00Z"), note: null, status: "scheduled", players: [{ present: false, attendanceRecorded: false }] },
      { id: ruleId, trainingDate: new Date("2026-10-11T00:00:00Z"), note: null, status: "scheduled", players: [] },
    ]);
    await writeCoachTrainings(tx as unknown as Parameters<typeof writeCoachTrainings>[0], "club", groupId, [], []);
    expect(tx.trainingSession.update).toHaveBeenCalledExactlyOnceWith({ where: { id: firstId }, data: { status: "cancelled" } });
    expect(tx.trainingSession.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: secondId } });
  });
});
