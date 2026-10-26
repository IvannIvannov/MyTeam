import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
it("enforces one Page per club, complete connection data, and club cleanup", async () => {
  const db = new PGlite();
  const club = "10000000-0000-4000-8000-000000000001";
  try {
    await db.exec('CREATE TABLE clubs (id UUID PRIMARY KEY)');
    await db.query('INSERT INTO clubs VALUES ($1)', [club]);
    await db.exec(await readFile(new URL("../../../prisma/migrations/20261025180000_facebook_page_connections/migration.sql", import.meta.url), "utf8"));
    await db.query('INSERT INTO facebook_page_connections (club_id, page_id, page_name, encrypted_token, connected_by, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())', [club, "123", "Club", "encrypted", "coach"]);
    await expect(db.query('INSERT INTO facebook_page_connections (club_id, connected_by, updated_at) VALUES ($1, $2, NOW())', [club, "other"])).rejects.toThrow(/duplicate key/);
    await expect(db.exec("UPDATE facebook_page_connections SET encrypted_token = NULL")).rejects.toThrow(/check constraint/);
    await db.exec("UPDATE facebook_page_connections SET page_id = NULL, page_name = NULL, encrypted_token = NULL");
    await db.query('INSERT INTO facebook_connect_attempts (id, club_id, session_hash, expires_at) VALUES ($1, $2, $3, NOW())', ["state", club, "session"]);
    await expect(db.exec("UPDATE facebook_connect_attempts SET status = 'invalid'")).rejects.toThrow(/check constraint/);
    await db.query('DELETE FROM clubs WHERE id = $1', [club]);
    expect((await db.query('SELECT * FROM facebook_page_connections')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM facebook_connect_attempts')).rows).toEqual([]);
  } finally { await db.close(); }
}, 30000);
