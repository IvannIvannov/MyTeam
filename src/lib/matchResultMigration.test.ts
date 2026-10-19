import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

it("keeps existing results unset and enforces paired, non-negative integer scores", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE club_matches (id INTEGER PRIMARY KEY); INSERT INTO club_matches VALUES (1);");
    await db.exec(await readFile(new URL("../../prisma/migrations/20261019090000_match_results/migration.sql", import.meta.url), "utf8"));
    expect((await db.query("SELECT home_score, away_score FROM club_matches")).rows).toEqual([{ home_score: null, away_score: null }]);
    for (const sql of ["UPDATE club_matches SET home_score = 1", "UPDATE club_matches SET home_score = -1, away_score = 0", "UPDATE club_matches SET home_score = 1000, away_score = 0"]) await expect(db.exec(sql)).rejects.toThrow();
    await db.exec("UPDATE club_matches SET home_score = 0, away_score = 0;");
    expect((await db.query("SELECT home_score, away_score FROM club_matches")).rows).toEqual([{ home_score: 0, away_score: 0 }]);
  } finally { await db.close(); }
}, 30000);
