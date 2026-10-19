ALTER TABLE "club_matches" ADD COLUMN "description" TEXT NOT NULL DEFAULT '', ADD COLUMN "category" TEXT;
ALTER TABLE "club_matches" ADD CONSTRAINT "club_matches_category_check" CHECK ("category" IN ('friendly', 'official'));
