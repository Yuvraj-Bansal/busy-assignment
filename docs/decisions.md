# Architectural Decisions

Five decisions made during this build, the alternatives considered for
each, and why the chosen option won. #4 is a decision that was reversed
mid-project — included because it's the most instructive one, not despite
being a reversal.

---

## 1. Row locking for capacity enforcement: pessimistic `FOR UPDATE`, not `SERIALIZABLE`

**Decision**: `reserveSeat` and `updateRegistrationStatus` take a
`SELECT ... FOR UPDATE` lock on the contended row inside a `ReadCommitted`
transaction.

**Alternatives considered**:
- **`SERIALIZABLE` isolation, optimistic-retry.** Postgres detects the
  conflict at commit time and aborts one of the two transactions with a
  `40001` serialization failure; the caller catches that and retries.
- **Application-level optimistic locking** — a `version` integer column on
  `Session`, incremented on every write, with the update conditioned on
  `WHERE version = $expectedVersion` and a retry loop on 0-rows-affected.

**Rationale**: A single popular session (a free keynote everyone wants) can
see many concurrent reservation attempts against the *same* row in a short
window. Under `SERIALIZABLE`, that's many transactions racing to commit and
most of them aborting and retrying — throughput degrades as contention
increases, and the retry logic has to live in every caller. Under
`FOR UPDATE`, the same burst just queues on one lock and processes
sequentially — slower in the worst case for a single request, but
predictable, and correctness doesn't depend on every call site remembering
to implement a retry loop. The optimistic `version`-column approach was
rejected for the same reason as `SERIALIZABLE`: it pushes retry logic to
the caller for a pattern (many writers, one hot row, short critical
section) that pessimistic locking handles more simply.

**Trade-off accepted**: `FOR UPDATE` serializes *all* writes to a session,
even ones that wouldn't actually conflict (e.g., two different attendees'
reservations do conflict on capacity, but a reservation and an unrelated
read don't need to block each other — and in this design, none of the
reads that matter, like the capacity count, happen outside the lock
anyway). At the scale this was built for, that's the right trade; see
`docs/schema.md` "what would fail at 100x" for where it stops being one.

---

## 2. Capacity alerts as an append-only log, not a mutable "is this session alerting" flag

**Decision**: `CapacityAlert` rows are created (never updated except to
flip `status: ACTIVE → DISMISSED`) — a session that crosses capacity,
gets dismissed, and crosses capacity again produces *two* rows, not one
row toggled twice.

**Alternatives considered**:
- **A single `Session.isAtCapacity: boolean` + `dismissedAt` pair**,
  updated in place.
- **A single `CapacityAlert` row per session** (not per trigger event),
  with `triggeredAt` overwritten on re-trigger.

**Rationale**: The brief requires re-triggering to be observable ("if
capacity drops below max and later fills back up, the alert must
re-trigger"), and an organizer reasonably wants to know a session hit
capacity *twice* during the event, not just that it's currently at
capacity. A boolean flag or an overwritten single row can't answer "how
many times did this happen" or "who dismissed the first one and when" —
both real questions in a post-event report. The append-only design answers
them for free, since nothing is ever destroyed.

**Trade-off accepted**: Slightly more complex query to find "the current
alert state" (`WHERE sessionId = ? AND status = 'ACTIVE'` instead of a
direct column read) — mitigated by the partial unique index in
`prisma/migrations_manual/001_extra_constraints.sql`, which guarantees
that query is looking for at most one row.

---

## 3. Bulk CSV import reuses `reserveSeat()` per row instead of a dedicated batch path

**Decision**: `bulkImportRegistrations()` calls the exact same
`reserveSeat()` function the interactive "reserve a seat" flow uses, once
per valid CSV row, rather than implementing separate batch-aware capacity
and duplicate-checking logic.

**Alternatives considered**:
- **A dedicated batch path**: validate all rows, then run one transaction
  that locks the session once, counts remaining capacity, and inserts
  as many rows as fit via a single `createMany`.

**Rationale**: Two implementations of "check capacity, check duplicate,
insert" is two places for that logic to drift apart over time — a bug fix
or a rule change (e.g., "duplicate check should also consider phone
number") would need to land in both. Reusing `reserveSeat()` guarantees a
bulk import is *exactly* as correct as a single interactive reservation,
by construction, with zero duplicated logic. It also means a CSV import
running at the same moment as someone reserving through the UI is
automatically race-safe against them, for free — they're both just calls
to the same locked function.

**Trade-off accepted**: One small transaction per CSV row instead of one
transaction for the whole file — more round trips, and therefore slower
for very large files. `docs/schema.md`'s 100x-scale section flags this as
the first thing to change (batch-validate, then bulk-insert) if import
volume ever justified reimplementing the dedicated batch path this
decision avoided. That's an intentional "revisit if it becomes true"
deferral, not an oversight.

---

## 4. Reversed: expiry started as cron-only, became lazy-evaluation-plus-sweep — and the lazy path itself was reversed once more

**Original decision**: rely entirely on `expireStaleReservations()`, a
scheduled job run once a minute, to flip stale `RESERVED` rows to
`EXPIRED`.

**Why it was reversed**: `docs/BUSINESS_LOGIC.md` was written on Day 2
already describing a *hybrid* design — lazy expiry on read/write, plus the
cron sweep as a backstop — because a cron-only approach has an obvious
window problem: a reservation can lapse at 2:14:00 and not get swept until
2:15:00, and anything that touches it in that 60-second gap (someone
confirming it, someone else trying to register with the same email, a
capacity count) sees a `RESERVED` row that is, in every way that matters,
already dead. But on Day 6, writing `docs/decisions.md` against the actual
code (not the plan) surfaced that only the cron half had ever been
implemented — `reserveSeat`'s capacity count and duplicate-email check
still trusted `status = 'RESERVED'` at face value, with no `expiresAt`
check. The fix (added on Day 6, described here rather than hidden): a
`lazilyExpireStaleForSession()` sweep runs inside `reserveSeat`'s existing
session lock before counting/duplicate-checking, and
`updateRegistrationStatus` lazily expires the target row before validating
the requested transition.

**A second, smaller reversal inside that fix**: the first attempt put the
lazy-expiry check for `updateRegistrationStatus` *inside* the same
transaction as the requested transition. That's wrong: if someone tries to
`CONFIRM` a registration that turns out to be stale, the lazy step expires
it and then `assertLegalTransition` correctly rejects `EXPIRED → CONFIRMED`
— but throwing inside that transaction rolls back *everything*, including
the expiry write, leaving the row exactly as broken as before the fix. The
corrected version splits this into two transactions: one that lazily
expires and *always* commits, and a second, independent one that attempts
the actually-requested transition against whatever status is current now.
This is also the concrete example logged in `docs/ai-prompts.md`.

**Rationale for the final design**: lazy evaluation closes the correctness
gap (nothing ever acts on a stale `RESERVED` row without noticing it's
stale first) without removing the cron sweep, which still matters for
reservations nobody ever revisits — an expired reservation that no one
confirms, cancels, or bumps into during a search will sit as `RESERVED`
forever without it. Neither mechanism alone is sufficient; together they
are.

---

## 5. Auth: NextAuth v5 with a hand-rolled `SessionUser` abstraction, not NextAuth types used directly

**Decision**: `src/lib/auth.ts` is the only file in the codebase that
imports from `next-auth`. Every other module — `permissions.ts`, all four
services, every page and Server Action — only ever sees a small
hand-defined `SessionUser` type (`{ id, name, email, role }`) and two
functions, `getCurrentUser()` / `requireUser()`.

**Alternatives considered**:
- **Use NextAuth's `Session["user"]` type directly everywhere** —
  simpler, one less abstraction layer, no risk of the wrapper type drifting
  from what NextAuth actually returns.
- **Lucia**, evaluated directly instead of NextAuth, since the brief
  explicitly allowed either.

**Rationale**: The brief itself frames auth as "NextAuth / Lucia" — an
either/or choice, which was read as a signal that the choice of library
mattered less than getting RBAC right. Isolating that choice behind
`SessionUser` means `registrationService.ts` (the highest-value, most
carefully-reviewed file in the project) has zero NextAuth-specific code in
it, and swapping to Lucia later is a one-file change, not a project-wide
refactor. NextAuth was picked over Lucia specifically for its
Credentials-provider + JWT-session combination requiring the least custom
code to match this project's email/password + two-role requirement — Lucia
would have meant hand-rolling more of the session-cookie machinery for no
extra benefit at this scale.

**Trade-off accepted**: A small amount of mapping boilerplate in
`getCurrentUser()` (translating NextAuth's session shape into
`SessionUser`) that a direct-usage approach wouldn't need. Judged worth it
the moment `permissions.ts` and every service could be written, read, and
tested without knowing NextAuth exists.
