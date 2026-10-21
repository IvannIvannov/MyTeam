import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/clubs/[id]/custom-training-groups/[groupId]/route";
import { syncFutureTrainingSessions } from "@/lib/trainingSessions";
import { assertNoTrainingFieldConflict, assertNoTrainingTimeConflict } from "@/lib/trainingFieldConflicts";
import { isCustomTrainingGroupColorTakenInScope } from "@/lib/customTrainingGroupColorScope";
import { verifyAdminToken } from "@/lib/adminAuth";

const mocks = vi.hoisted(() => ({
  clubCustomTrainingGroup: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  clubCustomTrainingGroupPlayer: { deleteMany: vi.fn(), createMany: vi.fn() },
  player: { findMany: vi.fn() },
  field: { count: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/customTrainingGroupColorScope", () => ({ isCustomTrainingGroupColorTakenInScope: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/push/trainingScheduleNotifications", () => ({ sendTrainingScheduleNotifications: vi.fn(), shouldNotifyForTrainingDatesChange: vi.fn().mockReturnValue(false) }));
vi.mock("@/lib/trainingSessions", () => ({ deleteFutureTrainingSessionsForScope: vi.fn(), syncFutureTrainingSessions: vi.fn() }));
vi.mock("@/lib/trainingFieldConflicts", () => ({
  assertNoTrainingFieldConflict: vi.fn(), assertNoTrainingTimeConflict: vi.fn(),
  pickTrainingConflictCheckInput: vi.fn().mockReturnValue({ trainingDates: [], trainingDateTimes: {}, trainingFieldSelections: {} }),
}));

const fieldId = "10000000-0000-4000-8000-000000000001";
const date = "2026-10-22";
const group = () => ({
  id: "group", name: "13+ черни колани", color: "#212121", coachGroupId: null,
  trainingDates: [], trainingDateTimes: {}, trainingTime: "18:00", trainingDurationMinutes: 60,
  trainingFieldId: null, trainingFieldPieceIds: [], trainingFieldSelections: {}, trainingWeekdays: [],
  createdAt: new Date(), updatedAt: new Date(), players: [],

});
async function edit(body: Record<string, unknown> = { name: "13+ черни колани", color: "#212121", playerIds: ["player"] }) {
  return PATCH(new NextRequest("http://localhost/api/admin/clubs/club/custom-training-groups/group", {
    method: "PATCH", headers: { cookie: "admin_session=token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "club", groupId: "group" }) });
}

describe("custom group edits with legacy schedules without venues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T09:00:00Z"));
    mocks.field.count.mockResolvedValue(1);
    mocks.field.findFirst.mockResolvedValue({ id: fieldId, pieces: [] });
    mocks.player.findMany.mockReset().mockResolvedValue([{ id: "player" }]);
    mocks.$transaction.mockImplementation(async (callback) => callback(mocks));
    mocks.clubCustomTrainingGroup.findUniqueOrThrow.mockImplementation(async () => ({
      ...await mocks.clubCustomTrainingGroup.findFirst(),
      ...mocks.clubCustomTrainingGroup.update.mock.lastCall?.[0].data,
      players: [{ playerId: "player", player: { fullName: "Кирил Филипов", teamGroup: null } }],
    }));
  });
  afterEach(() => vi.useRealTimers());

  it("saves a roster-only group without a venue even when the club has venues", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue(group());
    expect((await edit()).status).toBe(200);
    expect(mocks.clubCustomTrainingGroupPlayer.createMany).toHaveBeenCalled();
  });

  it("saves a scheduled group when the club has no venues", async () => {
    mocks.field.count.mockResolvedValue(0);
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    expect((await edit()).status).toBe(200);
  });

  it("saves a scheduled group with its existing venue", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date], trainingFieldId: fieldId });
    expect((await edit()).status).toBe(200);
  });

  it("keeps allowing membership edits after a venue is added to a previously venue-free club", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    mocks.field.count.mockResolvedValue(0);
    expect((await edit()).status).toBe(200);
    mocks.field.count.mockResolvedValue(1);
    const response = await edit();
    expect(response.status).toBe(200);
  });

  it.each([date, "2026-01-01"])("saves membership changes with stored date %s without a venue", async (storedDate) => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [storedDate] });
    const response = await edit();
    expect(response.status).toBe(200);
    expect(mocks.clubCustomTrainingGroupPlayer.createMany).toHaveBeenCalledWith({ data: [{ groupId: "group", playerId: "player" }], skipDuplicates: true });
    expect(mocks.clubCustomTrainingGroup.update).toHaveBeenCalledWith({ where: { id: "group" }, data: { name: "13+ черни колани", color: "#212121" } });
    expect(mocks.field.count).not.toHaveBeenCalled();
    expect(assertNoTrainingFieldConflict).not.toHaveBeenCalled();
    expect(assertNoTrainingTimeConflict).not.toHaveBeenCalled();
    expect(syncFutureTrainingSessions).not.toHaveBeenCalled();
  });

  it("allows membership edits with per-date venues but no top-level venue", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({
      ...group(), trainingDates: [date],
      trainingFieldSelections: { [date]: { trainingFieldId: fieldId, trainingFieldPieceIds: [] } },
    });
    const response = await edit();
    expect(response.status).toBe(200);
  });

  it.each([{ name: "Updated group" }, { color: "#E53935" }])("allows metadata-only edits: %j", async (body) => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    expect((await edit(body)).status).toBe(200);
    expect(syncFutureTrainingSessions).not.toHaveBeenCalled();
  });

  it.each([
    { trainingDates: [date] }, { trainingTime: "19:00" }, { trainingDateTimes: { [date]: "19:00" } },
    { trainingDurationMinutes: 90 }, { trainingFieldId: null }, { trainingFieldPieceIds: [] },
    { trainingFieldSelections: {} }, { playerIds: ["player"], trainingTime: "19:00" },
  ])("still requires a venue when schedule fields are submitted: %j", async (body) => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    const response = await edit(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Треньорът трябва да избере терен." });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("still validates venues and conflicts when updating a schedule with a venue", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date], trainingFieldId: fieldId });
    expect((await edit({ trainingTime: "19:00" })).status).toBe(200);
    expect(mocks.field.findFirst).toHaveBeenCalled();
    expect(assertNoTrainingFieldConflict).toHaveBeenCalled();
    expect(assertNoTrainingTimeConflict).toHaveBeenCalled();
  });

  it.each([
    { trainingTime: null, trainingDateTimes: {} },
    { trainingDateTimes: { "2026-01-01": "18:00" } },
    { trainingFieldSelections: { "2026-01-01": { trainingFieldId: fieldId, trainingFieldPieceIds: [] } } },
  ])("does not revalidate unchanged legacy schedule data during a membership edit: %j", async (legacy) => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date], ...legacy });
    expect((await edit()).status).toBe(200);
    expect(mocks.clubCustomTrainingGroupPlayer.createMany).toHaveBeenCalled();
  });

  it("uses the legacy fallback time when syncing an explicitly changed schedule", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date], trainingDateTimes: {} });
    expect((await edit({ trainingDurationMinutes: 90, trainingFieldId: fieldId })).status).toBe(200);
    expect(syncFutureTrainingSessions).toHaveBeenCalledWith(expect.objectContaining({ trainingDateTimes: { [date]: "18:00" } }));
  });

  it.each([[], null, ["inactive"], ["other-club"]])("rejects empty or ineligible member selections: %j", async (playerIds) => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    mocks.player.findMany.mockResolvedValueOnce([]);
    expect((await edit({ playerIds })).status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("deduplicates members before checking eligibility and writing membership", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue(group());
    expect((await edit({ playerIds: ["player", " player ", "", "player"] })).status).toBe(200);
    expect(mocks.player.findMany).toHaveBeenCalledWith({ where: { id: { in: ["player"] }, clubId: "club", isActive: true }, select: { id: true } });
    expect(mocks.clubCustomTrainingGroupPlayer.createMany).toHaveBeenCalledWith({ data: [{ groupId: "group", playerId: "player" }], skipDuplicates: true });
  });

  it("still rejects unavailable colors on a membership edit", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    vi.mocked(isCustomTrainingGroupColorTakenInScope).mockResolvedValueOnce(true);
    expect((await edit()).status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("still rejects unauthenticated edits", async () => {
    vi.mocked(verifyAdminToken).mockResolvedValueOnce(null);
    expect((await edit()).status).toBe(401);
    expect(mocks.clubCustomTrainingGroup.findFirst).not.toHaveBeenCalled();
  });

  it("does not update a group outside the requested club", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValueOnce(null);
    expect((await edit()).status).toBe(404);
    expect(mocks.clubCustomTrainingGroup.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "group", clubId: "club" } }));
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid member edits even when the same request includes a valid venue", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    expect((await edit({ playerIds: [], trainingFieldId: fieldId })).status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("preserves schedule conflict rejection on mixed member and schedule edits", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date], trainingFieldId: fieldId });
    vi.mocked(assertNoTrainingFieldConflict).mockRejectedValueOnce(new Error("Field is already booked."));
    const response = await edit({ playerIds: ["player"], trainingTime: "19:00" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Field is already booked." });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it.each([{}, { name: "  " }, { color: "#123456" }])("rejects invalid or empty metadata edits: %j", async (body) => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue(group());
    expect((await edit(body)).status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("allows explicitly clearing a schedule without choosing a venue", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    expect((await edit({ trainingDates: [], trainingDateTimes: {}, trainingTime: null, trainingFieldId: null, trainingFieldSelections: {} })).status).toBe(200);
    expect(mocks.clubCustomTrainingGroup.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trainingDates: [], trainingTime: null }) }));
  });

  it("still rejects a venue which no longer belongs to the club on schedule edits", async () => {
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [date] });
    mocks.field.findFirst.mockResolvedValueOnce(null);
    const response = await edit({ trainingFieldId: fieldId });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Selected field was not found." });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { paymentWorkflow: "calendar_month", trainingDateTimes: {}, expectedTime: "18:00" },
    { paymentWorkflow: "training_credits", trainingDateTimes: {}, expectedTime: "18:00" },
    { paymentWorkflow: "calendar_month", trainingDateTimes: { [date]: "19:00" }, expectedTime: "19:00" },
    { paymentWorkflow: "training_credits", trainingDateTimes: { [date]: "19:00" }, expectedTime: "19:00" },
  ])("syncs actual sessions on mixed membership and schedule changes: %j", async ({ paymentWorkflow, trainingDateTimes, expectedTime }) => {
    const actual = await vi.importActual<typeof import("@/lib/trainingSessions")>("@/lib/trainingSessions");
    vi.mocked(syncFutureTrainingSessions).mockImplementationOnce(actual.syncFutureTrainingSessions);
    const players = [
      { id: "existing", fullName: "Existing", teamGroup: null },
      { id: "player", fullName: "Кирил Филипов", teamGroup: null },
    ];
    mocks.player.findMany.mockResolvedValue(players);
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({
      ...group(), trainingDates: ["2026-01-01", date], trainingDateTimes,
      trainingFieldSelections: { "2026-01-01": { trainingFieldId: fieldId, trainingFieldPieceIds: [] } },
      players: [{ playerId: "existing" }],
    });
    const tx = {
      ...mocks,
      $queryRaw: vi.fn(),
      club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow }) },
      trainingSession: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn().mockResolvedValue({ id: "session" }) },
      trainingSessionPlayer: {
        findMany: vi.fn().mockResolvedValue([{ playerId: "existing" }]),
        deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(),
      },
      trainingOptOut: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    };
    mocks.$transaction.mockImplementation(async (callback) => callback(tx));
    expect((await edit({ playerIds: ["existing", "player"], trainingDates: [date], trainingTime: expectedTime, trainingFieldId: fieldId, trainingFieldSelections: {} })).status).toBe(200);
    expect(tx.trainingSession.upsert).toHaveBeenCalledTimes(1);
    expect(tx.trainingSession.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ trainingTime: expectedTime, trainingFieldId: fieldId }),
      create: expect.objectContaining({ trainingDate: new Date(`${date}T00:00:00Z`), trainingTime: expectedTime }),
    }));
    expect(tx.trainingSessionPlayer.createMany).toHaveBeenCalledWith({
      data: [{ trainingSessionId: "session", playerId: "player", playerName: "Кирил Филипов", teamGroup: null, present: paymentWorkflow === "calendar_month", reasonCode: null, reasonText: null }],
      skipDuplicates: true,
    });
    expect(tx.trainingSessionPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.trainingSessionPlayer.deleteMany).toHaveBeenCalledWith({
      where: { trainingSessionId: "session", playerId: { notIn: ["existing", "player"] }, creditChargedAt: null, attendanceRecorded: false, reasonCode: null, reasonText: null },
    });
    if (paymentWorkflow === "training_credits") expect(tx.trainingOptOut.createMany).toHaveBeenCalled();
    else expect(tx.trainingOptOut.createMany).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "finished-today"])("preserves %s session state on mixed member and schedule edits", async (scenario) => {
    const actual = await vi.importActual<typeof import("@/lib/trainingSessions")>("@/lib/trainingSessions");
    vi.mocked(syncFutureTrainingSessions).mockImplementationOnce(actual.syncFutureTrainingSessions);
    const storedDate = scenario === "cancelled" ? date : "2026-10-21";
    let sessionStatus = scenario === "cancelled" ? "cancelled" : "scheduled";
    let roster = [{ playerId: "removed", attendanceRecorded: false, creditChargedAt: null }];
    mocks.clubCustomTrainingGroup.findFirst.mockResolvedValue({ ...group(), trainingDates: [storedDate], trainingTime: "08:00", trainingFieldId: fieldId });
    const tx = {
      ...mocks, $queryRaw: vi.fn(),
      club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow: "calendar_month" }) },
      trainingSession: {
        findMany: vi.fn().mockResolvedValue([{ id: "session", trainingDate: new Date(`${storedDate}T00:00:00Z`), trainingTime: "08:00", status: sessionStatus, removedFromSchedule: false }]),
        updateMany: vi.fn(), deleteMany: vi.fn(),
        upsert: vi.fn().mockImplementation(async (args) => { sessionStatus = args.update.status; return { id: "session" }; }),
      },
      trainingSessionPlayer: {
        findMany: vi.fn().mockImplementation(async () => roster),
        deleteMany: vi.fn().mockImplementation(async (args) => { roster = roster.filter((row) => args.where.playerId.notIn.includes(row.playerId)); }),
        createMany: vi.fn(), updateMany: vi.fn(),
      },
      trainingOptOut: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    };
    mocks.$transaction.mockImplementation(async (callback) => callback(tx));
    expect((await edit({ playerIds: ["player"], trainingDurationMinutes: 90 })).status).toBe(200);
    if (scenario === "cancelled") expect(sessionStatus).toBe("cancelled");
    else expect(roster).toHaveLength(1);
    if (scenario === "cancelled") expect(tx.trainingSession.upsert).not.toHaveBeenCalled();
    else expect(tx.trainingSession.upsert).toHaveBeenCalled();
  });
});
