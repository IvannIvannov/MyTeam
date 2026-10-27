import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("adds and backfills age after the optional-fields migration", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE clubs (id integer PRIMARY KEY, training_group_mode text NOT NULL DEFAULT 'team_group');
      CREATE TABLE players (id integer PRIMARY KEY, birth_date date, jersey_number text, team_group integer);
      INSERT INTO players VALUES (1, CURRENT_DATE - INTERVAL '12 years', '7', 2014), (2, NULL, NULL, NULL), (3, CURRENT_DATE + INTERVAL '1 year', NULL, NULL);`);
    await db.exec(readFileSync("prisma/migrations/20261027120000_optional_player_fields/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261027140000_player_age/migration.sql", "utf8"));
    expect((await db.query("SELECT age, jersey_number FROM players ORDER BY id")).rows).toEqual([
      { age: 12, jersey_number: "7" }, { age: null, jersey_number: null }, { age: null, jersey_number: null },
    ]);
    await expect(db.exec("UPDATE players SET age = -1 WHERE id = 1")).rejects.toThrow();
    await db.exec("UPDATE players SET age = 20 WHERE id = 1");
    expect((await db.query("SELECT age FROM players WHERE id = 1")).rows).toEqual([{ age: 20 }]);
  } finally { await db.close(); }
}, 30000);
