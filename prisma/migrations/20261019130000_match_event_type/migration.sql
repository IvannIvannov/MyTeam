ALTER TABLE "club_matches" ADD COLUMN "event_type" TEXT NOT NULL DEFAULT 'match';
ALTER TABLE "club_matches" ADD CONSTRAINT "club_matches_event_type_check"
  CHECK ("event_type" IN ('match', 'duel', 'competition', 'participation'));
