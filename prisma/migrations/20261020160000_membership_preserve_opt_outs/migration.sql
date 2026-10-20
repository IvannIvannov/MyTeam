CREATE OR REPLACE FUNCTION track_attendance_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  member_id uuid;
  group_id uuid;
  scope text;
  changed_at timestamptz := clock_timestamp();
BEGIN
  IF TG_TABLE_NAME = '_PlayerCoachGroups' THEN
    IF TG_OP = 'INSERT' THEN member_id := NEW."B"; group_id := NEW."A";
    ELSE member_id := OLD."B"; group_id := OLD."A"; END IF;
    scope := 'coach_group:' || group_id::text;
  ELSE
    IF TG_OP = 'INSERT' THEN member_id := NEW.player_id; group_id := NEW.group_id;
    ELSE member_id := OLD.player_id; group_id := OLD.group_id; END IF;
    scope := 'custom_group:' || group_id::text;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO attendance_memberships(player_id, scope_key, joined_at)
      VALUES(member_id, scope, changed_at) ON CONFLICT DO NOTHING;
    -- Update rosters in the same transaction as enrollment, not on a later GET.
    INSERT INTO training_session_players(id, training_session_id, player_id, player_name, team_group, present, reason_code, reason_text, updated_at)
      SELECT gen_random_uuid(), s.id, p.id, p.full_name, p.team_group, o.player_id IS NULL AND NOT EXISTS (SELECT 1 FROM clubs c WHERE c.id = p.club_id AND c.payment_workflow::text IN ('training_credits', 'training_credits_30_days')), o.reason_code, o.reason_text, changed_at
      FROM training_sessions s JOIN players p ON p.id = member_id
      LEFT JOIN training_opt_outs o ON o.player_id = p.id AND o.training_date = s.training_date AND s.scope_key NOT LIKE 'coach_group:%'
      WHERE s.scope_key = scope AND s.club_id = p.club_id AND s.status = 'scheduled' AND NOT s.removed_from_schedule AND p.is_active
        AND true
        AND (s.training_date + COALESCE(s.training_time, '00:00')::time) AT TIME ZONE 'Europe/Sofia' >= changed_at
        AND (p.attendance_started_at IS NULL OR (s.training_date + COALESCE(s.training_time, '00:00')::time) AT TIME ZONE 'Europe/Sofia' >= p.attendance_started_at)
      ON CONFLICT (training_session_id, player_id) DO NOTHING;
    RETURN NEW;
  END IF;

  UPDATE attendance_memberships SET left_at = changed_at
    WHERE player_id = member_id AND scope_key = scope AND left_at IS NULL;
  DELETE FROM training_session_players r USING training_sessions s
    WHERE r.training_session_id = s.id AND r.player_id = member_id AND s.scope_key = scope
      AND s.status = 'scheduled' AND NOT r.attendance_recorded
      AND r.reason_code IS NULL AND r.reason_text IS NULL AND r.credit_charged_at IS NULL
      AND true
      AND (s.training_date + COALESCE(s.training_time, '00:00')::time) AT TIME ZONE 'Europe/Sofia' >= changed_at;
  RETURN OLD;
END;
$$;
