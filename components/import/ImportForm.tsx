// components/import/ImportForm.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { UploadCloud, FileText } from "lucide-react";
import { importCsvAction, type ImportActionResult } from "@/app/(dashboard)/sessions/[id]/import/actions";
import { Button } from "@/components/ui/Button";
import { ImportResultsTable } from "@/components/import/ImportResultsTable";

export function ImportForm({ sessionId }: { sessionId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const res = await importCsvAction(sessionId, formData);
      setResult(res);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleSubmit}
        className="rounded border border-dashed border-border-strong bg-surface p-8 text-center"
      >
        <UploadCloud className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
        <p className="mt-3 text-sm font-medium text-ink">
          Upload a CSV with <code className="rounded bg-bg px-1 py-0.5 font-mono text-xs">name</code>{" "}
          and <code className="rounded bg-bg px-1 py-0.5 font-mono text-xs">email</code> columns
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Every row is validated independently — a bad row won&apos;t block the good ones.
        </p>

        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="text-sm text-ink-muted file:mr-3 file:rounded file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-bg"
          />
          {file && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <FileText className="h-3.5 w-3.5" />
              {file.name}
            </span>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          className="mt-5"
          disabled={!file || isPending}
        >
          {isPending ? "Importing…" : "Import attendees"}
        </Button>
      </form>

      {result && !result.ok && (
        <p className="rounded border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger">
          {result.message}
        </p>
      )}

      {result?.ok && <ImportResultsTable report={result.report} />}
    </div>
  );
}
