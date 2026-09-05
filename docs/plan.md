# Build Plan

6 days, ~2 hours/day, 12 hours budgeted total. Written after the fact as a
retrospective — the "planned" column is what was estimated at the start of
each day; "actual" is what it really took.

## Day-by-day

| Day | Task | Planned | Actual | Notes |
|---|---|---:|---:|---|
| 1 | Data model: `schema.prisma`, raw-SQL migration for CHECK/partial-unique/GRANT-REVOKE, `seed.ts` covering all 5 statuses | 2.0h | 2.0h | On budget. Seed data ended up doing double duty as the spec for edge cases (an EXPIRED row, a dismissed-then-re-triggered alert pair) before any service code existed to produce them — writing the seed forced deciding the exact shape of "what does a re-triggered alert look like in the DB" early, which paid off on Day 3. |
| 2 | `docs/BUSINESS_LOGIC.md` (state machine, RBAC matrix, locking pseudocode) + `src/lib/auth.ts`, `permissions.ts` | 1.5h | 2.0h | Ran over. The auth/permissions split looked trivial on paper but the `SessionUser` abstraction (decoupling every other module from NextAuth specifically) took an extra design pass to get right — worth it once `registrationService.ts` didn't need to know NextAuth exists at all. |
| 3 | `registrationService.ts`: `reserveSeat`, `updateRegistrationStatus`, `expireStaleReservations`, capacity alert trigger/dismiss | 2.0h | 2.5h | Overran by 0.5h. The row-locking design (`SELECT ... FOR UPDATE` vs `SERIALIZABLE`) needed to actually be worked through with pseudocode before committing, not just picked from a list — see `docs/decisions.md` #1. Cut for the day: a batched/bulk variant of `reserveSeat`, deferred to Day 4 when it turned out bulk import could just reuse the single-row version. |
| 4 | `bulkService.ts` (CSV import/export), `searchService.ts` (paginated, RBAC-scoped search) | 2.0h | 1.5h | Came in *under* budget — the decision to have bulk import call `reserveSeat()` per row instead of reimplementing capacity/duplicate logic (see `docs/decisions.md` #3) turned what was estimated as the hardest remaining piece into mostly plumbing. Banked 0.5h, spent on Day 5. |
| 5 | Frontend: `(dashboard)` layout, dashboard metrics/chart, registrations table + filters + quick actions, registration detail + timeline, CSV import page | 2.0h (+0.5h banked = 2.5h budget) | 3.5h | The overrun day. Tailwind design-token setup, the alert-badge dropdown, and getting Server Actions wired cleanly into client components (quick actions, CSV upload) each took longer than the flat "build the pages" estimate assumed. See "What got cut" below for what didn't make it in as a result. |
| 6 | `docs/architecture.md`, `docs/schema.md`, `docs/decisions.md`, `docs/ai-prompts.md`, `SUBMISSION.md` + fix the lazy-expiry gap found while writing decisions.md | 1.0h | 1.5h | Writing `docs/decisions.md` #4 surfaced that the "lazy evaluation + background sweep" design described in `BUSINESS_LOGIC.md` back on Day 2 was never actually implemented in `registrationService.ts` — only the cron sweep was. Fixed on the spot (documented as the reversed decision it actually was) rather than let the docs describe a system that didn't exist. |
| **Total** | | **12.0h** | **13.0h** | 1 hour over budget, entirely absorbed by Day 5 (frontend) and the Day 6 correctness fix. |

## Build order, and why

1. **Schema before anything else.** Every later layer (services, RBAC,
   UI) reads its shape from `schema.prisma`; getting the state machine and
   capacity model right in the data layer first meant the service layer
   was mostly "implement what the schema already implies" rather than
   discovering new requirements mid-service.
2. **Auth/permissions before the registration service**, not after —
   every mutation in `registrationService.ts` calls `assertSessionAccess`,
   so writing the guard functions first meant the service code was never
   written without RBAC and then retrofitted.
3. **Core service before bulk/search.** `bulkService.ts` deliberately
   reuses `reserveSeat()`; that reuse was only possible because
   `reserveSeat` already existed and was already correct under
   concurrency. Building bulk import first would have meant either
   duplicating the capacity/locking logic or blocking on a service that
   didn't exist yet.
4. **Backend fully before frontend.** Every page in `app/(dashboard)/**`
   is a thin layer over a service function; none of the frontend work
   required backend design decisions, so there was no back-and-forth
   between the two — a deliberate bet that paid off in the actual build
   order, though it meant no working UI existed until Day 5, so any
   backend design mistakes wouldn't have surfaced as a UI bug until then.
5. **Docs last, against the real implementation** — not written
   speculatively alongside the code, specifically so they'd describe what
   was actually built rather than what was planned. This is exactly what
   caught the lazy-expiry gap on Day 6.

## What got cut to stay in budget

Trimmed live during Day 5 when the frontend estimate blew through its
budget, roughly in this order (first cut = least value lost):

1. **Automated tests.** No test suite exists for any service function,
   including the concurrency-critical ones. This is the single biggest gap
   for a real production build and the first thing a Day 7 would add —
   `reserveSeat`'s race-condition behavior in particular deserves a test
   that actually fires concurrent requests at it, not just unit tests of
   the happy path.
2. **Event/Session CRUD UI.** Organizers can't create events or sessions
   through the app — only through direct DB access or the seed script.
   Registering/checking in/searching (the actual brief) all work; the
   "back office" setup side doesn't yet.
3. **Login page UI.** `src/lib/auth.ts`'s NextAuth config is real and
   functional; `/login` is a placeholder div with no form wired to
   `signIn()`.
4. **Staff-scoped dashboard.** The dashboard is Organizer-only; a Staff
   member sees no analytics at all rather than a "my sessions" scoped
   version, which was the original plan.

None of these were cut silently — see `docs/architecture.md` §4 for the
complete out-of-scope list, cross-referenced from here.
