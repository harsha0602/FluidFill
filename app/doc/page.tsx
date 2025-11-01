"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type SchemaGroup = {
  name?: string;
  fields?: Array<{ key: string; label: string }>;
};

type SchemaResponse = {
  groups?: SchemaGroup[];
};

type DocumentMeta = {
  id: string;
  filename: string;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "";

const buildUrl = (path: string) => (apiBase ? `${apiBase}${path}` : path);

export default function DocumentPage() {
  return (
    <Suspense fallback={<DocumentSkeleton />}>
      <DocumentContent />
    </Suspense>
  );
}

function DocumentContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";

  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [schemaGroups, setSchemaGroups] = useState<SchemaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setMeta(null);
      setPreviewHtml(null);
      setSchemaGroups([]);
      setLoading(false);
      setError("No document ID provided.");
      return;
    }

    let cancelled = false;

    async function loadDocument() {
      setLoading(true);
      setError(null);

      try {
        const metaResp = await fetch(buildUrl(`/api/doc/${id}`));
        if (cancelled) return;

        if (metaResp.status === 404) {
          setError("Document not found.");
          setMeta(null);
          setPreviewHtml(null);
          setSchemaGroups([]);
          return;
        }

        if (!metaResp.ok) {
          const message = await metaResp.text();
          throw new Error(message || "Failed to load document metadata.");
        }

        const metaJson = (await metaResp.json()) as DocumentMeta;
        if (cancelled) return;
        setMeta(metaJson);

        const [previewResp, schemaResp] = await Promise.all([
          fetch(buildUrl(`/api/doc/${id}/preview`)),
          fetch(buildUrl(`/api/doc/${id}/schema`))
        ]);

        if (!previewResp.ok) {
          const message = await previewResp.text();
          throw new Error(message || "Failed to render preview.");
        }

        const previewJson = (await previewResp.json()) as { html?: string };
        if (!cancelled) {
          setPreviewHtml(previewJson?.html ?? "");
        }

        if (schemaResp.ok) {
          const schemaJson = (await schemaResp.json()) as SchemaResponse;
          if (!cancelled) {
            setSchemaGroups(schemaJson?.groups ?? []);
          }
        } else {
          const schemaMessage = await schemaResp.text();
          console.warn("Schema request failed", schemaMessage);
          if (!cancelled) {
            setSchemaGroups([]);
          }
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Unexpected error loading document.";
        setError(message);
        setMeta(null);
        setPreviewHtml(null);
        setSchemaGroups([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const uploadedTimestamp = useMemo(() => {
    if (!meta?.createdAt) return null;
    try {
      return new Date(meta.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    } catch {
      return meta.createdAt;
    }
  }, [meta?.createdAt]);

  if (!id) {
    return (
      <section className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold text-text">Document unavailable</h1>
        <p className="max-w-md text-sm text-text/70">
          Try uploading the template again from the upload page.
        </p>
      </section>
    );
  }

  if (loading) {
    return <DocumentSkeleton />;
  }

  if (error) {
    return (
      <section className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold text-text">We hit a snag</h1>
        <p className="max-w-md text-sm text-text/70">{error}</p>
      </section>
    );
  }

  if (!meta) {
    return (
      <section className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold text-text">Document unavailable</h1>
        <p className="max-w-md text-sm text-text/70">
          Try uploading the template again from the upload page.
        </p>
      </section>
    );
  }

  const safePreviewHtml =
    previewHtml ??
    `<div class="text-sm text-red-400">Preview unavailable. Try refreshing the page.</div>`;

  return (
    <section className="flex w-full flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold text-text">{meta.filename}</h1>
        {uploadedTimestamp && (
          <p className="text-sm text-text/70">Uploaded {uploadedTimestamp}</p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-h-[60vh] rounded-xl border border-primary/40 bg-background/60 p-4 shadow-inner shadow-primary/10">
          <article
            className="prose prose-invert max-w-none overflow-y-auto text-sm leading-relaxed [&>div]:space-y-4"
            dangerouslySetInnerHTML={{ __html: safePreviewHtml }}
          />
        </div>

        <aside className="flex min-h-[60vh] flex-col gap-4 rounded-xl border border-primary/40 bg-background/40 p-4 shadow">
          <h2 className="text-xl font-semibold text-text">AI Form coming next</h2>
          <p className="text-sm text-text/70">
            We&apos;ve cached {schemaGroups.length} schema group
            {schemaGroups.length === 1 ? "" : "s"} from your template. You&apos;ll be able
            to complete it right here shortly.
          </p>
        </aside>
      </div>
    </section>
  );
}

function DocumentSkeleton() {
  return (
    <section className="flex w-full flex-col gap-6">
      <header className="space-y-2">
        <div className="h-8 w-72 animate-pulse rounded bg-primary/40" />
        <div className="h-4 w-48 animate-pulse rounded bg-primary/30" />
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-h-[60vh] animate-pulse rounded-xl border border-primary/20 bg-background/40" />
        <div className="min-h-[60vh] animate-pulse rounded-xl border border-primary/20 bg-background/30" />
      </div>
    </section>
  );
}
