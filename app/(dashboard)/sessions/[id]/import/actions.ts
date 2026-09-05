// app/(dashboard)/sessions/[id]/import/actions.ts
"use server";

import { requireUser } from "@/src/lib/auth";
import { bulkImportRegistrations, type BulkImportReport } from "@/src/services/bulkService";
import { AppError } from "@/src/lib/errors";
import { revalidatePath } from "next/cache";

export type ImportActionResult =
  | { ok: true; report: BulkImportReport }
  | { ok: false; message: string };

export async function importCsvAction(
  sessionId: string,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const user = await requireUser();

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, message: "Choose a CSV file to upload." };
    }
    if (file.size === 0) {
      return { ok: false, message: "The selected file is empty." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const report = await bulkImportRegistrations(sessionId, buffer, user);

    revalidatePath("/registrations");
    revalidatePath("/dashboard");

    return { ok: true, report };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
}
