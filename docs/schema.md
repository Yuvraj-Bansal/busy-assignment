# Schema

Companion to `prisma/schema.prisma`. This document covers column types and
relationships at a glance, points back to `docs/BUSINESS_LOGIC.md` §6 for
the full DB-vs-app constraint table (not repeated here), and adds two things
that document doesn't cover: denormalization rationale, and what breaks at
100x the scale this was designed for.

## 1. Tables and column types

| Table | Column | Type | Notes |
|---|---|---|---|
| `users` | `id` | `text` (cuid) | PK |
| | `name` | `text` | |
| | `email` | `text` | unique |
| | `passwordHash` | `text` | bcrypt hash, never the raw password |
| | `role` | `enum(Role)` | `ORGANIZER` \| `CHECK_IN_STAFF` |
| | `isActive` | `boolean` | soft-disable instead of delete |
| | `createdAt`, `updatedAt` | `timestamp` | |
| `events` | `id` | `text` (cuid) | PK |
| | `name`, `slug` | `text` | `slug` unique |
| | `description` | `text?` | nullable |
| | `venueName` | `text` | |
| | `startDate`, `endDate` | `timestamp` | |
| | `organizerId` | `text` | FK → `users.id` |
| `sessions` | `id` | `text` (cuid) | PK |
| | `eventId` | `text` | FK → `events.id` |
| | `title`, `description?`, `location?` | `text` | |
| | `startTime`, `endTime` | `timestamp` | |
| | `capacity` | `int` | `CHECK (capacity > 0)` — raw SQL, see below |
| `session_assignments` | `id` | `text` (cuid) | PK |
| | `sessionId`, `userId` | `text` | FKs; composite unique together |
| | `assignedById` | `text?` | FK → `users.id`, nullable |
| | `assignedAt` | `timestamp` | |
| `registrations` | `id` | `text` (cuid) | PK |
| | `sessionId` | `text` | FK → `sessions.id` |
| | `attendeeName`, `attendeeEmail`, `attendeePhone?` | `text` | |
| | `status` | `enum(RegistrationStatus)` | 5 values, see BUSINESS_LOGIC.md |
| | `reservedAt`, `expiresAt?`, `confirmedAt?`, `checkedInAt?`, `cancelledAt?` | `timestamp?` | all nullable except `reservedAt` |
| | `cancelReason?` | `text?` | |
| | `createdById?` | `text?` | FK → `users.id`, null = self-service |
| `registration_timeline` | `id` | `text` (cuid) | PK |
| | `registrationId` | `text` | FK → `registrations.id` |
| | `actorId?` | `text?` | FK → `users.id`, null = system action |
| | `oldStatus?`, `newStatus` | `enum(RegistrationStatus)?` / `enum` | `oldStatus` null only on the creation row |
| | `note?` | `text?` | |
| | `timestamp` | `timestamp` | |
| `capacity_alerts` | `id` | `text` (cuid) | PK |
| | `sessionId` | `text` | FK → `sessions.id` |
| | `status` | `enum(AlertStatus)` | `ACTIVE` \| `DISMISSED` |
| | `currentCount`, `capacity` | `int` | snapshot at trigger time (see §3) |
| | `triggeredAt`, `dismissedAt?` | `timestamp?` | |
| | `dismissedById?` | `text?` | FK → `users.id` |

## 2. Relationships

**1:N**
- `User` (organizer) → `Event` — one organizer owns many events.
- `Event` → `Session` — one event has many sessions.
- `Session` → `Registration` — one session has many registrations.
- `Session` → `CapacityAlert` — one session accumulates many alert rows
  over its lifetime (one per trigger/dismiss cycle — see §3).
- `Registration` → `RegistrationTimeline` — one registration has many
  timeline entries (one per status transition, plus the creation row).
- `User` → `Registration` (`createdBy`) — one staff/organizer creates many
  registrations on attendees' behalf (nullable — self-service rows have no
  creator).
- `User` → `RegistrationTimeline` (`actor`) — one user performs many
  transitions (nullable — system actions like auto-expiry have no actor).
- `User` → `CapacityAlert` (`dismissedBy`) — one user dismisses many
  alerts over time.

**M:N**
- `User` (Check-in Staff) ↔ `Session`, through `SessionAssignment`. This is
  the only genuine many-to-many in the schema: a staff member can be
  assigned to multiple sessions, and a session can have multiple staff
  assigned. The join table carries its own data (`assignedAt`,
  `assignedById`) rather than being a bare pivot, which is also why it's a
  real Prisma model instead of an implicit `@relation` — Prisma's implicit
  M:N syntax can't carry extra columns.

There is deliberately no M:N between `Registration` and anything —
each registration belongs to exactly one session and represents exactly
one attendee; the "many attendees per session" relationship is already
fully expressed by `Registration`'s 1:N to `Session`.

## 3. Denormalization rationale

Two deliberate denormalizations, and one deliberate *non*-denormalization:

**`CapacityAlert.currentCount` / `.capacity` are snapshots, not
references.** An alert row could instead just store `sessionId` and let
readers join to `Session.capacity` for the "current" number. Snapshotting
was chosen because an alert is a historical fact — "this session hit
3/3 at 2:14pm" — and if an organizer edits a session's capacity afterward
(say, moves it from 3 to 5), a live join would silently rewrite history,
making a past alert read as "hit 3/5" which never happened. The audit/
reporting value of "what did capacity look like at the moment this
triggered" outweighs the small storage cost of two extra integers per row.

**`RegistrationTimeline` duplicates `oldStatus`/`newStatus` that could be
reconstructed by diffing consecutive rows.** Storing both explicitly (vs.
just `newStatus` and inferring `oldStatus` from the previous row) makes
every timeline row independently readable and correct even if a future
migration needs to backfill or the table is ever queried out of order —
worth the marginal duplication for an append-only audit table that exists
specifically to be trustworthy in isolation.

**What was *not* denormalized: occupied-seat count is never cached on
`Session`.** The obvious optimization — a `Session.occupiedCount` column,
incremented/decremented alongside every registration write — was
considered and rejected. It would save a `COUNT(*)` query on every read,
but it turns "is this count correct" into a distributed-invariant problem:
every code path that touches `Registration.status` (there are several:
`reserveSeat`, `updateRegistrationStatus`, `expireStaleReservations`, the
lazy-expiry sweep) would have to remember to keep the cached column in
sync, and a single missed spot silently desyncs capacity enforcement — the
one number in this whole system that absolutely cannot drift. Computing it
fresh via an indexed `COUNT(*) WHERE sessionId = ? AND status IN (...)`
inside the same locked transaction is slightly more DB work per write and
categorically safer. See `docs/decisions.md` #2 for the same trade-off
applied to `CapacityAlert`'s "active" state.

## 4. What would fail at 100x scale

Baseline assumption: this was sized for maybe a few hundred sessions and
tens of thousands of registrations total (a mid-size multi-day conference).
100x that is on the order of tens of thousands of sessions and several
million registrations. At that scale:

- **`SELECT ... FOR UPDATE` on a single hot Session row.** Fine today
  because no single session sees more than a few hundred concurrent
  reservation attempts. At 100x, a single wildly popular session (a
  free-registration keynote everyone wants) could see thousands of
  concurrent requests all blocking on the same row lock, serializing what
  should be parallel work. Fix: a pre-allocated seat-token queue or an
  atomic `UPDATE sessions SET seats_taken = seats_taken + 1 WHERE
  seats_taken < capacity RETURNING id` pattern that fails fast without
  holding a lock across the rest of the reservation logic, moving the
  duplicate-email check and insert outside the critical section.
- **`getSessionBreakdown()` in `dashboardService.ts`.** Currently loads
  *every* registration for *every* session into Node and tallies status
  counts in JavaScript. Fine at thousands of rows; at millions, this is a
  multi-second query pulling megabytes over the wire for a dashboard that's
  supposed to load instantly. Fix: a `GROUP BY sessionId, status` query (or
  a materialized rollup table refreshed on a schedule) instead of
  row-by-row JS aggregation.
- **Offset pagination in `searchService.ts`.** `skip`/`take` requires
  Postgres to scan and discard every row before the offset. Fine for page
  1–20 of a few thousand results; page 5,000 of a few million rows becomes
  a slow, ever-degrading query. Fix: cursor-based (keyset) pagination —
  `WHERE (reservedAt, id) < (lastSeenReservedAt, lastSeenId) ORDER BY
  reservedAt DESC LIMIT n` — which stays fast regardless of how deep the
  page is.
- **`bulkImportRegistrations()`'s one-transaction-per-row loop.** A
  500-row CSV (typical) is fine at roughly one round trip per row. A
  50,000-row CSV (100x) sequentially awaiting each `reserveSeat()` call
  would take minutes and hold the session lock/release cycle thousands of
  times. Fix: batch-validate all rows first (format + in-file duplicates),
  then a single transaction per session that locks once, does one bulk
  `createMany`, and reports capacity/duplicate rejections computed against
  a single fresh count — trading the current "every row independently
  correct even under concurrent interactive reservations" guarantee for
  throughput, which is the right trade for a bulk path specifically.
- **`RegistrationTimeline` as one ever-growing table.** Still correctly
  indexed at 100x (`(registrationId, timestamp)` keeps single-registration
  lookups fast regardless of table size), but full-table analytics or
  exports over the whole timeline would benefit from monthly partitioning
  and an archival policy for events long past — not a correctness problem,
  a maintenance one.
- **`expireStaleReservations()`'s fixed batch size (200/run).** At 100x
  registration volume, more than 200 reservations could go stale within a
  single one-minute cron tick, meaning the sweep falls permanently behind.
  This is the one place the lazy-expiry path (`docs/decisions.md` #4)
  becomes load-bearing rather than a backstop — since every hot code path
  already self-heals stale rows on access, a slow batch sweep degrades
  gracefully instead of causing incorrect capacity counts; it would still
  need a larger batch size or a set-based `UPDATE ... WHERE ... RETURNING`
  instead of per-row transactions to catch back up.
