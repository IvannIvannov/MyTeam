import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/clubs/[id]/custom-training-groups/[groupId]/route";
import { syncFutureTrainingSessions } from "@/lib/trainingSessions";

const mocks = vi.hoisted(() => ({
  clubCustomTrainingGroup: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  player: { findMany: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["coach"] }) }));
vi.mock("@/lib/trainingSessions", () => ({ syncFutureTrainingSessions: vi.fn(), deleteFutureTrainingSessionsForScope: vi.fn() }));
vi.mock("@/lib/customTrainingGroupColorScope", () => ({ isCustomTrainingGroupColorTakenInScope: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/push/trainingScheduleNotifications", () => ({ shouldNotifyForTrainingDatesChange: vi.fn().mockReturnValue(false), sendTrainingScheduleNotifications: vi.fn() }));

const clubId = "00000000-0000-4000-8000-000000000001";
const groupId = "00000000-0000-4000-8000-000000000002";
const playerId = "00000000-0000-4000-8000-000000000003";
const otherPlayerId = "00000000-0000-4000-8000-000000000004";
const scopeKey = `custom_group:${groupId}`;
const db = new PGlite();
let storedGroup: ReturnType<typeof groupData>;
let failAfterMembershipWrite = false;
function groupData(trainingDates: string[]) {
  return { id: groupId, name: "Group", color: "#212121", coachGroupId: null, trainingDates,
    trainingTime: "17:00", trainingDateTimes: {}, trainingDurationMinutes: 60,
    trainingFieldId: null, trainingFieldPieceIds: [], trainingFieldSelections: {}, trainingWeekdays: [1, 3, 5],
    createdAt: new Date(), updatedAt: new Date(), players: [] };
}
beforeAll(async () => {
  await db.exec(`
    CREATE TABLE clubs(id uuid PRIMARY KEY, payment_workflow text);
    CREATE TABLE players(id uuid PRIMARY KEY, club_id uuid, full_name text, team_group integer, is_active boolean, created_at timestamptz DEFAULT now());
    CREATE TABLE training_opt_outs(player_id uuid, training_date date, reason_code text, reason_text text, UNIQUE(player_id,training_date));
    CREATE TABLE "_PlayerCoachGroups"("A" uuid,"B" uuid,UNIQUE("A","B"));
    CREATE TABLE club_custom_training_group_players(group_id uuid,player_id uuid,PRIMARY KEY(group_id,player_id));
    CREATE TABLE training_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,scope_key text,status text,training_date date,training_time text,removed_from_schedule boolean DEFAULT false);
    CREATE TABLE training_session_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),training_session_id uuid,player_id uuid,player_name text,team_group integer,present boolean DEFAULT true,attendance_recorded boolean DEFAULT false,credit_charged_at timestamptz,reason_code text,reason_text text,updated_at timestamptz,UNIQUE(training_session_id,player_id));
  `);
  for (const migration of ["20261020130000_attendance_membership_history", "20261020133000_membership_sessions_without_time", "20261020140000_membership_check_in_compatibility", "20261020160000_membership_preserve_opt_outs", "20261021170000_attendance_roster_lock"]) {
    await db.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
  }
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  failAfterMembershipWrite = false;
  await db.exec("TRUNCATE attendance_memberships,training_session_players,club_custom_training_group_players,training_sessions,training_opt_outs,players,clubs CASCADE");
  await db.query("INSERT INTO clubs VALUES ($1,'calendar_month')", [clubId]);
  for (const id of [playerId, otherPlayerId]) await db.query("INSERT INTO players(id,club_id,full_name,is_active) VALUES ($1,$2,'Player',true)", [id, clubId]);
  await db.query(`INSERT INTO training_sessions(club_id,scope_key,status,training_date,training_time,removed_from_schedule)
    VALUES ($1,$2,'scheduled',(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date,'00:00',false),
      ($1,$2,'scheduled',(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date+1,'17:00',false),
      ($1,$2,'cancelled',(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date+2,'17:00',false),
      ($1,$2,'cancelled',(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date+3,'17:00',true)`, [clubId,scopeKey]);
  const dates = await db.query<{ date: string }>("SELECT training_date::text AS date FROM training_sessions ORDER BY training_date");
  storedGroup = groupData(dates.rows.map((row) => row.date));
  mocks.clubCustomTrainingGroup.findFirst.mockImplementation(async () => ({ ...storedGroup,
    players: (await db.query<{ playerId: string }>('SELECT player_id AS "playerId" FROM club_custom_training_group_players WHERE group_id=$1', [groupId])).rows,
  }));
  mocks.clubCustomTrainingGroup.findUniqueOrThrow.mockImplementation(async () => ({ ...storedGroup, players: [] }));
  mocks.clubCustomTrainingGroup.update.mockResolvedValue({});
  mocks.player.findMany.mockImplementation(async (args) => (await db.query("SELECT id FROM players WHERE club_id=$1 AND id=ANY($2::uuid[]) AND is_active", [args.where.clubId,args.where.id.in])).rows);
  mocks.$transaction.mockImplementation(async (callback) => db.transaction(async (tx) => callback({
    ...mocks,
    clubCustomTrainingGroupPlayer: {
      deleteMany: async (args: { where: { groupId: string; playerId: { notIn: string[] } } }) => tx.query("DELETE FROM club_custom_training_group_players WHERE group_id=$1 AND player_id<>ALL($2::uuid[])", [args.where.groupId,args.where.playerId.notIn]),
      createMany: async (args: { data: Array<{ groupId: string; playerId: string }> }) => {
        for (const row of args.data) await tx.query("INSERT INTO club_custom_training_group_players VALUES ($1,$2) ON CONFLICT DO NOTHING", [row.groupId,row.playerId]);
        if (failAfterMembershipWrite) throw new Error("Injected membership write failure");
      },
    },
  })));
});
async function edit(playerIds: string[], expectedStatus = 200) {
  const response = await PATCH(new NextRequest("http://localhost/group", { method: "PATCH", headers: { cookie: "admin_session=token" }, body: JSON.stringify({ playerIds }) }), { params: Promise.resolve({ id: clubId, groupId }) });
  expect(response.status).toBe(expectedStatus);
  expect(syncFutureTrainingSessions).not.toHaveBeenCalled();
}
it("keeps cancelled and removed sessions unchanged while enrolling into only scheduled future sessions", async () => {
  const before = (await db.query("SELECT * FROM training_sessions ORDER BY training_date")).rows;
  await edit([playerId]);
  expect((await db.query("SELECT * FROM training_sessions ORDER BY training_date")).rows).toEqual(before);
  expect((await db.query("SELECT s.status,s.removed_from_schedule FROM training_session_players r JOIN training_sessions s ON s.id=r.training_session_id")).rows).toEqual([{ status: "scheduled", removed_from_schedule: false }]);
});
it("keeps weekday-based sessions intact and updates their roster even without explicit dates", async () => {
  storedGroup.trainingDates = [];
  const before = (await db.query("SELECT * FROM training_sessions ORDER BY training_date")).rows;
  await edit([playerId]);
  expect((await db.query("SELECT * FROM training_sessions ORDER BY training_date")).rows).toEqual(before);
  expect((await db.query("SELECT * FROM training_session_players WHERE player_id=$1", [playerId])).rows).toHaveLength(1);
});
it("preserves earlier-today attendance when removing a member and removes only untouched future roster entries", async () => {
  await db.query("INSERT INTO club_custom_training_group_players VALUES ($1,$2)", [groupId,playerId]);
  await db.query(`INSERT INTO training_session_players(training_session_id,player_id,player_name,present)
    SELECT id,$1,'Player',true FROM training_sessions WHERE training_time='00:00'`, [playerId]);
  await edit([otherPlayerId]);
  expect((await db.query("SELECT s.training_time FROM training_session_players r JOIN training_sessions s ON s.id=r.training_session_id WHERE r.player_id=$1", [playerId])).rows).toEqual([{ training_time: "00:00" }]);
});
it.each(["calendar_month", "rolling_30_days", "training_credits", "training_credits_30_days"])("retains enrollment defaults and existing opt-outs for %s", async (workflow) => {
  await db.query("UPDATE clubs SET payment_workflow=$1", [workflow]);
  await db.query("INSERT INTO training_opt_outs SELECT $1,training_date,'sick','Existing absence' FROM training_sessions WHERE status='scheduled' AND training_time='17:00'", [playerId]);
  await edit([playerId,otherPlayerId]);
  expect((await db.query("SELECT present,reason_code,reason_text FROM training_session_players WHERE player_id=$1", [playerId])).rows).toEqual([{ present: false, reason_code: "sick", reason_text: "Existing absence" }]);
  expect((await db.query("SELECT present FROM training_session_players WHERE player_id=$1", [otherPlayerId])).rows).toEqual([{ present: !workflow.startsWith("training_credits") }]);
});
it.each([
  { recorded: true, charged: null, reasonCode: null, reasonText: null },
  { recorded: false, charged: "2026-10-01T09:00:00Z", reasonCode: null, reasonText: null },
  { recorded: false, charged: null, reasonCode: "sick", reasonText: null },
  { recorded: false, charged: null, reasonCode: null, reasonText: "Parent notified coach" },
])("keeps protected future attendance when a member leaves: %j", async ({ recorded, charged, reasonCode, reasonText }) => {
  await db.query("INSERT INTO club_custom_training_group_players VALUES ($1,$2)", [groupId,playerId]);
  await db.query("UPDATE training_session_players SET attendance_recorded=$1,credit_charged_at=$2,reason_code=$3,reason_text=$4 WHERE player_id=$5", [recorded,charged,reasonCode,reasonText,playerId]);
  const before = (await db.query("SELECT * FROM training_session_players WHERE player_id=$1", [playerId])).rows;
  expect(before).toHaveLength(1);
  await edit([otherPlayerId]);
  expect((await db.query("SELECT * FROM training_session_players WHERE player_id=$1", [playerId])).rows).toEqual(before);
});
it("does not reopen membership periods or reset attendance on an unchanged membership save", async () => {
  await edit([playerId]);
  const memberships = (await db.query("SELECT * FROM attendance_memberships")).rows;
  const roster = (await db.query("SELECT * FROM training_session_players")).rows;
  await edit([playerId]);
  expect((await db.query("SELECT * FROM attendance_memberships")).rows).toEqual(memberships);
  expect((await db.query("SELECT * FROM training_session_players")).rows).toEqual(roster);
});
it("rolls back membership, roster, and membership-history writes together on failure", async () => {
  await edit([playerId]);
  const members = (await db.query("SELECT * FROM club_custom_training_group_players")).rows;
  const memberships = (await db.query("SELECT * FROM attendance_memberships")).rows;
  const roster = (await db.query("SELECT * FROM training_session_players")).rows;
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    failAfterMembershipWrite = true;
    await edit([otherPlayerId], 500);
  } finally { errorLog.mockRestore(); }
  expect((await db.query("SELECT * FROM club_custom_training_group_players")).rows).toEqual(members);
  expect((await db.query("SELECT * FROM attendance_memberships")).rows).toEqual(memberships);
  expect((await db.query("SELECT * FROM training_session_players")).rows).toEqual(roster);
});
it("enrolls a member into a future session with no start time without changing the session", async () => {
  await db.exec("UPDATE training_sessions SET training_time=NULL WHERE status='scheduled' AND training_time='17:00'");
  await edit([playerId]);
  expect((await db.query("SELECT s.training_time FROM training_session_players r JOIN training_sessions s ON s.id=r.training_session_id")).rows).toEqual([{ training_time: null }]);
});
it("respects a member's future attendance-start date", async () => {
  await db.query("UPDATE players SET attendance_started_at=clock_timestamp()+interval '10 days' WHERE id=$1", [playerId]);
  await edit([playerId]);
  expect((await db.query("SELECT * FROM training_session_players WHERE player_id=$1", [playerId])).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM club_custom_training_group_players WHERE player_id=$1", [playerId])).rows).toHaveLength(1);
});
it("preserves another group's enrollment and attendance when removing a member from this group", async () => {
  const otherGroupId = "00000000-0000-4000-8000-000000000005";
  await db.query("INSERT INTO training_sessions(club_id,scope_key,status,training_date,training_time) VALUES ($1,$2,'scheduled',CURRENT_DATE+2,'17:00')", [clubId,`custom_group:${otherGroupId}`]);
  await db.query("INSERT INTO club_custom_training_group_players VALUES ($1,$2),($3,$2)", [groupId,playerId,otherGroupId]);
  const before = (await db.query("SELECT r.* FROM training_session_players r JOIN training_sessions s ON s.id=r.training_session_id WHERE s.scope_key=$1", [`custom_group:${otherGroupId}`])).rows;
  expect(before).toHaveLength(1);
  await edit([otherPlayerId]);
  expect((await db.query("SELECT r.* FROM training_session_players r JOIN training_sessions s ON s.id=r.training_session_id WHERE s.scope_key=$1", [`custom_group:${otherGroupId}`])).rows).toEqual(before);
  expect((await db.query("SELECT group_id FROM club_custom_training_group_players WHERE player_id=$1", [playerId])).rows).toEqual([{ group_id: otherGroupId }]);
});
it("retains a protected absence through leaving and rejoining the group", async () => {
  await edit([playerId]);
  await db.query("UPDATE training_session_players SET present=false,reason_code='sick',reason_text='Parent notified coach' WHERE player_id=$1", [playerId]);
  const before = (await db.query("SELECT * FROM training_session_players WHERE player_id=$1", [playerId])).rows;
  await edit([otherPlayerId]);
  await edit([playerId,otherPlayerId]);
  expect((await db.query("SELECT * FROM training_session_players WHERE player_id=$1", [playerId])).rows).toEqual(before);
  expect((await db.query("SELECT * FROM attendance_memberships WHERE player_id=$1 AND left_at IS NULL", [playerId])).rows).toHaveLength(1);
});
it("keeps past attendance locked across time corrections, member removal, and rejoining", async () => {
  await db.query("INSERT INTO club_custom_training_group_players VALUES ($1,$2)", [groupId,playerId]);
  const morning = (await db.query<{ id: string }>("SELECT id FROM training_sessions WHERE training_time='00:00'")).rows[0];
  await db.query("INSERT INTO training_session_players(training_session_id,player_id,player_name,present) VALUES ($1,$2,'Player',true)", [morning.id,playerId]);
  await db.query("UPDATE training_sessions SET training_date=training_date+1,training_time='19:00' WHERE id=$1", [morning.id]);
  const lock = (await db.query<{ roster_locked_at: Date | null }>("SELECT roster_locked_at FROM training_sessions WHERE id=$1", [morning.id])).rows;
  expect(lock[0].roster_locked_at).not.toBeNull();
  await db.query("UPDATE training_sessions SET training_time='20:00',roster_locked_at=NULL WHERE id=$1", [morning.id]);
  expect((await db.query("SELECT roster_locked_at FROM training_sessions WHERE id=$1", [morning.id])).rows).toEqual(lock);
  const roster = (await db.query("SELECT * FROM training_session_players WHERE training_session_id=$1", [morning.id])).rows;
  await edit([otherPlayerId]);
  await edit([playerId,otherPlayerId]);
  expect((await db.query("SELECT * FROM training_session_players WHERE training_session_id=$1", [morning.id])).rows).toEqual(roster);
});
it("keeps ordinary future time edits unlocked and their memberships editable", async () => {
  const future = (await db.query<{ id: string }>("SELECT id FROM training_sessions WHERE status='scheduled' AND training_time='17:00'")).rows[0];
  await db.query("UPDATE training_sessions SET training_time='18:00' WHERE id=$1", [future.id]);
  expect((await db.query("SELECT roster_locked_at FROM training_sessions WHERE id=$1", [future.id])).rows).toEqual([{ roster_locked_at: null }]);
  await edit([playerId]);
  await edit([otherPlayerId]);
  expect((await db.query("SELECT player_id FROM training_session_players WHERE training_session_id=$1", [future.id])).rows).toEqual([{ player_id: otherPlayerId }]);
});
