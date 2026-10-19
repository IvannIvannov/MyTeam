-- Only change the default for future rows; retain all existing attendance.
ALTER TABLE "training_session_players" ALTER COLUMN "present" SET DEFAULT false;
