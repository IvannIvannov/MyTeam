import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("preserves existing attendance and defaults only newly created rows to absent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE training_session_players (id TEXT PRIMARY KEY, present BOOLEAN NOT NULL DEFAULT true,
        player_id TEXT, training_session_id TEXT, attendance_recorded BOOLEAN DEFAULT false,
        reason_code TEXT, reason_text TEXT, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE training_sessions (id TEXT PRIMARY KEY, club_id TEXT, training_date DATE);
      CREATE TABLE clubs (id TEXT PRIMARY KEY, payment_workflow TEXT);
      CREATE TABLE training_opt_outs (id TEXT PRIMARY KEY, player_id TEXT, training_date DATE, reason_code TEXT, reason_text TEXT, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ);
      INSERT INTO _prisma_migrations VALUES ('20261019120000_training_attendance_opt_in', now() - interval '1 hour', NULL);
      INSERT INTO training_session_players (id) VALUES ('existing');
    `);
    await db.exec(readFileSync("prisma/migrations/20261019120000_training_attendance_opt_in/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261019130000_training_check_in_charge/migration.sql", "utf8"));
    await db.exec("INSERT INTO training_session_players (id) VALUES ('new');");
    expect((await db.query("SELECT id, present, credit_charged_at FROM training_session_players ORDER BY id")).rows).toEqual([
      { id: "existing", present: true, credit_charged_at: null }, { id: "new", present: false, credit_charged_at: null },
    ]);
    await db.exec(`
      INSERT INTO clubs VALUES ('calendar', 'calendar_month'), ('credits', 'training_credits'), ('rolling', 'rolling_30_days');
      INSERT INTO training_sessions VALUES ('calendar-session','calendar','2026-10-19'), ('credits-session','credits','2026-10-19'), ('rolling-session','rolling','2026-10-19');
      INSERT INTO training_session_players (id, player_id, training_session_id, present, attendance_recorded, reason_code) VALUES
        ('affected','p1','calendar-session',false,false,NULL),
        ('recorded','p2','calendar-session',false,true,NULL),
        ('reason','p3','calendar-session',false,false,'sick'),
        ('credit-default','p4','credits-session',false,false,NULL),
        ('rolling-default','p5','rolling-session',false,false,NULL);
      INSERT INTO training_opt_outs (id, player_id, training_date) VALUES ('seeded','p1','2026-10-19');
    `);
    await db.exec(readFileSync("prisma/migrations/20261019140000_scope_training_attendance_defaults/migration.sql", "utf8"));
    expect((await db.query("SELECT id, present FROM training_session_players WHERE training_session_id IS NOT NULL ORDER BY id")).rows).toEqual([
      { id: 'affected', present: true }, { id: 'credit-default', present: false }, { id: 'reason', present: false }, { id: 'recorded', present: false }, { id: 'rolling-default', present: true },
    ]);
    expect((await db.query("SELECT * FROM training_opt_outs")).rows).toEqual([]);
    await db.exec("INSERT INTO training_session_players (id) VALUES ('restored-default');");
    expect((await db.query("SELECT present FROM training_session_players WHERE id = 'restored-default'")).rows).toEqual([{ present: true }]);
    expect((await db.query("SELECT present FROM training_session_players WHERE id = 'new'")).rows).toEqual([{ present: false }]);
  } finally { await db.close(); }
}, 30000);
