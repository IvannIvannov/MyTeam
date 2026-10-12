import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
await db.exec(`
CREATE TABLE clubs (id uuid PRIMARY KEY);
CREATE TABLE players (id uuid PRIMARY KEY, club_id uuid, full_name text, team_group integer, is_active boolean);
CREATE TABLE coach_groups (id uuid PRIMARY KEY, club_id uuid, training_dates text[] DEFAULT '{}', training_weekdays integer[] DEFAULT '{}', training_date_times jsonb, training_time text, training_duration_minutes integer DEFAULT 60, training_field_id uuid, training_field_piece_ids uuid[] DEFAULT '{}', training_field_selections jsonb);
CREATE TABLE "_PlayerCoachGroups" ("A" uuid, "B" uuid);
CREATE TABLE training_opt_outs (id uuid PRIMARY KEY, player_id uuid, training_date date, reason_code text, reason_text text);
CREATE TABLE training_notes (club_id uuid, training_date date, scope_key text, note text);
INSERT INTO clubs VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO players VALUES ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Player',2015,true);
INSERT INTO coach_groups (id,club_id,training_dates,training_time) VALUES ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',ARRAY['2026-10-12','2026-10-13'],'09:00');
INSERT INTO "_PlayerCoachGroups" VALUES ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002');
INSERT INTO training_opt_outs VALUES ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','2026-10-12','sick',NULL);
INSERT INTO training_notes VALUES ('10000000-0000-4000-8000-000000000001','2026-10-12','coach_group:10000000-0000-4000-8000-000000000003','Original note');
`);
for (const migration of ["20260504100000_add_training_sessions", "20260504103000_add_training_session_players"]) {
  await db.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
}
await db.exec(`INSERT INTO training_sessions (id,club_id,scope_type,scope_key,scope_id,training_date,training_time,updated_at) VALUES ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','coachGroup','coach_group:10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','2026-10-12','09:00',NOW());
INSERT INTO training_session_players(training_session_id,player_id,player_name,present,reason_code,updated_at) VALUES ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','Player',false,'sick',NOW());`);
await db.exec(readFileSync("prisma/migrations/20261012140000_multiple_coach_trainings/migration.sql", "utf8"));
const original = (await db.query(`SELECT s.id,s.note,s.occurrence_key,p.present,p.reason_code,p.attendance_recorded FROM training_sessions s JOIN training_session_players p ON p.training_session_id=s.id WHERE s.id='10000000-0000-4000-8000-000000000005'`)).rows[0];
assert.equal(original.note, "Original note");
assert.equal(original.occurrence_key, original.id);
assert.equal(original.present, false);
assert.equal(original.reason_code, "sick");
assert.equal(original.attendance_recorded, true);
assert.equal((await db.query("SELECT count(*)::integer AS n FROM training_sessions")).rows[0].n, 2);
await db.exec(`INSERT INTO training_sessions(id,club_id,scope_type,scope_key,scope_id,training_date,training_time,occurrence_key,updated_at) VALUES ('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','coachGroup','coach_group:10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','2026-10-12','18:00','10000000-0000-4000-8000-000000000006',NOW());
INSERT INTO training_session_players(training_session_id,player_id,player_name,updated_at) VALUES ('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','Player',NOW());`);
const sessions = (await db.query("SELECT s.training_time,p.present FROM training_sessions s JOIN training_session_players p ON p.training_session_id=s.id WHERE s.training_date='2026-10-12' ORDER BY s.training_time")).rows;
assert.deepEqual(sessions, [{ training_time: "09:00", present: false }, { training_time: "18:00", present: true }]);
await db.exec("UPDATE training_sessions SET status='cancelled' WHERE id='10000000-0000-4000-8000-000000000005'");
assert.equal((await db.query("SELECT count(*)::integer AS n FROM training_sessions WHERE training_date='2026-10-12' AND status='scheduled'")).rows[0].n, 1);
await db.close();
console.log("PostgreSQL migration verified: legacy identity, notes and absences preserved; missing sessions backfilled; same-day sessions and cancellation independent.");
