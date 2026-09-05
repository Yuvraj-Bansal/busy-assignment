// components/registrations/QuickActionButtons.tsx
"use client";

import { useState, useTransition } from "react";
import type { RegistrationStatus } from "@prisma/client";
import {
  confirmRegistrationAction,
  checkInRegistrationAction,
  cancelRegistrationAction,
} from "@/app/(dashboard)/registrations/actions";
import { Button } from "@/components/ui/Button";

/**
 * Which actions are even offered for a given status — mirrors the state
 * machine in registrationService.ts (RESERVED -> CONFIRMED -> CHECKED_IN;
 * RESERVED/CONFIRMED -> CANCELLED). Buttons for illegal transitions simply
 * aren't rendered, rather than being rendered-then-disabled, since there's
 * no legitimate reason a user would need to see a Check In button on an
 * already-Cancelled registration. The server is still the actual
 * enforcement point (see registrationService.assertLegalTransition) —
 * this is a UX convenience, not the source of truth.
 */
function availableActions(status: RegistrationStatus): Array<"CONFIRM" | "CHECK_IN" | "CANCEL"> {
  switch (status) {
    case "RESERVED":
      return ["CONFIRM", "CANCEL"];
    case "CONFIRMED":
      return ["CHECK_IN", "CANCEL"];
    default:
      return [];
  }
}

export function QuickActionButtons({
  registrationId,
  status,
  size = "sm",
}: {
  registrationId: string;
  status: RegistrationStatus;
  size?: "sm" | "md";
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = availableActions(status);
  if (actions.length === 0) return <span className="text-xs text-ink-faint">No actions available</span>;

  function run(action: "CONFIRM" | "CHECK_IN" | "CANCEL") {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      const result =
        action === "CONFIRM"
          ? await confirmRegistrationAction(registrationId)
          : action === "CHECK_IN"
          ? await checkInRegistrationAction(registrationId)
          : await cancelRegistrationAction(registrationId);

      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1.5">
        {actions.includes("CONFIRM") && (
          <Button
            variant="primary"
            size={size}
            onClick={() => run("CONFIRM")}
            disabled={isPending}
          >
            {isPending && pendingAction === "CONFIRM" ? "Confirming…" : "Confirm"}
          </Button>
        )}
        {actions.includes("CHECK_IN") && (
          <Button
            variant="primary"
            size={size}
            onClick={() => run("CHECK_IN")}
            disabled={isPending}
          >
            {isPending && pendingAction === "CHECK_IN" ? "Checking in…" : "Check in"}
          </Button>
        )}
        {actions.includes("CANCEL") && (
          <Button
            variant="danger"
            size={size}
            onClick={() => run("CANCEL")}
            disabled={isPending}
          >
            {isPending && pendingAction === "CANCEL" ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
