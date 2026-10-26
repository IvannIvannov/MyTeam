ALTER TABLE "club_subscriptions" DROP CONSTRAINT "club_subscription_mode";
ALTER TABLE "club_subscriptions" ADD CONSTRAINT "club_subscription_mode" CHECK (
  ("mode" = 'trial' AND "first_billing_month" IS NULL) OR
  ("mode" = 'paid' AND "first_billing_month" IS NOT NULL AND "trial_end_date" IS NULL) OR
  ("mode" = 'contract' AND "first_billing_month" IS NULL AND "trial_end_date" IS NULL)
);
