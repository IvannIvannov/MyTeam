CREATE TABLE "club_subscription_reminders" (
    "club_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "club_subscription_reminders_pkey" PRIMARY KEY ("club_id", "key"),
    CONSTRAINT "club_subscription_reminders_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club_subscriptions"("club_id") ON DELETE CASCADE ON UPDATE CASCADE
);
