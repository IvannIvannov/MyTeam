ALTER TABLE "payment_logs" ADD COLUMN "amount" DECIMAL(10,2), ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR';

-- Online checkout charges the same unit amount for every covered month.
-- Recover only confirmed, exactly divisible transactions; manual history stays unknown.
-- Only the explicit payment_log_id proves ownership. Other covered logs may
-- have been deleted and replaced, so a matching player/date range is insufficient.
WITH confirmed AS (
  SELECT p.*,
    CASE WHEN p.paid_through IS NULL THEN 1 ELSE
      (EXTRACT(YEAR FROM p.paid_through AT TIME ZONE 'UTC') - EXTRACT(YEAR FROM p.paid_for AT TIME ZONE 'UTC')) * 12
      + EXTRACT(MONTH FROM p.paid_through AT TIME ZONE 'UTC') - EXTRACT(MONTH FROM p.paid_for AT TIME ZONE 'UTC') + 1
    END AS month_count
  FROM "iris_payments" p
  WHERE p.status = 'CONFIRMED' AND p.payment_log_id IS NOT NULL
)
UPDATE "payment_logs" l SET amount = p.amount / p.month_count, currency = p.currency
FROM confirmed p
WHERE l.amount IS NULL AND p.month_count > 0 AND MOD(p.amount * 100, p.month_count) = 0
  AND l.id = p.payment_log_id
  AND l.player_id = p.player_id AND l.recorded_by = 'irispay'
  AND l.paid_for = p.paid_for;
