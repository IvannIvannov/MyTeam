ALTER TABLE "clubs" ADD COLUMN "player_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Preserve the fields and scheduling mode of existing clubs.
UPDATE "clubs" SET "player_fields" = ARRAY['jerseyNumber', 'teamGroup']::TEXT[];
ALTER TABLE "clubs" ALTER COLUMN "training_group_mode" SET DEFAULT 'custom_group';
ALTER TABLE "players" ADD COLUMN "rank" TEXT, ADD COLUMN "weight" DOUBLE PRECISION;
ALTER TABLE "players" ADD CONSTRAINT "players_weight_positive" CHECK ("weight" IS NULL OR ("weight" > 0 AND "weight" < 'Infinity'::float8));
