// app/(dashboard)/registrations/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/src/lib/auth";
import {
  updateRegistrationStatus,
  dismissCapacityAlert,
} from "@/src/services/registrationService";
import { AppError } from "@/src/lib/errors";
import type { RegistrationStatus } from "@prisma/client";

/**
 * Every Server Action here returns this shape instead of throwing across
 * the client/server boundary — `AppError`s (Forbidden, InvalidTransition,
 * CapacityExceeded, ...) become a plain `{ ok: false, message }` the UI can
 * render inline next to the button that was clicked. A genuinely
 * unexpected error still throws, surfacing as Next's error boundary rather
 * than being mislabeled as a normal rejection.
 */
export type ActionResult = { ok: true } | { ok: false; message: string };

async function transition(
  registrationId: string,
  newStatus: RegistrationStatus,
  note?: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await updateRegistrationStatus(registrationId, newStatus, user, note);
    revalidatePath("/registrations");
    revalidatePath(`/registrations/${registrationId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function confirmRegistrationAction(registrationId: string): Promise<ActionResult> {
  return transition(registrationId, "CONFIRMED");
}

export async function checkInRegistrationAction(registrationId: string): Promise<ActionResult> {
  return transition(registrationId, "CHECKED_IN");
}

export async function cancelRegistrationAction(
  registrationId: string,
  reason?: string
): Promise<ActionResult> {
  return transition(registrationId, "CANCELLED", reason);
}

export async function dismissAlertAction(alertId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await dismissCapacityAlert(alertId, user);
    revalidatePath("/dashboard");
    revalidatePath("/registrations");
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
}
