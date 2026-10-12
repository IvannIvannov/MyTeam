# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production: prisma generate && next build
npm run start        # Start production server
npm run lint         # Run ESLint (flat config, no args needed)

# Database
npx prisma migrate dev       # Create and apply new migration
npx prisma migrate deploy    # Apply migrations to production DB
npx prisma studio            # Open Prisma Studio (DB GUI)
npx prisma generate          # Regenerate Prisma client after schema changes

# Data scripts
npm run seed:users           # Seed admin + coach users (requires ADMIN_PASSWORD & COACH_PASSWORD env vars)
npm run import:players       # Import players from CSV: node scripts/import-players-from-csv.js <csvPath> [clubId]
```

There is no test framework configured (no Jest, Vitest, Playwright, or Cypress). There is no CI/CD pipeline.

## Architecture

**Next.js 16 App Router full-stack application** (React 19, TypeScript 5) for sports club management (football/soccer). Uses PostgreSQL via Prisma, styled with Tailwind CSS 4, deployed on Vercel.

The UI is entirely in **Bulgarian**. Player names use Bulgarian Cyrillic and are transliterated to Latin for Cloudinary public IDs (`src/lib/transliterate.ts`).

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`). Always use `@/` imports.

### Route Structure

- `src/app/admin/**` — Admin panel (protected by `admin_session` cookie JWT)
- `src/app/member/[cardCode]/**` — Public member portal (no auth, identified by NFC card code)
- `src/app/api/admin/**` — Admin API routes (require auth middleware)
- `src/app/api/members/[cardCode]/**` — Public member API endpoints
- `src/app/api/cron/**` — Scheduled job endpoints (validated by `CRON_SECRET` header)
- `src/app/api/upload` — Cloudinary image upload (multipart form)
- `src/app/api/manifest/**` — Dynamic PWA manifests per member/admin
- `src/app/api/push/**` — VAPID public key and client error logging

### Authentication & Authorization

Cookie-based sessions using `jose` JWT (HS256). Logic in `src/lib/adminAuth.ts`, enforcement in `src/middleware.ts`. The middleware checks for an `admin_session` httpOnly cookie on all `/admin` and `/api/admin` routes.

**Login flow:** Supports seeded users (scrypt-hashed passwords) with a fallback to the `ADMIN_PASSWORD` env variable when the users table is empty.

**Role-based access — two roles: `admin` and `coach`:**
- **Admin** — full access to all admin routes
- **Coach** — restricted to:
  - Pages: `/admin/members` only
  - APIs: `/api/admin/members/*`, `/api/admin/clubs/*`, `/api/admin/check-session`, `/api/admin/logout`
  - All other admin routes return 403/redirect

**JWT payload:** `{ sub: userId, roles: AdminRole[], defaultClubId?: string }`

### Database (Prisma + PostgreSQL)

Schema: `prisma/schema.prisma`. The Prisma client singleton is in `src/lib/db.ts` — **always import `prisma` from `@/lib/db`**, not directly from `@prisma/client`.

`db.ts` includes connection URL normalization (auto-adds `sslmode=require`, detects Neon pooler hosts for `pgbouncer=true`) and a retry wrapper `withPrismaPoolRetry()` for P1001/P2024 errors with exponential backoff.

**Key models:**
- `Club` — multi-tenant root; most queries scope to a club
- `Player` + `Card` — members with unique 8-hex card codes for public portal access
- `PaymentLog` / `PaymentWaiver` — payment history; player status is `paid/warning/overdue`
- `ClubTrainingScheduleGroup` + `ClubTrainingGroupSchedule` — training schedule definitions per team group
- `TrainingOptOut` + `TrainingNote` — per-session training data
- `PushSubscription` / `AdminPushSubscription` — Web Push device registrations
- `PlayerNotification` / `AdminNotification` — notification delivery history
- `CronJobRun` — deduplication guard for scheduled jobs (unique on jobName + year + month)
- `User` — admin/coach accounts with scrypt-hashed passwords and roles array

### Payment Status System

Payment status is computed dynamically in `src/lib/paymentStatus.ts`, not just stored in the DB:
- **paid** — current month settled (paid or waived)
- **warning** — previous month settled, current month unsettled
- **overdue** — neither current nor previous month settled

Tracks by `YearMonth` (YYYY-MM). The DB `status` field can be stale — always recompute from `PaymentLog` + `PaymentWaiver` records.

### Training System

Training date generation in `src/lib/training.ts`. Clubs configure training via weekdays (Mon=1..Sun=7) or explicit dates. The system generates upcoming dates within a 30-day window, respecting the club's timezone (`CRON_TIMEZONE`, default `Europe/Sofia`). Per-team-group schedules override club-level defaults.

### Real-Time Events (SSE)

In-memory pub/sub for Server-Sent Events, used for live updates without WebSockets:
- `src/lib/memberEvents.ts` — member updates (check-in, reset, notifications, payment, training)
- `src/lib/adminNotificationEvents.ts` — club notification stream
- `src/lib/trainingAttendanceEvents.ts` — training attendance stream

SSE endpoints: `/api/members/[cardCode]/events`, `/api/admin/clubs/[id]/notifications/events`, `/api/admin/clubs/[id]/training-attendance/stream`, `/api/admin/questions/events`

### Push Notifications

Web Push API with VAPID keys. Services split between players (`src/lib/push/service.ts`) and admins (`src/lib/push/adminService.ts`). Notification templates in `src/lib/push/templates.ts` (6 types: `visit_registered`, `membership_almost_finished`, `training_reminder`, `trainer_message`, `monthly_membership_payment_reminder`, `monthly_overdue_payment_reminder`).

Push subscriptions auto-deactivate on 410 (Gone) or 404 (after 24h) responses from the push service.

### Image Storage

Cloudinary for all images (players, club emblem). Config in `src/lib/cloudinary.ts`, URL helpers in `src/lib/cloudinaryImagePath.ts`, client-side upload helper in `src/lib/uploadImage.ts`. Upload endpoint at `/api/upload` handles multipart form data (player: 640x800 WebP, club: 768x768 WebP). Google Drive API used for bulk photo imports.

### PWA

Service worker at `public/sw.js`, bootstrap in `src/components/pwa/PwaClientBootstrap.tsx`. Each member gets a dynamic web manifest from `/api/manifest/[cardCode]`. Admin panel also has manifests at `/api/manifest/admin/members`.

### Background Jobs

Cron endpoints at `src/app/api/cron/`:
- `monthly-membership-payment-reminder` — warns members approaching overdue
- `monthly-overdue-payment-reminder` — alerts already-overdue members

Execution tracked in `CronJobRun` to prevent duplicate runs within the same month. Cron requests validated by `CRON_SECRET` in the `Authorization` header (Bearer token) or `x-cron-secret` header. Jobs are timezone-aware and filter clubs by configured reminder schedule (day/hour/minute).

## Conventions

### API Response Format

- Success: `NextResponse.json({ ... })` with data or `{ success: true }`
- Error: `NextResponse.json({ error: "Message" }, { status: 4xx/5xx })`

### Next.js 16 / React 19 Gotcha

Dynamic route params are `Promise` objects in Next.js 15+. Always `await` them:
```ts
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
```

### Database Conventions

- All IDs are UUIDs (`@default(uuid())`, stored as `@db.Uuid`)
- Timestamps use `@db.Timestamptz(6)` for UTC precision
- Date-only fields use `@db.Date`
- Cascade deletes on child relations
- Unique constraints enforce one-resource-per-context (e.g., one waiver per player per month)

### Component Structure

Very few shared components (3 in `src/components/`). Most UI is colocated in page files with companion `.css` modules. No UI component library — styling is plain Tailwind CSS + custom CSS.

## Environment Variables

See `.env.example` for all required variables. Critical ones:
- `DATABASE_URL` — PostgreSQL connection string (supports Neon pooler URLs)
- `ADMIN_PASSWORD` — Fallback admin password (used when users table is empty)
- `ADMIN_SESSION_SECRET` — JWT signing secret
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web Push
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
- `CRON_SECRET` — Authorization for cron endpoints
- `CRON_TIMEZONE` — Timezone for cron scheduling (default: `Europe/Sofia`)
- `GOOGLE_DRIVE_API_KEY` — Optional, for bulk photo imports

## Agent skills

### Issue tracker

Track issues in GitHub Issues for moozuk22/MyTeam.
See `docs/agents/issue-tracker.md` for tracker operations.

### Triage labels

Use the five default triage labels.
See `docs/agents/triage-labels.md` before applying labels.

### Domain docs

Use a single-context domain layout.
Read `docs/agents/domain.md` before exploring domain concepts.
