BEGIN;

ALTER TABLE "coach_groups" ADD COLUMN "training_recurrences" JSONB;
ALTER TABLE "training_sessions" ADD COLUMN "occurrence_key" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "recurrence_id" UUID, ADD COLUMN "recurrence_date" DATE, ADD COLUMN "note" TEXT;
ALTER TABLE "training_session_players" ADD COLUMN "attendance_recorded" BOOLEAN NOT NULL DEFAULT false;
-- Legacy rows do not distinguish a default value from a coach's recorded attendance.
-- Retain them conservatively rather than discard potentially recorded activity.
UPDATE training_session_players SET attendance_recorded = true;
DROP INDEX "training_sessions_club_id_scope_key_training_date_key";
CREATE UNIQUE INDEX "training_sessions_scope_date_occurrence_key"
 ON "training_sessions"("club_id", "scope_key", "training_date", "occurrence_key");
-- Materialize legacy schedules before switching coach groups to session identity.
INSERT INTO training_sessions (club_id, scope_type, scope_key, scope_id, training_date,
 training_time, training_duration_minutes, training_field_id, training_field_piece_ids, updated_at)
SELECT g.club_id, 'coachGroup', 'coach_group:' || g.id, g.id, d::date,
 COALESCE(g.training_date_times ->> d, g.training_time), g.training_duration_minutes,
 COALESCE((g.training_field_selections -> d ->> 'trainingFieldId')::uuid, g.training_field_id),
 CASE WHEN jsonb_typeof(g.training_field_selections -> d -> 'trainingFieldPieceIds') = 'array'
 THEN ARRAY(SELECT jsonb_array_elements_text(g.training_field_selections -> d -> 'trainingFieldPieceIds'))::uuid[]
 ELSE g.training_field_piece_ids END, CURRENT_TIMESTAMP
FROM coach_groups g CROSS JOIN LATERAL unnest(
 CASE WHEN cardinality(g.training_dates) > 0 THEN g.training_dates
 ELSE ARRAY(SELECT to_char(day, 'YYYY-MM-DD') FROM generate_series(
 (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Sofia')::date,
 (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Sofia')::date + 29, interval '1 day') day
 WHERE extract(isodow FROM day)::integer = ANY(g.training_weekdays)) END) d
ON CONFLICT (club_id, scope_key, training_date, occurrence_key) DO NOTHING;
UPDATE training_sessions SET occurrence_key = id::text WHERE scope_type = 'coachGroup';
INSERT INTO training_session_players (training_session_id, player_id, player_name, team_group,
 present, reason_code, reason_text, attendance_recorded, updated_at)
SELECT s.id, p.id, p.full_name, p.team_group, o.id IS NULL, o.reason_code, o.reason_text,
 o.id IS NOT NULL, CURRENT_TIMESTAMP
FROM training_sessions s JOIN "_PlayerCoachGroups" m ON m."A" = s.scope_id
JOIN players p ON p.id = m."B" AND p.is_active AND p.club_id = s.club_id
LEFT JOIN training_opt_outs o ON o.player_id = p.id AND o.training_date = s.training_date
WHERE s.scope_type = 'coachGroup'
ON CONFLICT (training_session_id, player_id) DO NOTHING;
UPDATE "training_sessions" s SET "note" = n."note"
 FROM "training_notes" n WHERE s."scope_type" = 'coachGroup'
 AND s."club_id" = n."club_id" AND s."scope_key" = n."scope_key" AND s."training_date" = n."training_date";
UPDATE "training_session_players" SET "attendance_recorded" = true
 WHERE NOT "present" OR "reason_code" IS NOT NULL OR "reason_text" IS NOT NULL;

COMMIT;
