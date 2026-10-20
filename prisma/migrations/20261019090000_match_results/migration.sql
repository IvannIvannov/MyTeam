ALTER TABLE "club_matches"
  ADD COLUMN "home_score" INTEGER,
  ADD COLUMN "away_score" INTEGER,
  ADD CONSTRAINT "club_matches_result_check" CHECK (
    ("home_score" IS NULL AND "away_score" IS NULL)
    OR ("home_score" IS NOT NULL AND "away_score" IS NOT NULL
      AND "home_score" BETWEEN 0 AND 999 AND "away_score" BETWEEN 0 AND 999)
  );
