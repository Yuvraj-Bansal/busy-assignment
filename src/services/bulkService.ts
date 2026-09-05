// src/services/bulkService.ts
//
// CSV import and export for a session's roster. Import deliberately reuses
// `reserveSeat()` per row rather than reimplementing capacity/duplicate
// logic — that keeps bulk imports subject to the exact same row-locked
// capacity check and duplicate-email check as a single interactive
// reservation, with zero risk of the two code paths drifting apart. The
// trade-off is one small transaction per row instead of one big batch
// transaction; for typical CSV sizes (hundreds of rows) this is more than
// fast enough, and it means a failure on row 40 can never roll back the 39
// good rows before it.

import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";
import { stringify, type Stringifier } from "csv-stringify";
import { prisma } from "../lib/prisma";
import { assertSessionAccess } from "../lib/permissions";
import type { SessionUser } from "../lib/auth";
import {
  reserveSeat,
  isValidEmailFormat,
} from "./registrationService";
import {
  NotFoundError,
  ValidationError,
  DuplicateRegistrationError,
  CapacityExceededError,
} from "../lib/errors";

// ----------------------------------------------------------------------
// CSV Import
// ----------------------------------------------------------------------

export type BulkImportRowStatus = "CREATED" | "DUPLICATE" | "INVALID" | "CAPACITY_REACHED";

export type BulkImportRowResult = {
  rowNumber: number; // 1-indexed against the file, header counted as row 1
  email: string;
  status: BulkImportRowStatus;
  reason?: string;
};

export type BulkImportReport = {
  totalRows: number;
  created: number;
  duplicate: number;
  invalid: number;
  capacityReached: number;
  rows: BulkImportRowResult[];
};

/**
 * Imports attendees from a CSV buffer (expected columns: `name`, `email` —
 * header matching is case-insensitive and whitespace-trimmed). Every row is
 * processed independently and the loop never aborts early: a row that fails
 * validation, is a duplicate, or hits capacity is recorded in the report and
 * processing continues, so valid rows earlier *and later* in the file are
 * still created. Only a genuinely unexpected error (not one of the known,
 * per-row failure modes) aborts the whole import.
 */
export async function bulkImportRegistrations(
  sessionId: string,
  csvBuffer: Buffer,
  actorUser: SessionUser
): Promise<BulkImportReport> {
  await assertSessionAccess(actorUser, sessionId);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) throw new NotFoundError("Session not found.");

  let records: Record<string, string>[];
  try {
    records = parse(csvBuffer, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw new ValidationError(`Could not parse CSV file: ${(err as Error).message}`);
  }

  const rows: BulkImportRowResult[] = [];

  for (let i = 0; i < records.length; i++) {
    const rowNumber = i + 2; // +1 for 0-index, +1 because the header is row 1
    const record = records[i] ?? {};
    const name = (record.name ?? "").trim();
    const email = (record.email ?? "").trim();

    if (!name || !email || !isValidEmailFormat(email)) {
      rows.push({
        rowNumber,
        email,
        status: "INVALID",
        reason: !name
          ? "Missing name"
          : !email
          ? "Missing email"
          : "Malformed email address",
      });
      continue;
    }

    try {
      await reserveSeat(sessionId, name, email, actorUser);
      rows.push({ rowNumber, email, status: "CREATED" });
    } catch (err) {
      if (err instanceof DuplicateRegistrationError) {
        rows.push({ rowNumber, email, status: "DUPLICATE", reason: err.message });
      } else if (err instanceof CapacityExceededError) {
        rows.push({ rowNumber, email, status: "CAPACITY_REACHED", reason: err.message });
      } else if (err instanceof ValidationError) {
        rows.push({ rowNumber, email, status: "INVALID", reason: err.message });
      } else {
        // Not one of the expected per-row outcomes — surface it rather than
        // silently mislabeling an unrelated bug as a bad CSV row.
        throw err;
      }
    }
  }

  return {
    totalRows: rows.length,
    created: rows.filter((r) => r.status === "CREATED").length,
    duplicate: rows.filter((r) => r.status === "DUPLICATE").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    capacityReached: rows.filter((r) => r.status === "CAPACITY_REACHED").length,
    rows,
  };
}

// ----------------------------------------------------------------------
// CSV Export
// ----------------------------------------------------------------------

const EXPORT_COLUMNS = ["Name", "Email", "Status", "Reserved At", "Checked In At"];
const EXPORT_PAGE_SIZE = 500;

/**
 * Streams a session's roster as CSV (Name, Email, Status, Reserved At,
 * Checked In At). Returns a Node `Stringifier` (a Transform stream) rather
 * than a fully-materialized string/buffer, and pages through the
 * registrations table in chunks of `EXPORT_PAGE_SIZE` rather than loading
 * the whole roster into memory — so this scales to large sessions without a
 * memory spike.
 *
 * Route handler usage (Next.js Route Handler returning a streamed download):
 *
 *   const csvStream = await exportSessionRosterCsvStream(sessionId, user);
 *   return new Response(Readable.toWeb(csvStream) as ReadableStream, {
 *     headers: {
 *       "Content-Type": "text/csv",
 *       "Content-Disposition": `attachment; filename="roster-${sessionId}.csv"`,
 *     },
 *   });
 */
export async function exportSessionRosterCsvStream(
  sessionId: string,
  actorUser: SessionUser
): Promise<Stringifier> {
  await assertSessionAccess(actorUser, sessionId);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) throw new NotFoundError("Session not found.");

  const stringifier = stringify({ header: true, columns: EXPORT_COLUMNS });

  // Fire-and-forget pump: pulls pages from the DB and writes rows into the
  // stringifier as they arrive. Errors are routed onto the stream itself
  // (via destroy) so the consumer's normal stream error handling catches
  // them, rather than becoming an unhandled promise rejection.
  void (async () => {
    try {
      let cursor: string | undefined;
      for (;;) {
        const page = await prisma.registration.findMany({
          where: { sessionId },
          orderBy: { id: "asc" },
          take: EXPORT_PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (page.length === 0) break;

        for (const r of page) {
          stringifier.write([
            r.attendeeName,
            r.attendeeEmail,
            r.status,
            r.reservedAt.toISOString(),
            r.checkedInAt ? r.checkedInAt.toISOString() : "",
          ]);
        }

        cursor = page[page.length - 1]!.id;
        if (page.length < EXPORT_PAGE_SIZE) break;
      }
      stringifier.end();
    } catch (err) {
      stringifier.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return stringifier;
}

// Re-exported so callers that only imported bulkService still have access
// to the stream type without reaching into csv-stringify directly.
export type { Stringifier };
export { Readable };
