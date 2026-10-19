import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

it("defaults existing events to match and restricts stored event types", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE club_matches (id INTEGER PRIMARY KEY); INSERT INTO club_matches VALUES (1);");
    await db.exec(await readFile(new URL("../../prisma/migrations/20261019130000_match_event_type/migration.sql", import.meta.url), "utf8"));
    expect((await db.query("SELECT event_type FROM club_matches")).rows).toEqual([{ event_type: "match" }]);
    for (const type of ["match", "duel", "competition", "participation"]) await db.query("UPDATE club_matches SET event_type = $1", [type]);
    await expect(db.exec("UPDATE club_matches SET event_type = 'unknown'")).rejects.toThrow();
    await expect(db.exec("UPDATE club_matches SET event_type = NULL")).rejects.toThrow();
  } finally { await db.close(); }
}, 30000);
