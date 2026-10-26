# Manual club subscriptions

The platform admin opens **Абонаменти** from `/admin/players`. Club subscriptions are independent of player dues: `defaultPaymentAmount`, player fees, and player billing status keep their existing meaning. Subscription expiry does not restrict club access.

## Workflow

- Activate player billing through the existing club **Такси** screen. Choose a free trial (explicit end date or no end date) or a paid subscription (positive EUR monthly fee and first billable month).
- Existing active clubs receive unlimited trials during migration. Demo clubs remain ineligible. Repeat activation changes player billing settings without resetting a subscription.
- Trial end dates include the whole final day in Europe/Sofia. Expired trials do not accrue debt. Convert to paid manually and select the first billable month.
- Each billable calendar month is owed in full until paid; there is no proration. The outstanding total includes unpaid months through the current local month. Future fees are not yet outstanding.
- Select any unpaid months, including future months or months across years, and record payment date and optional note. The total is calculated from each month's applicable fee. Skipping a month leaves it outstanding; continuous paid-through coverage stops at the first gap.
- Change fees from an explicit effective month, no earlier than the month after the latest non-voided paid month (or the subscription start if nothing is paid). The default is the later of that minimum and next month. This guard also covers payments with gaps and is enforced in the form and API. A revision runs until the next existing revision. Unpaid months are recalculated; recorded payment amounts never change. The fee history shows scheduled revisions.
- Void mistaken payments from history. The record and its original amounts remain visible, and its months become payable again. Paid subscriptions cannot return to a trial in this version.

Initial activation, changes to trial duration, trial-to-paid conversion, recorded subscription payments, payment voids, and changes to an already-set fee each save a platform-admin message in the club’s **Известия за треньори** inbox, even if no devices have push enabled. Messages are stored as `myteam_message` in the main club scope and appear in the **Админ** filter; coach-group scopes do not receive them. Saving the message and changing the subscription happen in the same transaction. After commit, the app publishes the existing notification event and sends push only to active club-level device subscriptions (`coachGroupId = null`), opening `/admin/members?clubId=...`. A delivery failure is reported without losing the inbox message or subscription change. Payment messages include the recorded amount, payment date, and selected months; retrying the same payment does not duplicate the message. Repeat activation, unchanged trial/fee values, and expiry stay silent. No automatic push retries are included. Voiding a payment stores a correction message with the original payment date, amount, and reopened months. Repeating a void is silent.

## API and consistency

- `GET /api/admin/subscriptions`: all clubs, subscription configuration, fee schedule, payment history, and computed accounting summaries.
- `POST /api/admin/subscriptions/{clubId}`: `action` is `trial`, `start_paid`, `fee`, `payment`, or `void`; every mutation includes `expectedVersion`.
- `trial`: `trialEndDate` is `YYYY-MM-DD` or explicit `null`.
- `start_paid`: `firstBillingMonth` (`YYYY-MM`) and `amount` (EUR decimal string).
- `fee`: `effectiveMonth` and `amount`.
- `payment`: client UUID `paymentId`, distinct `months` (1–120), `expectedTotal`, `paidOn` (not in the future), and optional `note` (up to 1,000 characters).
- `void`: `paymentId`.

All endpoints require the platform `admin` role. Mutations lock the club row, check eligibility and version, and write audit records in the same transaction. Stale input and overlapping live payment months return 409. A matching payment UUID/content is an idempotent retry, even after that payment was voided. Money is calculated in integer cents and stored as decimals. Calendar inputs support years 2000–2199.

Activation accepts an optional `subscription` object: `{ mode: "trial", trialEndDate: null | "YYYY-MM-DD" }` or `{ mode: "paid", firstBillingMonth: "YYYY-MM", amount: "25.00" }`. Older callers omitting it get an unlimited trial on first activation. Club activation, subscription setup, and player billing updates commit atomically.

## Release and verification

Apply the additive migration `20261024120000_club_subscriptions` through the project's normal migration deployment (`npx prisma migrate deploy`), and regenerate Prisma Client before starting the updated app. Do not use `db push` instead: the migration contains a backfill and the partial unique index preventing duplicate live payment months. The implementation does not apply migrations to the configured database automatically.

Focused checks:

```sh
npm test -- src/lib/clubSubscriptionDomain.test.ts src/lib/clubSubscriptionMigration.test.ts src/lib/clubSubscriptions.test.ts
npm run typecheck
```

For an acceptance check, use an isolated database: activate a demo club with a limited trial, extend the trial, convert to paid, pay nonconsecutive months across years, verify a fee revision is rejected through the latest paid month and accepted from the following month, and void/re-record a payment. Confirm that unpaid gaps remain, paid amounts retain their snapshots, coach-only sessions are denied, and push recipients contain only the intended club's main admin devices.

## Reminder schedule and club visibility

`runClubSubscriptionReminders` checks active clubs in Europe/Sofia calendar dates. Limited trials receive reminders in the 7-day and 1-day windows and an expiry notice after the final inclusive day. A delayed run catches up only the current window. Unlimited trials are excluded; extending the end date starts a new cycle. Unpaid subscription months become overdue after their calendar month ends. Each overdue month is reminded once; newly discovered overdue months are grouped into one club message per run. Voiding a payment produces its own correction immediately and does not reset the overdue reminder ledger.

The `club_subscription_reminders` table deduplicates by club and period/stage. The job locks the same club row as subscription mutations, then rechecks current billing status, trial dates, and payments. Reminder ledger entries and the coach inbox message commit together. Push happens after commit, only for main club devices; a failed push does not remove or duplicate the saved inbox reminder. Errors for one club do not stop other clubs and return a failed job status for scheduler retry.

`GET` or `POST /api/cron/club-subscription-reminders` accepts the existing `CRON_SECRET` via Bearer authorization or `x-cron-secret`. Vercel runs this route daily at 07:00 UTC through `vercel.json`; configure `CRON_SECRET` on the deployment. Non-Vercel hosts with `LOCAL_SCHEDULER=true` check on startup and hourly. External schedulers can call the same authenticated route. Apply migration `20261024160000_club_subscription_reminders` and regenerate Prisma Client before enabling this job.

The main members page (without `coachGroupId`) shows a club-facing subscription summary: trial end date, or monthly fee, paid month snapshots, outstanding months/amount and uninterrupted coverage. It refreshes every minute while visible and on focus/tab return. Its authenticated API at `/api/admin/clubs/{id}/subscription` follows the existing shared club coach session access model and omits payment notes, audit details, and account IDs. It does not change player dues.

The platform admin's **История и такси** displays audit records for initial setup, trial changes, paid conversion, fee revisions, payments and voids, including before/after values, account ID, and Europe/Sofia timestamp. Current password-only accounts have no personal name field; shared credentials identify an account rather than a person. Audit history is available for trials as well as paid subscriptions.

### Clubs with contracts

Select **С договор** during billing activation, or use **Задай „С договор“** on an existing subscription. Contract billing is managed outside the app. The club sees **С договор**, with no subscription amounts, unpaid months, payment controls, or subscription notifications/reminders. Existing financial records remain in the administrator history. Subscription billing mutations are blocked by the API for contract clubs. Player dues and unrelated notifications are unaffected. Changing to a contract is audited and sends no club message. Returning a contract club to in-app billing is not offered.

Requires migration `20261024180000_club_subscription_contract` before using the new status.
