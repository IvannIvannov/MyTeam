import { afterEach, describe, expect, it, vi } from "vitest";
import { chargeTrainingCheckIn } from "./trainingCheckIn";
import { deleteFutureTrainingSessionsForScope, filterCancelledTrainingDatesForScope, syncFutureTrainingSessions } from "./trainingSessions";

const db = vi.hoisted(() => ({ trainingSession: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
afterEach(() => vi.useRealTimers());

describe("recorded check-in survives schedule removal and restoration", () => {
  it.each(["club", "teamGroup", "trainingGroup", "customGroup"] as const)("preserves %s session identity, attendance and charge history", async (scopeType) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const date = "2026-10-19";
    const scope = scopeType === "club" ? { type: scopeType } : scopeType === "teamGroup" ? { type: scopeType, teamGroup: 2015 } : { type: scopeType, id: "group", teamGroups: [2015] };
    let session = { id: "session", clubId: "club", scopeType, scopeKey: scopeType, trainingDate: new Date(`${date}T00:00:00Z`), status: "scheduled", removedFromSchedule: false };
    let exists = true;
    let credits = 2;
    const row = { id: "attendance", playerId: "player", present: false, attendanceRecorded: false, creditChargedAt: null as Date | null };
    const protectedRow = (filter: { OR: ({ attendanceRecorded?: boolean; creditChargedAt?: { not: null } })[] }) => filter.OR.some((clause) => clause.attendanceRecorded ? row.attendanceRecorded : clause.creditChargedAt && row.creditChargedAt !== null);
    const tx = {
      $queryRaw: vi.fn(),
      club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow: "training_credits" }) },
      player: {
        findMany: vi.fn().mockResolvedValue([{ id: "player", fullName: "Player", teamGroup: 2015 }]),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ id: "player", clubId: "club", remainingTrainingCredits: credits, club: { paymentWorkflow: "training_credits" }, paymentLogs: [] })),
        update: vi.fn().mockImplementation(async () => ({ id: "player", remainingTrainingCredits: --credits })),
      },
      trainingSession: {
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
    await sync([]);
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
