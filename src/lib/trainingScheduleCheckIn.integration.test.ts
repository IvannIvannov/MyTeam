import { afterEach, describe, expect, it, vi } from "vitest";
import { chargeTrainingCheckIn } from "./trainingCheckIn";
import { deleteFutureTrainingSessionsForScope, filterCancelledTrainingDatesForScope, syncFutureTrainingSessions } from "./trainingSessions";
import { DELETE as deleteTraining } from "@/app/api/admin/clubs/[id]/training-attendance/session/route";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ $transaction: vi.fn(), trainingSession: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/push/trainingCancellationNotifications", () => ({ sendTrainingCancellationNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push/coachTrainingNotifications", () => ({ notifyCoachTrainingChanges: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
afterEach(() => vi.useRealTimers());

describe("recorded check-in survives schedule removal and restoration", () => {
  it.each((["club", "teamGroup", "trainingGroup", "customGroup"] as const).flatMap((scopeType) => (["sync", "endpoint"] as const).map((removal) => ({ scopeType, removal }))))("preserves $scopeType session identity and charges through $removal removal", async ({ scopeType, removal }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const date = "2026-10-19";
    const scope = scopeType === "club" ? { type: scopeType } : scopeType === "teamGroup" ? { type: scopeType, teamGroup: 2015 } : { type: scopeType, id: "group", teamGroups: [2015] };
    let session = { id: "session", clubId: "club", scopeType, scopeKey: scopeType, trainingDate: new Date(`${date}T00:00:00Z`), status: "scheduled", removedFromSchedule: false };
    let exists = true;
    let credits = 2;
    const row = { id: "attendance", playerId: "player", present: false, attendanceRecorded: false, creditChargedAt: null as Date | null };
    const protectedRow = (filter: { OR: ({ attendanceRecorded?: boolean; creditChargedAt?: { not: null } })[] }) => filter.OR.some((clause) => clause.attendanceRecorded ? row.attendanceRecorded : clause.creditChargedAt && row.creditChargedAt !== null);
    const schedule = { id: "group", trainingDates: [date], trainingWeekdays: [], trainingDateTimes: {}, trainingFieldSelections: {}, teamGroups: [2015] };
    const tx = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow: "training_credits" }), findUnique: vi.fn().mockResolvedValue({ ...schedule, id: "club", trainingGroupMode: scopeType === "customGroup" ? "custom_group" : "team_group" }), update: vi.fn() },
      clubCustomTrainingGroup: { findFirst: vi.fn().mockResolvedValue(schedule), update: vi.fn() },
      clubTrainingScheduleGroup: { findFirst: vi.fn().mockImplementation(async ({ where }) => where.id ? schedule : null), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      clubTrainingGroupSchedule: { findUnique: vi.fn().mockResolvedValue(schedule), findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), create: vi.fn() },
      limitedTrainingEvent: { deleteMany: vi.fn() }, trainingNote: { deleteMany: vi.fn() },
      player: {
        findMany: vi.fn().mockResolvedValue([{ id: "player", fullName: "Player", teamGroup: 2015, customTrainingGroups: [] }]),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ id: "player", clubId: "club", remainingTrainingCredits: credits, club: { paymentWorkflow: "training_credits" }, paymentLogs: [] })),
        update: vi.fn().mockImplementation(async () => ({ id: "player", remainingTrainingCredits: --credits })),
      },
      trainingSession: {
        findMany: vi.fn().mockImplementation(async () => session.status === "scheduled" ? [{ players: [{ playerId: "player" }] }] : []),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => { if (exists && protectedRow(where.players.some)) Object.assign(session, data); return { count: 1 }; }),
        deleteMany: vi.fn().mockImplementation(async ({ where }) => { if (exists && (!where.players?.none || !protectedRow(where.players.none))) { exists = false; row.creditChargedAt = null; row.attendanceRecorded = false; } return { count: 1 }; }),
        upsert: vi.fn().mockImplementation(async ({ update }) => { if (!exists) { session = { ...session, id: "replacement-session" }; exists = true; } Object.assign(session, update); return { id: session.id }; }),
      },
      trainingSessionPlayer: {
        findUnique: vi.fn().mockImplementation(async () => exists ? { ...row, trainingSession: session } : null),
        findMany: vi.fn().mockImplementation(async () => exists ? [{ playerId: "player" }] : []),
        update: vi.fn().mockImplementation(async ({ data }) => Object.assign(row, data)),
        deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(),
      },
      trainingOptOut: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn(), deleteMany: vi.fn() },
    };
    const sync = (trainingDates: string[]) => syncFutureTrainingSessions({ tx: tx as unknown as Parameters<typeof syncFutureTrainingSessions>[0]["tx"], clubId: "club", scope, trainingDates, trainingDateTimes: {}, trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], todayIso: date });
    const checkIn = () => chargeTrainingCheckIn(tx as unknown as Parameters<typeof chargeTrainingCheckIn>[0], "player", session.id);
    await checkIn(); const chargedAt = row.creditChargedAt;
    expect(credits).toBe(1);
    if (removal === "sync") await sync([]);
    else {
      db.$transaction.mockImplementation(async (callback) => callback(tx));
      const body = { date, ...(scopeType === "customGroup" ? { customTrainingGroupId: "group" } : scopeType === "trainingGroup" ? { trainingGroupId: "group" } : scopeType === "teamGroup" ? { teamGroup: 2015 } : {}) };
      const response = await deleteTraining(new NextRequest("http://localhost/training", { method: "DELETE", headers: { cookie: "admin_session=coach" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "club" }) });
      expect(response.status).toBe(200);
    }
    expect(session.status).toBe("cancelled"); expect(session.removedFromSchedule).toBe(true); expect(exists).toBe(true);
    db.trainingSession.findMany.mockImplementation(async ({ where }) => session.status === where.status && session.removedFromSchedule === where.removedFromSchedule ? [{ trainingDate: session.trainingDate }] : []);
    expect(await filterCancelledTrainingDatesForScope({ clubId: "club", scope, trainingDates: [date] })).toEqual([date]);
    await sync([date]);
    expect(session.id).toBe("session"); expect(session.status).toBe("scheduled"); expect(session.removedFromSchedule).toBe(false);
    expect(row.present).toBe(true); expect(row.creditChargedAt).toBe(chargedAt);
    await checkIn(); expect(credits).toBe(1);
    await deleteFutureTrainingSessionsForScope({ tx: tx as unknown as Parameters<typeof deleteFutureTrainingSessionsForScope>[0]["tx"], clubId: "club", scope, todayIso: date });
    expect(exists).toBe(true); expect(row.creditChargedAt).toBe(chargedAt);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.trainingSession.updateMany.mock.invocationCallOrder[0]);
  });
});
