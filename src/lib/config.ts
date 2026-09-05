// src/lib/config.ts
//
// Centralizes environment-driven tuning values so business logic never
// reads process.env directly (makes it trivially testable/mockable).

/** Minutes a RESERVED registration is held before it's eligible for auto-expiry. [APP] */
export const RESERVATION_EXPIRY_MINUTES = Number(
  process.env.RESERVATION_EXPIRY_MINUTES ?? 15
);

/** Max number of stale reservations expired per invocation of the cron job, to bound transaction/lock time. */
export const EXPIRE_BATCH_SIZE = Number(process.env.EXPIRE_BATCH_SIZE ?? 200);

/** Default and max page sizes for server-side search, to prevent unbounded queries. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
