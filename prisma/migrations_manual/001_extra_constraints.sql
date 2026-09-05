-- ============================================================================
-- SUPPLEMENTARY DB-LEVEL CONSTRAINTS
-- ============================================================================
-- Run this AFTER `prisma migrate dev` has created the base tables from
-- schema.prisma. These are constraints Prisma's schema language cannot
-- express declaratively (CHECK constraints, partial/filtered unique indexes,
-- and role-level GRANT/REVOKE). Add this file's contents as the body of a
-- Prisma migration via:
--
--   npx prisma migrate dev --create-only --name extra_constraints
--   # then paste this file's contents into the generated migration.sql
--
-- ============================================================================

-- 1. Session capacity must be a positive integer.
-- [DB] Belt-and-suspenders alongside the application-layer validation on the
-- create/update Session form.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_capacity_positive" CHECK ("capacity" > 0);

-- 2. A session can never have more than one ACTIVE (undismissed) capacity
-- alert at the same time — even under concurrent triggering requests.
-- [DB] This is the hard guarantee behind the "re-trigger" business rule:
-- the app layer's "check-then-insert" logic is racy on its own; this index
-- makes a duplicate ACTIVE row a constraint violation instead of a silent bug.
CREATE UNIQUE INDEX "capacity_alerts_one_active_per_session"
  ON "capacity_alerts" ("sessionId")
  WHERE "status" = 'ACTIVE';

-- 3. (Optional, recommended) Prevent duplicate *active* registrations for the
-- same attendee email within the same session at the DB level, on top of the
-- application-layer check inside the locked transaction. CANCELLED/EXPIRED
-- registrations are excluded so re-registration after cancellation is allowed.
CREATE UNIQUE INDEX "registrations_one_active_per_email_per_session"
  ON "registrations" ("sessionId", "attendeeEmail")
  WHERE "status" IN ('RESERVED', 'CONFIRMED', 'CHECKED_IN');

-- 4. Immutable audit trail: revoke UPDATE and DELETE on the timeline table
-- for the application's runtime DB role, so the "append-only" rule is a DB
-- guarantee rather than just an application convention.
-- Replace `app_user` with your actual Postgres role used by the Next.js app
-- (i.e. the role encoded in DATABASE_URL). Do NOT run this as the same role
-- Prisma Migrate uses to run migrations (that role needs full DDL rights).
--
-- REVOKE UPDATE, DELETE ON "registration_timeline" FROM app_user;
-- GRANT INSERT, SELECT ON "registration_timeline" TO app_user;
--
-- (Commented out by default since the runtime role name is environment-
-- specific — uncomment and adjust once your DB roles are provisioned.)
