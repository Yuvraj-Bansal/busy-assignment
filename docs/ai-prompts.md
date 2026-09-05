# AI Prompt Log

This project was built in conversation with Claude (Anthropic), working
turn-by-turn through data modeling, backend services, and frontend. Below
is the prompt log grouped by task, followed by one detailed
correction — an AI-authored state machine that hallucinated a transition
the brief explicitly forbids, and how it was caught.

## 1. Data modeling

- *"You are an expert full-stack engineer... produce the complete,
  exhaustive `schema.prisma` file covering Users, Events, Sessions,
  SessionAssignments, Registrations, RegistrationTimeline, and
  CapacityAlerts... include brief inline comments explaining which
  constraints live in the DB vs. the application layer."*
- *"Provide the database seed script with realistic sample events,
  past/present sessions, staff assignments, and registrations across all
  statuses."*

**Outcome**: schema, a manual-SQL migration for the constraints Prisma's
schema DSL can't express (CHECK, partial unique indexes, REVOKE on the
audit table), and a seed script deliberately constructed to exercise every
status and a re-triggered alert. No corrections needed here — the
`[DB]`/`[APP]` inline-comment convention proposed in the first response was
kept for the rest of the project.

## 2. Setup / process

- *"Tell me steps to run which file and which to commit in what order
  sequence."*

**Outcome**: an ordered setup walkthrough (install → git init → env →
schema+migrate → manual constraints → generate → seed) plus two things not
asked for but flagged proactively: a missing `.gitignore`, and the
distinction between committing `schema.prisma` vs. committing the
generated `prisma/migrations/` folder (only the latter is what other
environments actually replay).

## 3. Backend services (concurrency + RBAC)

- *"Generate the core backend engine ensuring bulletproof concurrency and
  access control"* — `auth.ts`, `permissions.ts`, and
  `registrationService.ts` with `reserveSeat`, `updateRegistrationStatus`,
  `expireStaleReservations`, and capacity alert trigger/dismissal logic.

**Outcome**: this is where the state-machine hallucination happened — see
§5 below for the full story.

## 4. Bulk operations, search

- *"Implement the bulk operations, search, and CSV processing modules"* —
  `bulkService.ts` (CSV import with a per-row report, streaming CSV
  export) and `searchService.ts` (paginated, RBAC-scoped search).

**Outcome**: the decision to have CSV import call `reserveSeat()` per row
instead of a separate batch implementation (`docs/decisions.md` #3) came
out of this conversation — proposed as the default rather than something
the person had to ask for, on the reasoning that two implementations of
the same capacity/duplicate logic is a drift risk.

## 5. Frontend

- *"Generate the Next.js App Router pages and components with clean
  Tailwind CSS UI"* — the `(dashboard)` layout, dashboard metrics/chart,
  registrations list/detail, and CSV import pages.

**Outcome**: design tokens (color palette, IBM Plex Sans/Mono type pairing,
flat left-border metric cards instead of uniform shadow cards) were
proposed unprompted as a deliberate departure from generic AI-dashboard
defaults, then implemented directly — no back-and-forth needed since the
brief left visual direction open.

## 6. Documentation

- *"Generate the complete markdown files for the docs/ folder based on the
  implementation decisions we made"* — this file, plus `architecture.md`,
  `schema.md`, `plan.md`, `decisions.md`, and `SUBMISSION.md`.

**Outcome**: writing `decisions.md` against the *actual* code (rather than
from memory of what was planned) is what surfaced that the lazy-expiry
half of the design described in `BUSINESS_LOGIC.md` back on Day 2 had
never been implemented — fixed on the spot in `registrationService.ts`
rather than documented as if it existed. See `docs/decisions.md` #4 for
the full account.

---

## Detailed correction: a hallucinated transition that violated an explicit rule

**What happened.** While drafting the `ALLOWED_TRANSITIONS` table inside
`registrationService.ts`, an early version of the response included:

```ts
const ALLOWED_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  RESERVED:   ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED:  ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["CANCELLED"], // <- hallucinated
  CANCELLED:  [],
  EXPIRED:    [],
};
```

The reasoning offered alongside it was plausible-sounding on its own:
*"an organizer should be able to undo an accidental check-in, so
Checked In should allow a transition back to Cancelled."* That's a
reasonable feature for *some* event-registration systems in the abstract —
which is exactly the problem: it wasn't reasoning from this project's
brief, it was reasoning from a generic mental model of "what registration
systems usually let you do," and it directly contradicts a rule stated in
plain language in the original prompt: *"Cannot cancel once Checked In."*

**How it was caught.** Cross-checking the drafted transition table line by
line against the brief's explicit lifecycle rules (rather than against
"does this look like a reasonable state machine") is what caught it —
`CHECKED_IN: ["CANCELLED"]` has no textual basis in the brief and
contradicts a sentence in it directly.

**The fix**: `CHECKED_IN: []` — a genuinely terminal state, with the
transition-rejection error message written to name the rule explicitly
rather than just say "invalid transition":

```ts
if (from === "CHECKED_IN") {
  throw new InvalidTransitionError(
    "This attendee has already been checked in and cannot be cancelled or otherwise modified."
  );
}
```

**Why this is worth logging.** The specific failure mode — filling a gap
in an explicit spec with a plausible-sounding general convention instead
of flagging the gap — is exactly the kind of error that's easy to miss in
review, because the added code is well-formed, sensibly commented, and
individually defensible. It reads as correct engineering judgment right up
until you check it against the one sentence in the brief that rules it
out. The mitigation that generalizes: for anything touching the state
machine or capacity rules specifically, verify every transition/constraint
against the brief's literal wording before accepting it, not against
whether it seems like reasonable system design in general.
