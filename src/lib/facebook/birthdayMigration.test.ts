import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
it("persists unique yearly publishing claims and rejects invalid states", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../../../prisma/migrations/20261025160000_facebook_birthday_posts/migration.sql", import.meta.url), "utf8"));
    const insert = (id: number, year: number) => db.query(`INSERT INTO facebook_birthday_posts (id, club_id, player_id, birthday_year, message, photo_url, page_id, created_by, updated_at) VALUES ($1, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', $2, 'greeting', 'https://example.com/photo.jpg', '123', 'coach', NOW())`, [`10000000-0000-4000-8000-${String(id).padStart(12, "0")}`, year]);
    await insert(3, 2026);
    await expect(insert(4, 2026)).rejects.toThrow(/duplicate key/);
    await insert(5, 2027);
    expect((await db.query("SELECT status FROM facebook_birthday_posts")).rows).toEqual([{ status: "publishing" }, { status: "publishing" }]);
    await expect(db.exec("UPDATE facebook_birthday_posts SET status = 'bogus'")).rejects.toThrow(/check constraint/);
  } finally { await db.close(); }
}, 30000);
