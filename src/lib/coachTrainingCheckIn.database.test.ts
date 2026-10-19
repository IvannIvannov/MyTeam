import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { config } from "dotenv";
import { writeCoachTrainings } from "./coachTrainingSchedule";
import { trainingCheckInRange } from "./trainingCheckIn";
import { POST as checkIn } from "@/app/api/members/[cardCode]/training-credit/check-in/route";
import { NextRequest } from "next/server";

// Opt-in: this suite uses real concurrent PostgreSQL connections, isolated in
// a temporary schema. Ordinary unit-test runs do not contact a database.
config({ quiet: true });
const bridge = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: bridge.transaction } }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
vi.mock("@/lib/push/templates", () => ({ buildNotificationPayload: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/push/history", () => ({ saveMemberNotificationHistory: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn() }));

const clubId = "10000000-0000-4000-8000-000000000001";
const groupId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const playerId = "10000000-0000-4000-8000-000000000004";
const scopeKey = `coach_group:${groupId}`;
type Player = { id: string; clubId: string; fullName: string; remainingTrainingCredits: number; status: string };
type Attendance = { id: string; present: boolean; attendanceRecorded: boolean; creditChargedAt: Date | null; reasonCode: string | null; reasonText: string | null };
type Session = { id: string; clubId: string; scopeType: string; scopeKey: string; trainingDate: Date; trainingTime: string; status: string; note: string | null };
const signal = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };

describe.skipIf(process.env.RUN_DATABASE_CONCURRENCY_TESTS !== "1")("coach removal and check-in with real PostgreSQL locks", () => {
  const schema = `codex_checkin_race_${process.pid}_${Date.now()}`;
  const db = new PrismaClient();
  const writer = new PrismaClient();
  const checker = new PrismaClient();
  const app = `${schema}_writer`;
  let pauseAttendance: (() => Promise<void>) | undefined;

  async function inSchema<T>(client: PrismaClient, application: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL application_name = '${application}'`);
      return work(tx);
    }, { timeout: 20000, maxWait: 10000, isolationLevel: "ReadCommitted" });
  }

  function adapter(tx: Prisma.TransactionClient) {
    const readPlayer = async () => (await tx.$queryRaw<Player[]>`SELECT id, club_id AS "clubId", full_name AS "fullName", remaining_training_credits AS "remainingTrainingCredits", status FROM players WHERE id = ${playerId}::uuid`)[0];
    const readAttendance = () => tx.$queryRaw<Attendance[]>`SELECT id, present, attendance_recorded AS "attendanceRecorded", credit_charged_at AS "creditChargedAt", reason_code AS "reasonCode", reason_text AS "reasonText" FROM training_session_players WHERE training_session_id = ${sessionId}::uuid`;
    const readSessions = () => tx.$queryRaw<Session[]>`SELECT id, club_id AS "clubId", scope_type AS "scopeType", scope_key AS "scopeKey", training_date AS "trainingDate", training_time AS "trainingTime", status, note FROM training_sessions WHERE club_id = ${clubId}::uuid AND scope_key = ${scopeKey}`;
    return {
      $queryRaw: tx.$queryRaw.bind(tx),
      card: { findFirst: async () => ({ playerId }) },
      club: { findUniqueOrThrow: async () => ({ paymentWorkflow: "training_credits" }) },
      player: {
        findMany: async () => [],
        findUniqueOrThrow: async () => ({ ...await readPlayer(), club: { paymentWorkflow: "training_credits" }, paymentLogs: [] }),
        update: async () => { await tx.$executeRaw`UPDATE players SET remaining_training_credits = remaining_training_credits - 1, status = 'paid' WHERE id = ${playerId}::uuid`; return readPlayer(); },
      },
      trainingSession: {
        findMany: async () => { const rows = await readSessions(); const players = await readAttendance(); return rows.map((row) => ({ ...row, players })); },
        update: async () => tx.$executeRaw`UPDATE training_sessions SET status = 'cancelled' WHERE id = ${sessionId}::uuid`,
        delete: async () => tx.$executeRaw`DELETE FROM training_sessions WHERE id = ${sessionId}::uuid`,
      },
      trainingSessionPlayer: {
        findUnique: async () => { const rows = await readAttendance(); const sessions = await readSessions(); return rows[0] && sessions[0] ? { ...rows[0], trainingSession: sessions[0] } : null; },
        update: async ({ data }: { data: { creditChargedAt?: Date } }) => {
          await tx.$executeRaw`UPDATE training_session_players SET present = true, attendance_recorded = true, credit_charged_at = ${data.creditChargedAt ?? null}, reason_code = NULL, reason_text = NULL WHERE training_session_id = ${sessionId}::uuid`;
          await pauseAttendance?.();
        },
      },
      coachGroup: { update: async () => undefined },
    };
  }

  beforeAll(async () => {
    if (!/^codex_checkin_race_\d+_\d+$/.test(schema)) throw new Error("Invalid temporary schema");
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await inSchema(db, "setup", async (tx) => {
      await tx.$executeRawUnsafe("CREATE TABLE players(id UUID PRIMARY KEY, club_id UUID, full_name TEXT, remaining_training_credits INTEGER, status TEXT)");
      await tx.$executeRawUnsafe("CREATE TABLE training_sessions(id UUID PRIMARY KEY, club_id UUID, scope_type TEXT, scope_key TEXT, training_date DATE, training_time TEXT, status TEXT, note TEXT)");
      await tx.$executeRawUnsafe("CREATE TABLE training_session_players(id UUID PRIMARY KEY, training_session_id UUID REFERENCES training_sessions(id) ON DELETE CASCADE, player_id UUID, present BOOLEAN, attendance_recorded BOOLEAN, credit_charged_at TIMESTAMPTZ, reason_code TEXT, reason_text TEXT)");
    });
  }, 30000);
  afterAll(async () => {
    await Promise.all([writer.$disconnect(), checker.$disconnect()]);
    if (/^codex_checkin_race_\d+_\d+$/.test(schema)) await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }, 30000);
  beforeEach(async () => {
    pauseAttendance = undefined;
    await inSchema(db, "setup", async (tx) => {
      await tx.$executeRawUnsafe("TRUNCATE training_session_players, training_sessions, players");
      await tx.$executeRaw`INSERT INTO players VALUES (${playerId}::uuid, ${clubId}::uuid, 'Player', 2, 'paid')`;
      await tx.$executeRaw`INSERT INTO training_sessions VALUES (${sessionId}::uuid, ${clubId}::uuid, 'coachGroup', ${scopeKey}, ${trainingCheckInRange().to}, '09:00', 'scheduled', NULL)`;
      await tx.$executeRaw`INSERT INTO training_session_players VALUES ('10000000-0000-4000-8000-000000000005'::uuid, ${sessionId}::uuid, ${playerId}::uuid, false, false, NULL, NULL, NULL)`;
    });
    bridge.transaction.mockImplementation((callback) => inSchema(checker, `${schema}_checkin`, (tx) => callback(adapter(tx))));
  }, 30000);

  async function waitForLock(application: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${application} AND wait_event_type = 'Lock') AS blocked`;
      if (rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("Expected transaction did not block on PostgreSQL lock");
  }
  function confirm() { return checkIn(new NextRequest("http://localhost/check-in", { method: "POST", headers: { cookie: "admin_session=coach", "Content-Type": "application/json" }, body: JSON.stringify({ trainingSessionId: sessionId }) }), { params: Promise.resolve({ cardCode: "CARD" }) }); }
  async function snapshot() { return inSchema(db, "inspect", async (tx) => ({ players: await tx.$queryRaw<{ credits: number }[]>`SELECT remaining_training_credits AS credits FROM players`, sessions: await tx.$queryRaw<{ status: string }[]>`SELECT status FROM training_sessions`, attendance: await tx.$queryRaw<Attendance[]>`SELECT present, attendance_recorded AS "attendanceRecorded", credit_charged_at AS "creditChargedAt" FROM training_session_players` })); }

  it("removal wins: check-in waits, then rejects without spending a credit", async () => {
    const locked = signal(); const release = signal();
    const removal = inSchema(writer, app, async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      locked.release(); await release.promise;
      await writeCoachTrainings(adapter(tx) as unknown as Parameters<typeof writeCoachTrainings>[0], clubId, groupId, [], []);
    });
    await locked.promise;
    const confirmation = confirm();
    try { await waitForLock(`${schema}_checkin`); } finally { release.release(); }
    await removal;
    expect((await confirmation).status).toBe(409);
    const state = await snapshot(); expect(state.players[0].credits).toBe(2); expect(state.sessions).toEqual([]); expect(state.attendance).toEqual([]);
  }, 30000);

  it("check-in wins: removal waits and preserves the committed charge as cancelled history", async () => {
    const charged = signal(); const release = signal();
    pauseAttendance = async () => { charged.release(); await release.promise; };
    const confirmation = confirm(); await charged.promise;
    const removal = inSchema(writer, app, (tx) => writeCoachTrainings(adapter(tx) as unknown as Parameters<typeof writeCoachTrainings>[0], clubId, groupId, [], []));
    try { await waitForLock(app); } finally { release.release(); }
    expect((await confirmation).status).toBe(200); await removal;
    const state = await snapshot(); expect(state.players[0].credits).toBe(1); expect(state.sessions).toEqual([{ status: "cancelled" }]);
    expect(state.attendance).toEqual([{ present: true, attendanceRecorded: true, creditChargedAt: expect.any(Date) }]);
  }, 30000);
});
