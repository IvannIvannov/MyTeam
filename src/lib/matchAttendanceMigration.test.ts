import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

it("keeps existing games disabled and preserves attendance through rescheduling with cascading deletion", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE club_matches (id UUID PRIMARY KEY, match_date TEXT); CREATE TABLE players (id UUID PRIMARY KEY);
      INSERT INTO club_matches VALUES ('10000000-0000-4000-8000-000000000001', '2026-10-17');
      INSERT INTO players VALUES ('10000000-0000-4000-8000-000000000002');`);
    await db.exec(await readFile(new URL("../../prisma/migrations/20261017120000_game_attendance/migration.sql", import.meta.url), "utf8"));
    expect((await db.query<{ attendance_enabled: boolean }>("SELECT attendance_enabled FROM club_matches")).rows[0].attendance_enabled).toBe(false);
    await db.exec(`UPDATE club_matches SET attendance_enabled = true;
      INSERT INTO club_match_players (match_id, player_id) VALUES ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');`);
    expect((await db.query<{ present: boolean }>("SELECT present FROM club_match_players")).rows[0].present).toBe(true);
    await db.exec("UPDATE club_match_players SET present = false, reason_code = 'sick'; UPDATE club_matches SET match_date = '2026-10-20';");
    expect((await db.query("SELECT present, reason_code FROM club_match_players")).rows).toEqual([{ present: false, reason_code: "sick" }]);
    await db.exec("DELETE FROM club_matches;");
    expect((await db.query("SELECT * FROM club_match_players")).rows).toEqual([]);
  } finally { await db.close(); }
}, 30000);
