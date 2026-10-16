-- Preserve the previous amount for audit and rollback; only matching defaults are cleared.
CREATE TABLE "player_fee_migration_backup" AS
SELECT p.id AS player_id, p.payment_amount AS previous_amount, c.default_payment_amount AS club_amount
FROM players p JOIN clubs c ON c.id = p.club_id
WHERE p.payment_amount = c.default_payment_amount;
UPDATE players p SET payment_amount = 0 FROM clubs c
WHERE p.club_id = c.id AND p.payment_amount = c.default_payment_amount;
ALTER TABLE coach_groups ADD COLUMN payment_amount DECIMAL(10,2);
ALTER TABLE coach_groups ADD CONSTRAINT coach_groups_payment_amount_nonnegative CHECK (payment_amount >= 0);
ALTER TABLE players ADD COLUMN billing_coach_group_id UUID REFERENCES coach_groups(id) ON DELETE SET NULL;
CREATE INDEX players_billing_coach_group_id_idx ON players(billing_coach_group_id);
ALTER TABLE iris_payments ADD COLUMN quoted_paid_dates JSONB;
