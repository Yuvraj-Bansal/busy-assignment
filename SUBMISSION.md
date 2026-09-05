# Submission

## Links

| | |
|---|---|
| **Live URL** | `<fill in — e.g. https://your-app.vercel.app>` |
| **Repository URL** | `<fill in — e.g. https://github.com/your-org/event-registration>` |
| **Demo video (optional)** | `<fill in, if applicable>` |

## Demo accounts

Seeded by `prisma/seed.ts` — all seed users share the password
`Password123!` (see `.env.example` for where the seed reads its config,
and `README.md` for how to run the seed).

| Role | Name | Email | Notes |
|---|---|---|---|
| Organizer | Aditi Sharma | `aditi.organizer@eventreg.dev` | Full access — dashboard, all registrations, both seeded events |
| Organizer | Rohan Mehta | `rohan.organizer@eventreg.dev` | Owns the past "DevCraft Workshop Series" event |
| Check-in Staff | Neha Kapoor | `neha.staff@eventreg.dev` | Assigned to the Keynote and the at-capacity Workshop session — use this account to see the alert badge and capacity-reached behavior |
| Check-in Staff | Vikram Singh | `vikram.staff@eventreg.dev` | Assigned only to the Panel session — use this account to confirm RBAC scoping (registrations for other sessions are inaccessible) |
| Check-in Staff | Priya Nair | `priya.staff@eventreg.dev` | Assigned to both past DevCraft sessions — use this account to see historical Checked In / Cancelled / Expired data |

`<fill in — replace with production credentials if these differ from the
seed data on the deployed environment, or note "seed data as shipped" if
they match>`

## What to check first

A short reviewer path through the seeded data, in order:

1. **Sign in as Neha Kapoor** (Check-in Staff) → the top-nav bell should
   show an active alert for "Hands-on Workshop: Building with LLMs"
   (seeded at exactly 3/3 capacity, re-triggered after a cancel+refill —
   see `docs/decisions.md` #2).
2. Go to **Registrations**, filter by that session → confirm/cancel/check-in
   buttons should only render for statuses where that transition is legal
   (nothing on a Cancelled or Expired row).
3. Open a **Reserved** registration's detail page → the timeline should
   show a single "Created" entry with no actor for self-service rows, and
   a named actor for staff-created ones.
4. **Sign in as Vikram Singh** (Check-in Staff, assigned only to the
   Panel) → confirm the Workshop/Keynote registrations from step 2 are no
   longer visible or actionable (403 on direct access).
5. **Sign in as Aditi Sharma** (Organizer) → open **Dashboard** → the
   "Sessions at capacity" metric should read 1 (the Workshop), and the
   14-day check-in chart should show activity from the seeded past
   DevCraft sessions.
6. On any assigned session, try **Import attendees** with a small CSV
   (`name,email` columns) including one duplicate of an existing attendee
   and one malformed email — confirm the per-row report correctly labels
   `CREATED` / `DUPLICATE` / `INVALID`.

## Known gaps

See `docs/architecture.md` §4 (out of scope) and `docs/plan.md` ("what got
cut to stay in budget") for the complete, honest list — notably: no
event/session creation UI yet (seed-only), no automated test suite, and
`/login` has no working form (NextAuth's Credentials provider is wired up
in `src/lib/auth.ts` but nothing calls `signIn()` from the UI yet).

`<fill in — add anything specific to your deployment: known issues with
the hosting provider, database connection limits on the free tier, etc.>`
