-- CreateTable
CREATE TABLE "club_subscriptions" (
    "club_id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'trial',
    "trial_end_date" VARCHAR(10),
    "first_billing_month" VARCHAR(7),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "club_subscriptions_pkey" PRIMARY KEY ("club_id")
);

-- CreateTable
CREATE TABLE "club_subscription_fees" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "effective_month" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "club_subscription_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_subscription_payments" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "paid_on" VARCHAR(10) NOT NULL,
    "note" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" TEXT,

    CONSTRAINT "club_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_subscription_payment_months" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "voided_at" TIMESTAMPTZ(6),

    CONSTRAINT "club_subscription_payment_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_subscription_changes" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_subscription_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_subscription_fees_club_id_effective_month_key" ON "club_subscription_fees"("club_id", "effective_month");

-- CreateIndex
CREATE INDEX "club_subscription_payments_club_id_created_at_idx" ON "club_subscription_payments"("club_id", "created_at");

-- CreateIndex
CREATE INDEX "club_subscription_payment_months_club_id_month_idx" ON "club_subscription_payment_months"("club_id", "month");

-- CreateIndex
CREATE INDEX "club_subscription_payment_months_payment_id_idx" ON "club_subscription_payment_months"("payment_id");

-- CreateIndex
CREATE INDEX "club_subscription_changes_club_id_created_at_idx" ON "club_subscription_changes"("club_id", "created_at");

-- AddForeignKey
ALTER TABLE "club_subscriptions" ADD CONSTRAINT "club_subscriptions_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_fees" ADD CONSTRAINT "club_subscription_fees_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club_subscriptions"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payments" ADD CONSTRAINT "club_subscription_payments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club_subscriptions"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payment_months" ADD CONSTRAINT "club_subscription_payment_months_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club_subscriptions"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_payment_months" ADD CONSTRAINT "club_subscription_payment_months_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "club_subscription_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription_changes" ADD CONSTRAINT "club_subscription_changes_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club_subscriptions"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Database protection against double payment, including concurrent requests.
CREATE UNIQUE INDEX "club_subscription_live_month" ON "club_subscription_payment_months" ("club_id", "month") WHERE "voided_at" IS NULL;
ALTER TABLE "club_subscriptions" ADD CONSTRAINT "club_subscription_mode" CHECK (
  ("mode" = 'trial' AND "first_billing_month" IS NULL) OR
  ("mode" = 'paid' AND "first_billing_month" IS NOT NULL AND "trial_end_date" IS NULL)
);
ALTER TABLE "club_subscription_fees" ADD CONSTRAINT "club_subscription_positive_fee" CHECK ("amount" > 0);
ALTER TABLE "club_subscription_payment_months" ADD CONSTRAINT "club_subscription_positive_payment_month" CHECK ("amount" > 0);

-- Preserve existing club access and never invent outstanding charges on rollout.
INSERT INTO "club_subscriptions" ("club_id", "mode", "updated_at")
SELECT "id", 'trial', CURRENT_TIMESTAMP FROM "clubs" WHERE "billing_status" = 'active';
INSERT INTO "club_subscription_changes" ("id", "club_id", "actor_id", "action", "details")
SELECT gen_random_uuid(), "club_id", 'migration', 'initial_trial', '{"trialEndDate":null}'::jsonb FROM "club_subscriptions";
