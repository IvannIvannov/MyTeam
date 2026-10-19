-- Payment-specific defaults are set explicitly by the training writers.
-- Keep the historical database fallback for calendar-month and rolling payments.
ALTER TABLE "training_session_players" ALTER COLUMN "present" SET DEFAULT true;

-- Correct only untouched defaults created while the global opt-in migration
-- was active. Keep explicit attendance decisions and all credit-based clubs.
WITH affected AS (
  SELECT a.id, a.player_id, s.training_date
  FROM training_session_players a
  JOIN training_sessions s ON s.id = a.training_session_id
  JOIN clubs c ON c.id = s.club_id
  WHERE c.payment_workflow IN ('calendar_month', 'rolling_30_days')
    AND a.present = false AND a.attendance_recorded = false
    AND a.reason_code IS NULL AND a.reason_text IS NULL
    AND a.credit_charged_at IS NULL
    AND a.created_at >= (
      SELECT finished_at FROM _prisma_migrations
      WHERE migration_name = '20261019120000_training_attendance_opt_in'
        AND rolled_back_at IS NULL
      ORDER BY finished_at DESC LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM training_opt_outs o
      WHERE o.player_id = a.player_id AND o.training_date = s.training_date
        AND (o.reason_code IS NOT NULL OR o.reason_text IS NOT NULL)
    )
), removed_defaults AS (
  DELETE FROM training_opt_outs o USING affected a
  WHERE o.player_id = a.player_id AND o.training_date = a.training_date
    AND o.reason_code IS NULL AND o.reason_text IS NULL
    AND o.created_at >= (
      SELECT finished_at FROM _prisma_migrations
      WHERE migration_name = '20261019120000_training_attendance_opt_in'
        AND rolled_back_at IS NULL
      ORDER BY finished_at DESC LIMIT 1
    )
  RETURNING o.id
)
UPDATE training_session_players a SET present = true
FROM affected WHERE a.id = affected.id;
