ALTER TABLE "club_matches" ADD COLUMN "attendance_enabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "club_match_players" (
  "match_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "present" BOOLEAN NOT NULL DEFAULT true,
  "reason_code" TEXT,
  "reason_text" TEXT,
  CONSTRAINT "club_match_players_pkey" PRIMARY KEY ("match_id", "player_id"),
  CONSTRAINT "club_match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "club_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "club_match_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "club_match_players_player_id_idx" ON "club_match_players"("player_id");
