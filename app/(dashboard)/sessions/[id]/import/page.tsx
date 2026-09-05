// app/(dashboard)/sessions/[id]/import/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/src/lib/auth";
import { assertSessionAccess } from "@/src/lib/permissions";
import { prisma } from "@/src/lib/prisma";
import { ForbiddenError } from "@/src/lib/errors";
import { ImportForm } from "@/components/import/ImportForm";

export const dynamic = "force-dynamic";

export default async function SessionImportPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const session = (await prisma.session.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, capacity: true, event: { select: { name: true } } },
  })) as { id: string; title: string; capacity: number; event: { name: string } } | null;
  if (!session) notFound();

  try {
    await assertSessionAccess(user, session.id);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-xl rounded border border-danger/30 bg-danger-tint p-6 text-sm text-danger">
          {err.message}
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/registrations"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to registrations
      </Link>

      <div>
        <h2 className="text-xl font-semibold text-ink">Import attendees</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {session.title} · {session.event.name} · capacity {session.capacity}
        </p>
      </div>

      <ImportForm sessionId={session.id} />
    </div>
  );
}
