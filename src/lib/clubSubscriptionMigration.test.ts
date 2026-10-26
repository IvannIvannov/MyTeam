import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("backfills only activated clubs, preserves player dues, and enforces live month uniqueness after voiding", async () => {
  const db = new PGlite();
  const active = "00000000-0000-0000-0000-000000000001";
  const demo = "00000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`CREATE TABLE clubs (id UUID PRIMARY KEY, billing_status TEXT, default_payment_amount DECIMAL(10,2));
      CREATE TABLE players (id UUID PRIMARY KEY, club_id UUID, payment_amount DECIMAL(10,2));
      INSERT INTO clubs VALUES ('${active}', 'active', 85), ('${demo}', 'demo', 60);
      INSERT INTO players VALUES ('${active}', '${active}', 70);`);
    await db.exec(readFileSync("prisma/migrations/20261024120000_club_subscriptions/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261024160000_club_subscription_reminders/migration.sql", "utf8"));
    await db.exec(readFileSync("prisma/migrations/20261024180000_club_subscription_contract/migration.sql", "utf8"));
    await db.exec(`INSERT INTO club_subscription_reminders (club_id, key) VALUES ('${active}', 'trial:2026-10-31:7')`);
    await expect(db.exec(`INSERT INTO club_subscription_reminders (club_id, key) VALUES ('${active}', 'trial:2026-10-31:7')`)).rejects.toThrow(/duplicate key/);
    await expect(db.exec(`INSERT INTO club_subscription_reminders (club_id, key) VALUES ('${demo}', 'trial:2026-10-31:7')`)).rejects.toThrow(/foreign key/);
    expect((await db.query("SELECT club_id, mode, trial_end_date, first_billing_month FROM club_subscriptions")).rows).toEqual([{ club_id: active, mode: "trial", trial_end_date: null, first_billing_month: null }]);
    expect((await db.query("SELECT payment_amount::text AS amount FROM players")).rows).toEqual([{ amount: "70.00" }]);
    expect((await db.query("SELECT default_payment_amount::text AS amount FROM clubs ORDER BY id")).rows).toEqual([{ amount: "85.00" }, { amount: "60.00" }]);
    expect((await db.query("SELECT action, actor_id FROM club_subscription_changes")).rows).toEqual([{ action: "initial_trial", actor_id: "migration" }]);
    await db.exec(`UPDATE club_subscriptions SET mode='paid', first_billing_month='2026-10';
      INSERT INTO club_subscription_payments (id, club_id, paid_on, total, created_by) VALUES ('${active}', '${active}', '2026-10-24', 20, 'admin');
      INSERT INTO club_subscription_payment_months (id, club_id, payment_id, month, amount) VALUES ('${active}', '${active}', '${active}', '2026-10', 20);`);
    await expect(db.exec(`INSERT INTO club_subscription_payment_months (id, club_id, payment_id, month, amount) VALUES ('${demo}', '${active}', '${active}', '2026-10', 20)`)).rejects.toThrow(/duplicate key/);
    await db.exec(`UPDATE club_subscription_payment_months SET voided_at=now();
      INSERT INTO club_subscription_payment_months (id, club_id, payment_id, month, amount) VALUES ('${demo}', '${active}', '${active}', '2026-10', 25)`);
    expect((await db.query("SELECT amount::text AS amount FROM club_subscription_payment_months WHERE voided_at IS NULL")).rows).toEqual([{ amount: "25.00" }]);
    await expect(db.exec(`INSERT INTO club_subscription_fees (id, club_id, effective_month, amount) VALUES (gen_random_uuid(), '${active}', '2026-10', 0)`)).rejects.toThrow(/check constraint/);
    await expect(db.exec("UPDATE club_subscriptions SET mode='trial'")).rejects.toThrow(/check constraint/);
    await db.exec("UPDATE club_subscriptions SET mode='contract', first_billing_month=NULL, trial_end_date=NULL");
    expect((await db.query("SELECT mode FROM club_subscriptions")).rows).toEqual([{ mode: "contract" }]);
    await expect(db.exec("UPDATE club_subscriptions SET first_billing_month='2026-10'")).rejects.toThrow(/check constraint/);
    expect((await db.query("SELECT COUNT(*)::int AS count FROM club_subscription_payments")).rows).toEqual([{ count: 1 }]);
  } finally { await db.close(); }
}, 30000);
