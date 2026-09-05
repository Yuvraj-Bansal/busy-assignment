# Architecture

## 1. Moving parts

```
┌───────────────────────────────────────────────────────────────────────┐
│ Browser                                                                │
│  Next.js App Router pages (Server Components) + client islands        │
│  (filters, quick-action buttons, alert dropdown, CSV upload)          │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ HTTP (page loads, Server Actions)
┌───────────────────────────────▼───────────────────────────────────────┐
│ Next.js server runtime (single deployable)                            │
│                                                                         │
│  app/(dashboard)/**            — Server Component pages (data reads)   │
│  app/(dashboard)/**/actions.ts — Server Actions (data writes)          │
│  app/api/cron/expire           — Route Handler, hit by an external     │
│                                   scheduler every minute               │
│                                                                         │
│  src/lib/auth.ts        — NextAuth v5, JWT session, role extraction    │
│  src/lib/permissions.ts — assertOrganizer / assertSessionAccess        │
│  src/services/*.ts      — registrationService, bulkService,            │
│                            searchService, dashboardService             │
│  src/lib/prisma.ts      — Prisma client singleton                      │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ SQL (row-locked transactions)
┌───────────────────────────────▼───────────────────────────────────────┐
│ PostgreSQL                                                            │
│  users, events, sessions, session_assignments, registrations,         │
│  registration_timeline (append-only), capacity_alerts                 │
└─────────────────────────────────────────────────────────────────────┘
```

Everything runs inside one Next.js deployable — there is no separate API
server. Server Components read data directly by calling service functions
in-process (no network hop, no REST/GraphQL layer between the page and
Postgres); Server Actions do the same for writes, invoked directly from
client components as if they were local async functions. The only external
dependency besides Postgres is a scheduler (Vercel Cron or any `curl`-based
cron) that calls the expiry Route Handler once a minute.

## 2. Request path: a Check-in Staff member checks someone in

This traces one action end-to-end through every layer, using the actual
function/file names in this codebase.

1. **Client**: staff clicks **"Check in"** on a row in
   `RegistrationsTable`. `QuickActionButtons` (a client component) calls
   `checkInRegistrationAction(registrationId)` — a Server Action imported
   directly from `app/(dashboard)/registrations/actions.ts`. React wraps
   this in `useTransition` so the button shows "Checking in…" without a
   full page navigation.
2. **Server Action** (`actions.ts`): calls `requireUser()` from
   `src/lib/auth.ts`, which reads the signed JWT session cookie and throws
   `UnauthorizedError` if there isn't one. Then calls
   `updateRegistrationStatus(registrationId, "CHECKED_IN", user)` from
   `registrationService.ts`.
3. **Service, transaction 1** (lazy-expiry check): locks the Registration
   row (`SELECT ... FOR UPDATE`), and — if it's a stale `RESERVED` row past
   its `expiresAt` that the cron sweep hasn't reached yet — expires it and
   commits immediately, independent of what happens next (see
   `docs/decisions.md` #4 for why this had to be its own transaction).
4. **Service, transaction 2** (the actual transition): re-locks the row,
   calls `assertSessionAccess(user, sessionId)` from `permissions.ts` — for
   a Check-in Staff caller this queries `SessionAssignment` for a
   `(sessionId, userId)` match and throws `ForbiddenError` if none exists.
   Then `assertLegalTransition(current.status, "CHECKED_IN")` checks the
   state machine — this only succeeds from `CONFIRMED`. On success:
   `registrations.status` is updated, `checkedInAt` is stamped, one
   `RegistrationTimeline` row is inserted (`CONFIRMED -> CHECKED_IN`,
   `actorId` = the staff member's id), and the session's occupied count is
   recomputed to re-evaluate its `CapacityAlert` (check-in doesn't change
   occupancy, but recomputing is cheap and keeps this correct even if
   capacity was edited).
5. **Response**: the Server Action calls `revalidatePath("/registrations")`
   and `revalidatePath("/dashboard")`, returns `{ ok: true }`.
6. **Client**: `QuickActionButtons` clears its pending state; Next.js
   re-fetches the now-stale Server Component data for the registrations
   list and dashboard on next navigation/revalidation, so the row's badge
   updates to "Checked in" and the Confirm/Check In/Cancel buttons
   disappear (no legal transitions remain from `CHECKED_IN`).

No step in this path is optimistic — the UI shows "Checking in…" and then
reflects exactly what the database transaction actually committed, never a
guessed outcome.

## 3. Hosting topology

- **App**: Next.js deployed to a Node-compatible host (Vercel is the
  reference target — Server Actions, Route Handlers, and `next/font` all
  work there without extra config; any Node 18+ host works too).
- **Database**: managed Postgres (Neon, RDS, Supabase, etc.) — anything
  that supports `SELECT ... FOR UPDATE` and partial unique indexes, which
  is standard Postgres, not an exotic feature.
- **Scheduler**: Vercel Cron (or any external cron/GitHub Actions schedule)
  hits `POST /api/cron/expire` once a minute, which calls
  `expireStaleReservations()`. This route is a *backstop*, not the primary
  correctness mechanism — see the lazy-expiry note above and
  `docs/decisions.md` #4.
- **Sessions**: JWT-based (NextAuth `session: { strategy: "jwt" }`) — no
  server-side session store, so no sticky-session requirement across
  multiple app instances.
- **Assets/fonts**: `next/font/google` self-hosts IBM Plex Sans/Mono at
  build time — no runtime call to Google Fonts, no separate CDN needed
  beyond whatever the host already provides for static assets.

There is one deployable and one database. Nothing here requires a queue,
a cache layer, or a separate worker process — deliberately, given the
scale this was built for (see `docs/schema.md`'s "what breaks at 100x").

## 4. Out of scope (this build)

Explicitly not built, to keep the 12-hour budget (`docs/plan.md`) honest:

- **Login/signup UI** — `src/lib/auth.ts` (NextAuth config + Credentials
  provider) is real and functional; `app/login/page.tsx` is a placeholder
  with no form.
- **Event/Session CRUD UI** — Organizers currently need direct DB/seed
  access to create events and sessions; only the *consumption* side
  (registering, checking in, viewing) has pages.
- **Public self-service registration page** — `reserveSeat()` supports an
  anonymous `actorUser: null` caller by design (see the seed data's
  "self-service" registrations), but no public-facing form calls it yet;
  today it's only reachable via CSV import or a future API route.
- **Email notifications** (confirmation emails, reminders, expiry
  warnings).
- **Staff-scoped dashboard/analytics** — the dashboard is Organizer-only;
  a "my assigned sessions" analytics view for Staff is a natural v2.
- **Real-time updates** — table/dashboard refresh via `revalidatePath`
  after a mutation, not a live subscription; two staff members checking in
  attendees at the same desk won't see each other's actions until their
  next navigation or manual refresh.
- **Rate limiting / abuse prevention** on the (currently nonexistent)
  public registration endpoint.
- **Multi-tenancy** — one Postgres database serves one organization; no
  `organizationId` scoping anywhere in the schema.
- **Automated test suite** — see `docs/plan.md` for why this was the first
  thing cut when Day 5 (frontend) ran over budget.
