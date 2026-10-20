import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("tracks join/leave/rejoin, preserves legacy uncertainty and recorded attendance, and updates future rosters atomically", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE clubs(id uuid PRIMARY KEY, payment_workflow text);
      INSERT INTO clubs VALUES ('00000000-0000-4000-8000-000000000002','calendar');
      CREATE TABLE players(id uuid PRIMARY KEY, club_id uuid, full_name text, team_group integer, is_active boolean, created_at timestamptz DEFAULT now());
      CREATE TABLE training_opt_outs(player_id uuid, training_date date, reason_code text, reason_text text, UNIQUE(player_id, training_date));
      CREATE TABLE "_PlayerCoachGroups"("A" uuid, "B" uuid, UNIQUE("A","B"));
      CREATE TABLE club_custom_training_group_players(group_id uuid, player_id uuid, PRIMARY KEY(group_id,player_id));
      CREATE TABLE training_sessions(id uuid PRIMARY KEY, club_id uuid, scope_key text, status text, training_date date, training_time text, removed_from_schedule boolean DEFAULT false);
      CREATE TABLE training_session_players(id uuid PRIMARY KEY, training_session_id uuid, player_id uuid, player_name text, team_group integer, present boolean DEFAULT true, attendance_recorded boolean DEFAULT false, credit_charged_at timestamptz, reason_code text, reason_text text, updated_at timestamptz, UNIQUE(training_session_id,player_id));
      INSERT INTO players(id,club_id,full_name,is_active) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Player',true);
      INSERT INTO "_PlayerCoachGroups" VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001');
      INSERT INTO training_sessions(id,club_id,scope_key,status,training_date,training_time) VALUES
        ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','custom_group:00000000-0000-4000-8000-000000000005','scheduled',CURRENT_DATE+2,'17:00'),
        ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','custom_group:00000000-0000-4000-8000-000000000005','scheduled',CURRENT_DATE-2,'17:00');
    `);
    await db.exec(readFileSync("prisma/migrations/20261020130000_attendance_membership_history/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261020133000_membership_sessions_without_time/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261020140000_membership_check_in_compatibility/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261020160000_membership_preserve_opt_outs/migration.sql", "utf8"));
    expect((await db.query("SELECT joined_at FROM attendance_memberships")).rows).toEqual([{ joined_at: null }]);
    const join = `INSERT INTO club_custom_training_group_players VALUES ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001')`;
    const leave = "DELETE FROM club_custom_training_group_players";
    await db.exec(join);
    expect((await db.query("SELECT training_session_id FROM training_session_players")).rows).toEqual([{ training_session_id: "00000000-0000-4000-8000-000000000004" }]);
    await db.exec(leave);
    await db.exec("UPDATE clubs SET payment_workflow='training_credits'");
    await db.exec(join);
    expect((await db.query("SELECT present FROM training_session_players")).rows).toEqual([{ present: false }]);
    await db.exec(leave);
    expect((await db.query("SELECT * FROM training_session_players")).rows).toHaveLength(0);
    await db.exec("UPDATE clubs SET payment_workflow='calendar'");
    await db.exec(join);
    await db.exec(leave);
    expect((await db.query("SELECT * FROM training_session_players")).rows).toHaveLength(0);
    await db.exec(join);
    await db.exec("UPDATE training_session_players SET present=false, attendance_recorded=true, reason_code='sick'");
    await db.exec(leave);
    expect((await db.query("SELECT present,reason_code FROM training_session_players")).rows).toEqual([{ present: false, reason_code: "sick" }]);
    await db.exec(join);
    expect((await db.query("SELECT * FROM attendance_memberships WHERE scope_key LIKE 'custom_group:%'")).rows).toHaveLength(5);
    expect((await db.query("SELECT * FROM attendance_memberships WHERE scope_key LIKE 'custom_group:%' AND left_at IS NULL")).rows).toHaveLength(1);
    expect((await db.query("SELECT present FROM training_session_players")).rows).toEqual([{ present: false }]);
    await db.exec(leave);
    await db.exec("UPDATE training_sessions SET training_time=NULL WHERE training_date > CURRENT_DATE");
    await db.exec("DELETE FROM training_session_players");
    await db.exec(join);
    expect((await db.query("SELECT training_session_id FROM training_session_players")).rows).toEqual([{ training_session_id: "00000000-0000-4000-8000-000000000004" }]);
    // A pre-existing absence must win over the default when enrollment seeds a row.
    await db.exec(leave);
    await db.exec(`INSERT INTO training_opt_outs VALUES ('00000000-0000-4000-8000-000000000001', CURRENT_DATE+2, 'sick', 'Existing absence')`);
    await db.exec(join);
    expect((await db.query("SELECT present, reason_code, reason_text FROM training_session_players")).rows).toEqual([{ present: false, reason_code: "sick", reason_text: "Existing absence" }]);
    // A null reason still represents an opt-out; credit defaults must also keep reasons.
    for (const workflow of ["calendar", "training_credits"]) {
      await db.query("UPDATE clubs SET payment_workflow=$1", [workflow]);
      await db.exec(leave);
      await db.exec("DELETE FROM training_session_players");
      await db.query("UPDATE training_opt_outs SET reason_code=$1, reason_text=$2", workflow === "calendar" ? [null, null] : ["sick", "Existing absence"]);
      await db.exec(join);
      expect((await db.query("SELECT present, reason_code FROM training_session_players")).rows).toEqual([{ present: false, reason_code: workflow === "calendar" ? null : "sick" }]);
    }
    // Coach sessions have independent attendance, so legacy day-wide opt-outs do not leak.
    await db.exec(`INSERT INTO training_sessions(id,club_id,scope_key,status,training_date,training_time) VALUES
      ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000002','coach_group:00000000-0000-4000-8000-000000000003','scheduled',CURRENT_DATE+2,'17:00')`);
    for (const workflow of ["calendar", "training_credits"]) {
      await db.query("UPDATE clubs SET payment_workflow=$1", [workflow]);
      await db.exec(`DELETE FROM "_PlayerCoachGroups";
        INSERT INTO "_PlayerCoachGroups" VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001')`);
      expect((await db.query("SELECT present, reason_code FROM training_session_players WHERE training_session_id='00000000-0000-4000-8000-000000000007'")).rows).toEqual([{ present: workflow === "calendar", reason_code: null }]);
    }
  } finally {
    await db.close();
  }
}, 30000);
