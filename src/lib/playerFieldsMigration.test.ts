import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("preserves existing clubs and player data while giving new clubs empty fields and custom scheduling", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE clubs (id integer PRIMARY KEY, training_group_mode text NOT NULL DEFAULT 'team_group');
      CREATE TABLE players (id integer PRIMARY KEY, jersey_number text, team_group integer);
      INSERT INTO clubs VALUES (1, 'team_group'), (2, 'custom_group');
      INSERT INTO players VALUES (1, '7', 2014);
    `);
    await db.exec(readFileSync("prisma/migrations/20261027120000_optional_player_fields/migration.sql", "utf8"));
    expect((await db.query("SELECT * FROM clubs ORDER BY id")).rows).toEqual([
      { id: 1, training_group_mode: "team_group", player_fields: ["jerseyNumber", "teamGroup"] },
      { id: 2, training_group_mode: "custom_group", player_fields: ["jerseyNumber", "teamGroup"] },
    ]);
    await db.exec("INSERT INTO clubs (id) VALUES (3)");
    expect((await db.query("SELECT * FROM clubs WHERE id = 3")).rows).toEqual([{ id: 3, training_group_mode: "custom_group", player_fields: [] }]);
    expect((await db.query("SELECT * FROM players")).rows).toEqual([{ id: 1, jersey_number: "7", team_group: 2014, rank: null, weight: null }]);
    await db.exec("UPDATE players SET rank = '1 дан', weight = 72.5");
    for (const value of ["0", "-1", "'Infinity'", "'NaN'"]) {
      await expect(db.exec(`UPDATE players SET weight = ${value}::float8`)).rejects.toThrow();
    }
    expect((await db.query("SELECT weight FROM players")).rows).toEqual([{ weight: 72.5 }]);
  } finally { await db.close(); }
}, 30000);
