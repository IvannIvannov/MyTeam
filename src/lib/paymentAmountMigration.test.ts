import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("recovers only explicitly linked confirmed online amounts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE payment_logs (id TEXT PRIMARY KEY, player_id TEXT, paid_for TIMESTAMPTZ, recorded_by TEXT);
      CREATE TABLE iris_payments (id TEXT PRIMARY KEY, player_id TEXT, paid_for TIMESTAMPTZ, paid_through TIMESTAMPTZ,
        amount DECIMAL(10,2), currency TEXT, status TEXT, payment_log_id TEXT);
      INSERT INTO payment_logs VALUES
        ('manual', 'player', '2026-01-01Z', 'admin'),
        ('online1', 'player', '2026-02-01Z', 'irispay'),
        ('online2', 'player', '2026-03-01Z', 'irispay'),
        ('pending', 'player', '2026-04-01Z', 'irispay');
      INSERT INTO iris_payments VALUES
        ('paid', 'player', '2026-02-01Z', '2026-03-01Z', 51.00, 'EUR', 'CONFIRMED', 'online1'),
        ('waiting', 'player', '2026-04-01Z', NULL, 30.00, 'EUR', 'WAITING', 'pending');
    `);
    await db.exec(readFileSync("prisma/migrations/20261013160000_store_payment_amounts/migration.sql", "utf8"));
    const result = await db.query<{ id: string; amount: string | null; currency: string }>("SELECT id, amount::TEXT, currency FROM payment_logs ORDER BY id");
    expect(result.rows).toEqual([
      { id: "manual", amount: null, currency: "EUR" },
      { id: "online1", amount: "25.50", currency: "EUR" },
      { id: "online2", amount: null, currency: "EUR" },
      { id: "pending", amount: null, currency: "EUR" },
    ]);
  } finally {
    await db.close();
  }
}, 30000);

it("uses the replacement transaction's explicit link and leaves unowned overlapping logs unknown", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE payment_logs (id TEXT PRIMARY KEY, player_id TEXT, paid_for TIMESTAMPTZ, recorded_by TEXT);
      CREATE TABLE iris_payments (id TEXT PRIMARY KEY, player_id TEXT, paid_for TIMESTAMPTZ, paid_through TIMESTAMPTZ,
        amount DECIMAL(10,2), currency TEXT, status TEXT, payment_log_id TEXT);
      INSERT INTO payment_logs VALUES
        ('february', 'player', '2026-02-01Z', 'irispay'),
        ('replacement', 'player', '2026-03-01Z', 'irispay'),
        ('unowned', 'player', '2026-03-01Z', 'irispay');
      INSERT INTO iris_payments VALUES
        ('original', 'player', '2026-02-01Z', '2026-03-01Z', 50.00, 'EUR', 'CONFIRMED', 'february'),
        ('replacement-payment', 'player', '2026-03-01Z', NULL, 35.00, 'USD', 'CONFIRMED', 'replacement');
    `);
    await db.exec(readFileSync("prisma/migrations/20261013160000_store_payment_amounts/migration.sql", "utf8"));
    const result = await db.query<{ id: string; amount: string | null; currency: string }>("SELECT id, amount::TEXT, currency FROM payment_logs ORDER BY id");
    expect(result.rows).toEqual([
      { id: "february", amount: "25.00", currency: "EUR" },
      { id: "replacement", amount: "35.00", currency: "USD" },
      { id: "unowned", amount: null, currency: "EUR" },
    ]);
  } finally {
    await db.close();
  }
}, 30000);
