import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, PATCH } from "@/app/api/admin/clubs/[id]/training-attendance/session/route";
import { expandCoachRecurrences, parseCoachRecurrences } from "./coachTrainingSchedule";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn(),
  trainingSession: { findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  coachGroup: { findFirst: vi.fn(), update: vi.fn() },
  limitedTrainingEvent: { deleteMany: vi.fn() }, trainingNote: { deleteMany: vi.fn() },
  club: { findUnique: vi.fn() }, clubCustomTrainingGroup: { findFirst: vi.fn(), update: vi.fn() },
  player: { findMany: vi.fn() }, trainingOptOut: { deleteMany: vi.fn() },
  clubTrainingGroupSchedule: { findMany: vi.fn() }, clubTrainingScheduleGroup: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["admin"] }) }));
vi.mock("@/lib/push/coachTrainingNotifications", () => ({ notifyCoachTrainingChanges: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push/trainingCancellationNotifications", () => ({ sendTrainingCancellationNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));

const id = "10000000-0000-4000-8000-000000000001";
const group = "10000000-0000-4000-8000-000000000002";
const rule = "10000000-0000-4000-8000-000000000003";
const date = "2026-10-12";
const scopeKey = `coach_group:${group}`;
const params = { params: Promise.resolve({ id: group }) };
const request = (body: object, method = "DELETE") => new NextRequest("http://localhost/training", { method, headers: { cookie: "admin_session=test" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  db.trainingSession.updateMany.mockReset().mockResolvedValue({ count: 0 });
  db.trainingSession.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  db.$transaction.mockImplementation(async (callback) => callback(db));
  db.player.findMany.mockResolvedValue([]);
  db.clubTrainingGroupSchedule.findMany.mockResolvedValue([]);
  db.clubTrainingScheduleGroup.findMany.mockResolvedValue([]);
  db.trainingSession.findFirst.mockResolvedValue({ id, scopeId: group, scopeKey, scopeType: "coachGroup", trainingDate: new Date(`${date}T00:00:00Z`), recurrenceId: rule, recurrenceDate: new Date(`${date}T00:00:00Z`), trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], status: "scheduled", note: "Recorded note" });
  db.trainingSession.findMany.mockResolvedValue([{ id: "other", trainingDate: new Date(`${date}T00:00:00Z`), trainingTime: "18:00" }]);
  db.coachGroup.findFirst.mockResolvedValue({ id: group, trainingRecurrences: [{ id: rule, weekday: 1, trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [] }] });
});

it("permanently deletes only the selected coach session and its registration event, preserving the other session", async () => {
  expect((await DELETE(request({ date, trainingSessionId: id }), params)).status).toBe(200);
  const history = { OR: expect.arrayContaining([{ attendanceRecorded: true }, { creditChargedAt: { not: null } }, { reasonCode: { not: null } }, { reasonText: { not: null } }]) };
  expect(db.trainingSession.deleteMany).toHaveBeenCalledWith({ where: { id, clubId: group, scopeKey, players: { none: history } } });
  expect(db.trainingSession.updateMany).toHaveBeenCalledWith({ where: { id, clubId: group, scopeKey, players: { some: history } }, data: { status: "cancelled", removedFromSchedule: true } });
  expect(db.limitedTrainingEvent.deleteMany).toHaveBeenCalledWith({ where: { clubId: group, OR: [{ scopeKey: `${scopeKey}:session:${id}` }, { scopeKey, trainingDate: new Date(`${date}T00:00:00Z`) }] } });
  expect(db.coachGroup.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trainingDates: [date], trainingDateTimes: { [date]: "18:00" }, trainingRecurrences: [expect.objectContaining({ excludedDates: [date] })] }) }));
  expect(db.trainingSession.delete).not.toHaveBeenCalled();
});
it("keeps a charged coach session and its attendance when the training-day action removes it", async () => {
  const stored = await db.trainingSession.findFirst();
  const attendance = { attendanceRecorded: true, creditChargedAt: new Date() };
  let exists = true;
  db.trainingSession.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.players.some && attendance.creditChargedAt) Object.assign(stored, data);
    return { count: 1 };
  });
  db.trainingSession.deleteMany.mockImplementation(async ({ where }) => {
    if (!where.players?.none || !attendance.creditChargedAt) exists = false;
    return { count: 0 };
  });
  expect((await DELETE(request({ date, trainingSessionId: id }), params)).status).toBe(200);
  expect(exists).toBe(true);
  expect(stored).toMatchObject({ status: "cancelled", removedFromSchedule: true });
  expect(attendance.creditChargedAt).toBeInstanceOf(Date);
  expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.trainingSession.updateMany.mock.invocationCallOrder[0]);
});
it("does not delete another club's session or create a record when restoring a deleted coach session", async () => {
  db.trainingSession.findFirst.mockResolvedValue(null);
  expect((await DELETE(request({ date, trainingSessionId: id }), params)).status).toBe(404);
  expect((await PATCH(request({ date, trainingSessionId: id, status: "scheduled" }, "PATCH"), params)).status).toBe(409);
  expect(db.trainingSession.delete).not.toHaveBeenCalled();
  expect(db.trainingSession.upsert).not.toHaveBeenCalled();
});
it.each([
  { date, trainingSessionId: id, status: "scheduled" },
  { date, customTrainingGroupId: id, status: "scheduled" },
  { date, teamGroup: 2026, status: "scheduled" },
  { date, status: "scheduled" },
])("rejects restoration before reading or modifying training records: %j", async (body) => {
  const response = await PATCH(request(body, "PATCH"), params);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Training restoration is disabled" });
  expect(db.trainingSession.findFirst).not.toHaveBeenCalled();
  expect(db.trainingSession.upsert).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("never regenerates an excluded recurring occurrence, including after its time changes", () => {
  const rules = parseCoachRecurrences([{ id: rule, weekday: 1, trainingTime: "18:00", trainingDurationMinutes: 60, excludedDates: [date] }]);
  expect(expandCoachRecurrences(rules, [], date, 8).map((session) => session.date)).toEqual(["2026-10-19"]);
});
it("deletes a legacy date from its schedule along with scoped notes, registrations, and attendance", async () => {
  db.club.findUnique.mockResolvedValue({ id: group });
  db.clubCustomTrainingGroup.findFirst.mockResolvedValue({ id, trainingDates: [date, "2026-10-13"], trainingWeekdays: [], trainingDateTimes: { [date]: "09:00", "2026-10-13": "18:00" }, trainingFieldSelections: {} });
  expect((await DELETE(request({ date, customTrainingGroupId: id }), params)).status).toBe(200);
  expect(db.clubCustomTrainingGroup.update).toHaveBeenCalledWith({ where: { id }, data: { trainingDates: ["2026-10-13"], trainingWeekdays: [], trainingDateTimes: { "2026-10-13": "18:00" }, trainingFieldSelections: {} } });
  expect(db.trainingSession.deleteMany).toHaveBeenCalledWith({ where: {
    clubId: group, scopeKey: `custom_group:${id}`, trainingDate: new Date(`${date}T00:00:00Z`),
    players: { none: { OR: expect.arrayContaining([{ attendanceRecorded: true }, { creditChargedAt: { not: null } }, { reasonCode: { not: null } }, { reasonText: { not: null } }]) } },
  } });
});
it("cleans up legacy absence reasons while preserving decisions shared with another training", async () => {
  db.club.findUnique.mockResolvedValue({ id: group, trainingGroupMode: "custom_group" });
  db.clubCustomTrainingGroup.findFirst.mockResolvedValue({ id, trainingDates: [date], trainingWeekdays: [], trainingDateTimes: {}, trainingFieldSelections: {} });
  db.player.findMany.mockResolvedValue([{ id: "only-this-training", teamGroup: null, customTrainingGroups: [] }, { id: "another-training", teamGroup: null, customTrainingGroups: [{ group: { trainingDates: [date], trainingWeekdays: [] } }] }]);
  db.trainingSession.findMany.mockResolvedValue([]);
  expect((await DELETE(request({ date, customTrainingGroupId: id }), params)).status).toBe(200);
  expect(db.trainingOptOut.deleteMany).toHaveBeenCalledWith({ where: { trainingDate: new Date(`${date}T00:00:00Z`), playerId: { in: ["only-this-training"] } } });
});
