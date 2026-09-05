# Event Registration System — Step 1: Data Layer

This is Step 1 of the build: the database schema, seed data, and the
documentation of which rules live in Postgres vs. the application layer.
Next.js routes/Server Actions, NextAuth/Lucia wiring, and the Tailwind +
Recharts UI are Step 2+ and are not included here.

## Contents

```
prisma/
  schema.prisma                          — full data model (see inline [DB]/[APP] comments)
  seed.ts                                — realistic seed data, all 5 registration statuses
  migrations_manual/001_extra_constraints.sql
                                          — CHECK constraint, partial unique indexes,
                                            and immutable-audit-trail GRANT/REVOKE
                                            (things Prisma's schema syntax can't express)
docs/
  BUSINESS_LOGIC.md                      — RBAC matrix, state machine, capacity-locking
                                            code, expiry job, alert re-trigger logic,
                                            and a full DB-vs-app constraint table
  architecture.md                        — moving parts, an end-to-end request trace,
                                            hosting topology, out-of-scope items
  schema.md                              — column types, relationships, denormalization
                                            rationale, what breaks at 100x scale
  plan.md                                — the 6-day/12-hour build plan, planned vs.
                                            actual, and what got cut to stay in budget
  decisions.md                           — 5 architectural decisions incl. the
                                            cron-only → lazy+sweep expiry reversal
  ai-prompts.md                          — prompt log by task, plus a detailed writeup
                                            of a hallucinated CHECKED_IN→CANCELLED
                                            transition and how it was caught
src/lib/
  prisma.ts                              — Prisma client singleton (dev hot-reload safe)
  config.ts                              — env-driven constants (expiry window, page sizes)
  errors.ts                              — typed error hierarchy
  auth.ts                                — NextAuth v5 session handling + role extraction
  permissions.ts                         — assertOrganizer(), assertSessionAccess(), ...
src/services/
  registrationService.ts                 — reserveSeat(), updateRegistrationStatus(),
                                            expireStaleReservations(), lazy-expiry sweep,
                                            capacity alert trigger/dismiss
  bulkService.ts                         — CSV import (per-row report) + streaming CSV export
  searchService.ts                       — paginated, RBAC-scoped registration search
  dashboardService.ts                    — aggregate queries behind the dashboard
app/
  layout.tsx, globals.css                — root layout, IBM Plex Sans/Mono via next/font
  login/page.tsx                         — placeholder only, see docs/architecture.md §4
  (dashboard)/layout.tsx                 — auth gate, sidebar, top bar + alert badge
  (dashboard)/dashboard/page.tsx         — metrics, breakdowns, 14-day check-in chart
  (dashboard)/registrations/page.tsx     — paginated/filterable/sortable table
  (dashboard)/registrations/actions.ts   — Server Actions: confirm/check-in/cancel/dismiss
  (dashboard)/registrations/[id]/page.tsx — detail view + immutable timeline
  (dashboard)/sessions/[id]/import/      — CSV upload page + its Server Action
components/
  ui/, dashboard/, registrations/, import/ — presentational + client-interactive pieces
tailwind.config.ts, postcss.config.js, next.config.js, next-env.d.ts
.env.example
tsconfig.json
package.json
SUBMISSION.md                            — fill in your live URL, repo URL, demo accounts
```

`src/services/*` are plain functions with no framework dependency — call them
from Server Actions, Route Handlers, or the cron endpoint that runs
`expireStaleReservations()`. None of them read a session themselves; the
caller resolves `SessionUser` via `requireUser()` (or passes `null` for
anonymous public registration) and passes it in explicitly, which is what
keeps these testable without mocking Next.js request context.

## Running the app

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, AUTH_SECRET, AUTH_URL
npx prisma migrate dev --name init
# apply prisma/migrations_manual/001_extra_constraints.sql — see below
npx prisma generate
npx prisma db seed
npm run dev             # http://localhost:3000/dashboard
```

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL (Postgres) and AUTH_SECRET

npx prisma migrate dev --name init
# Then apply the manual constraints (CHECK / partial unique indexes / grants):
#   npx prisma migrate dev --create-only --name extra_constraints
#   -> paste the contents of prisma/migrations_manual/001_extra_constraints.sql
#      into the generated migration.sql, then:
npx prisma migrate dev

npx prisma db seed
```

All seeded users share the password `Password123!` (see console output from
the seed script for each user's email / role).

## Why some constraints are "manual SQL" instead of in schema.prisma

Prisma's schema DSL does not support raw `CHECK` constraints or **partial**
(filtered) unique indexes as of the Prisma version this targets. Rather than
fake those rules with only application-layer validation (which is bypassable
by any direct SQL, a bug, or a future script), they're added as a
straightforward manual migration on top of the Prisma-managed schema. This
keeps `schema.prisma` as the single source of truth for the table shape,
while still getting hard DB guarantees for the handful of rules Prisma can't
express declaratively. Full rationale for every constraint's placement is in
`docs/BUSINESS_LOGIC.md` §6.

## Note on this environment

`prisma generate` / `prisma validate` could not be executed in the sandbox
this schema was authored in — the sandbox's network allowlist does not
include `binaries.prisma.sh`, which Prisma needs to download its query
engine. The schema was manually proofread (relation names, cascade
directions, field/type pairing), and everything under `prisma/seed.ts` and
`src/` was type-checked end-to-end (`npx tsc --noEmit`) against a hand-written
stub of the client Prisma would generate — matching Prisma's actual
const-object-plus-literal-union enum pattern, not a nominal TS `enum` — so
application logic (the state machine, locking calls, RBAC guards, search
filters) is confirmed internally consistent. Please still run
`npx prisma validate` and `npx prisma generate` yourself as the first step
before migrating, so the real generated types replace the stub.
