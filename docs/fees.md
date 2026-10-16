# Monthly fees

Fee settings remain in the members page's **Месечна такса** modal. Admins and coaches retain the existing fee-setting permissions.

## Price resolution

Online checkout and both manual-payment endpoints use `resolveMemberFee`:

1. A positive `Player.paymentAmount` is a personal override.
2. Otherwise, a valid `Player.billingCoachGroupId` selects a member's group's current fee.
3. Without a selection, a single group or multiple groups with the same effective fee supply the price. Different effective fees require a billing-group choice.
4. A blank group fee inherits `Club.defaultPaymentAmount`; members without groups use that default directly.

Personal zero continues to mean no override. A group fee of zero is explicit: manual recording supports it, while online checkout requires a positive amount, as before. Pauses remain separate from fees.

Changing fees applies the current price to all periods included in a new payment, including older unpaid months. Existing payment logs are never repriced. Group selections follow future changes to that group's fee and are stored independently of personal overrides.

## Editing and conflicts

The modal exposes club/group amounts, personal exceptions, and billing-group choices. Personal amounts change only through explicit edits. New members and imports default to personal zero instead of copying the club default.

The bulk coach-group membership modal loads a fee/membership snapshot in one request when opened. Selecting or deselecting a player computes the resulting fee in the browser and immediately shows any required billing-group choice in that same modal. Personal fees are explicitly marked as preserved. No checkbox change makes a server request. Save remains disabled until local conflicts are resolved, then sends assignments and billing choices together with the snapshot revision. The backend revalidates everything. A rejected save displays instructions and refreshes the snapshot; it no longer automatically opens a different modal. A manual fee-review button handles conflicts elsewhere in the club.

Fee changes, individual/bulk membership assignments, and group deletion validate the resulting effective prices. Conflicting changes require choices before the transaction writes anything. Deleting a selected group clears its selection; if remaining groups conflict, resolve their choices in the same modal before deletion. Removing a personal override also requires resolving any group conflict. Moving a member to another club requires removing existing group memberships first.

The fee service locks the club row and uses a serializable transaction. Modal saves include a revision of the settings they loaded; stale saves are rejected with instructions to reopen the modal. Bulk assignments are atomic rather than sequential per-player saves.

## Checkout snapshots

New IRISPay checkouts store `quotedPaidDates` as the exact ISO date list alongside the existing total/currency. Confirmation allocates the stored total over that list, including gaps caused by waived/already-paid months. Current fee settings are not consulted during confirmation. Link reuse also compares exact quoted dates.

Pre-existing checkout rows have no exact date snapshot and retain their legacy range interpretation. Their amounts and links are unchanged. The old data cannot reliably reconstruct a lost non-contiguous quote; such legacy cases may still require reconciliation. No historical snapshot is invented from today's waivers.

## Rollout

Migration: `20261016160000_coach_group_fees`.

- Adds nullable group amounts, a nullable player billing-group reference, and exact checkout dates.
- Backs up player amounts matching their own club default in `player_fee_migration_backup`, then sets those matching amounts to zero. Different amounts are preserved. A deliberate personal fee equal to the club default becomes inherited pricing under the agreed migration rule.
- Does not modify payment logs or existing checkout amounts.

Apply the migration as part of a coordinated release before serving the new application. Avoid fee edits/member creation between data cleanup and application rollout: the old application still copies defaults into personal amounts. This implementation does not apply migrations to the connected database or deploy the application.

## Verification

Application tests cover hierarchy, group conflicts and choices, stale edits, preserving personal fees, migration behavior in an isolated PostgreSQL-compatible database, and online confirmation across a waived gap. A sample-data browser preview verifies conflict selection, Save gating, and editing/removing personal overrides. It does not charge a provider or access the connected database.
