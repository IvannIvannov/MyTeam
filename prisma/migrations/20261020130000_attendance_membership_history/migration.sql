ALTER TABLE players ADD COLUMN attendance_started_at timestamptz;

CREATE TABLE attendance_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  joined_at timestamptz,
  left_at timestamptz
);
CREATE INDEX attendance_memberships_player_id_scope_key_idx ON attendance_memberships(player_id, scope_key);
CREATE UNIQUE INDEX attendance_memberships_active_key ON attendance_memberships(player_id, scope_key) WHERE left_at IS NULL;

-- Existing join dates cannot be reconstructed reliably: NULL means unknown.
INSERT INTO attendance_memberships(player_id, scope_key)
SELECT "B", 'coach_group:' || "A"::text FROM "_PlayerCoachGroups";
INSERT INTO attendance_memberships(player_id, scope_key)
SELECT player_id, 'custom_group:' || group_id::text FROM club_custom_training_group_players;

CREATE FUNCTION track_attendance_membership() RETURNS trigger LANGUAGE plpgsql AS $$
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
    INSERT INTO training_session_players(id, training_session_id, player_id, player_name, team_group, present, updated_at)
      SELECT gen_random_uuid(), s.id, p.id, p.full_name, p.team_group, true, changed_at
      FROM training_sessions s JOIN players p ON p.id = member_id
      WHERE s.scope_key = scope AND s.club_id = p.club_id AND s.status = 'scheduled' AND p.is_active
        AND s.training_time IS NOT NULL
        AND (s.training_date + s.training_time::time) AT TIME ZONE 'Europe/Sofia' >= changed_at
        AND (p.attendance_started_at IS NULL OR (s.training_date + s.training_time::time) AT TIME ZONE 'Europe/Sofia' >= p.attendance_started_at)
      ON CONFLICT (training_session_id, player_id) DO NOTHING;
    RETURN NEW;
  END IF;

  UPDATE attendance_memberships SET left_at = changed_at
    WHERE player_id = member_id AND scope_key = scope AND left_at IS NULL;
  DELETE FROM training_session_players r USING training_sessions s
    WHERE r.training_session_id = s.id AND r.player_id = member_id AND s.scope_key = scope
      AND s.status = 'scheduled' AND NOT r.attendance_recorded
      AND r.reason_code IS NULL AND r.reason_text IS NULL AND r.present
      AND s.training_time IS NOT NULL
      AND (s.training_date + s.training_time::time) AT TIME ZONE 'Europe/Sofia' >= changed_at;
  RETURN OLD;
END;
$$;
CREATE TRIGGER coach_attendance_membership AFTER INSERT OR DELETE ON "_PlayerCoachGroups"
FOR EACH ROW EXECUTE FUNCTION track_attendance_membership();
CREATE TRIGGER custom_attendance_membership AFTER INSERT OR DELETE ON club_custom_training_group_players
FOR EACH ROW EXECUTE FUNCTION track_attendance_membership();
