# Birthday publishing to a club Facebook Page

Coaches open **Рожденици**, select **Поздрави във Facebook** on a player, review the photo and destination Page, edit the greeting, and click **Публикувай**. The app publishes a native photo post with the greeting as its caption. It adds no player-profile link. Today's list and the selected calendar date both offer the action.

## Connect each club's Page

One MyTeam Meta app serves every club. Configure the **Manage everything on your Page** use case with `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`. Each club uses its own Facebook account to authorize a Page; club staff do not create developer apps or handle tokens.

Set these server-only variables, then restart the app:

```dotenv
FACEBOOK_APP_ID=your_meta_app_id
FACEBOOK_APP_SECRET=your_private_app_secret
FACEBOOK_APP_URL=https://your-public-myteam-host
FACEBOOK_TOKEN_ENCRYPTION_KEY=64_random_hex_characters
FACEBOOK_GRAPH_API_VERSION=v26.0
```

Generate the encryption key with `openssl rand -hex 32`. Keep it stable and back it up securely: replacing it makes existing saved connections unreadable. Never commit secrets or send them in chat. No variable uses the `NEXT_PUBLIC_` prefix.

Apply `npx prisma migrate deploy` and regenerate the Prisma client. The new connection tables hold one encrypted token per club and short-lived encrypted Page choices. Existing `FACEBOOK_PAGES` configuration remains a fallback for clubs without a database connection; explicitly disconnecting a club disables that fallback.

For local testing, run `ngrok http 3000`, set `FACEBOOK_APP_URL` to the resulting HTTPS origin, and open/login to MyTeam through that origin. Register this exact **Valid OAuth Redirect URI** in the app's Facebook Login settings:

```text
https://your-public-myteam-host/api/facebook/callback
```

Update both settings when the tunnel hostname changes. Enable Web OAuth Login and Client OAuth Login if those controls are shown. Development-mode testers must have an appropriate Meta app role and Page access. Before unrelated clubs can authorize the app, complete Meta's applicable business verification, Advanced Access/App Review requirements and Live-mode setup. Meta may require a privacy-policy URL and data-deletion instructions; provide the actual published policies for MyTeam before requesting review.

Open a club → **Рожденици → Facebook страница на клуба**. Click **Свържи Facebook страница**, authorize the permissions, then select the correct Page from the returned list. Only Pages with content publishing tasks are offered. The server exchanges the code, attempts a long-lived user-token exchange, and encrypts the selected Page token at rest. The browser receives only Page IDs/names. Temporary choices are session-bound, expire after ten minutes, and are deleted on subsequent connection starts. They cannot be used after expiry. Reconnect when access expires or is revoked. **Прекъсни връзката** removes the stored token and invalidates pending club connection attempts; this disconnects MyTeam locally and does not revoke permissions granted to the Meta app.

Tokens may expire or be revoked despite a long-lived exchange. The integration does not automatically renew or publish. A Page connection can be replaced by reauthorizing and explicitly selecting another Page. Connection actions use the existing admin/coach authorization model: unscoped sessions retain club-wide access.

Player photos must be accessible to Facebook over HTTPS. The existing primary photo is used; Cloudinary uploads are rendered as JPEG at up to 1200px wide. Missing or broken photos disable publishing. Coaches review the exact photo, destination, and caption before clicking **Публикувай**. That click creates a real photo post; connection setup creates no posts.

Official references: [Meta manual authorization flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/), [Page access tokens](https://developers.facebook.com/docs/pages-api/getting-started/), and [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/). Meta documentation was rate-limited during implementation; the live authorization flow still needs testing against the configured app.

## Duplicate prevention and failures

The ledger allows one birthday post per club/player/calendar year. A unique database constraint prevents concurrent requests from publishing twice. A rejected Facebook request is marked `failed`, allowing a coach to correct the setup and try again. Network timeouts, malformed responses, and provider server errors are marked `unknown`; interrupted workers may leave `publishing`. These states block automatic retry because Facebook may already have accepted the post.

If a request is stuck, the administrator must inspect the club's Page first. If the post exists, record its Facebook ID and mark the matching ledger row `published`. Only after confirming that no post was created should an administrator mark it `failed`. Do not delete ledger rows to retry. The ledger retains the caption, photo URL, Page ID, actor and result, including after a player is removed.

Publishing uses the existing admin/coach session model. Club and player ownership are checked; group-page requests also require that the player belongs to that group. Existing coach accounts without a default club have the application's existing club-wide access; this change does not add per-coach group assignments. POST requests must originate from the app.

The app does not automatically post on birthdays or when sending the weekly digest. Every publish requires the coach's explicit button click. Changing a published caption or replacing an uncertain post must be handled on the Facebook Page and reconciled with the ledger.
