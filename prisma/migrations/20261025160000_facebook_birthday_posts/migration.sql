CREATE TABLE "facebook_birthday_posts" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "birthday_year" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "photo_url" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'publishing',
    "facebook_post_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "facebook_birthday_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "facebook_birthday_posts_status_check" CHECK ("status" IN ('publishing', 'published', 'failed', 'unknown'))
);
CREATE UNIQUE INDEX "facebook_birthday_posts_club_id_player_id_birthday_year_key"
ON "facebook_birthday_posts"("club_id", "player_id", "birthday_year");
