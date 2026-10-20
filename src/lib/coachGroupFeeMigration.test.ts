import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("clears only matching defaults per club, preserves personal fees and checkout/history amounts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE clubs (id UUID PRIMARY KEY, default_payment_amount DECIMAL(10,2));
      CREATE TABLE coach_groups (id UUID PRIMARY KEY);
      CREATE TABLE players (id UUID PRIMARY KEY, club_id UUID, payment_amount DECIMAL(10,2) NOT NULL);
      CREATE TABLE iris_payments (amount DECIMAL(10,2));
      INSERT INTO clubs VALUES ('00000000-0000-0000-0000-000000000001',85), ('00000000-0000-0000-0000-000000000002',60);
      INSERT INTO players VALUES
        ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',85),
        ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001',60),
        ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002',60);
      INSERT INTO iris_payments VALUES (170);
    `);
    await db.exec(readFileSync("prisma/migrations/20261016160000_coach_group_fees/migration.sql", "utf8"));
    expect((await db.query("SELECT payment_amount::text AS amount FROM players ORDER BY id")).rows).toEqual([{ amount: "0.00" }, { amount: "60.00" }, { amount: "0.00" }]);
    expect((await db.query("SELECT * FROM player_fee_migration_backup")).rows).toHaveLength(2);
    expect((await db.query("SELECT amount::text FROM iris_payments")).rows).toEqual([{ amount: "170.00" }]);
  } finally { await db.close(); }
}, 30000);
