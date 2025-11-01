import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "http://localhost:4000";

type SchemaGroup = {
  name?: string;
  fields?: Array<{ key: string; label: string }>;
};

type SchemaResponse = {
  groups?: SchemaGroup[];
};

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) {
    return { status: 404, data: null as T | null, error: "Not Found" };
  }
  if (!response.ok) {
    const message = await response.text();
    return {
      status: response.status,
      data: null as T | null,
      error: message || `Request failed (${response.status})`
    };
  }
  try {
    const json = (await response.json()) as T;
    return { status: response.status, data: json, error: null };
  } catch (error) {
    return { status: response.status, data: null as T | null, error: "Invalid JSON response" };
  }
}

export default async function DocumentPage({
  params
}: {
  params: { id: string };
}) {
  const { id } = params;

  const docResult = await fetchJson<{
    id: string;
    filename: string;
    mime: string | null;
    sizeBytes: number | null;
    createdAt: string;
  }>(`${apiBase}/api/doc/${id}`);

  if (docResult.status === 404) {
    notFound();
  }

  if (!docResult.data) {
    return (
      <section className="flex flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-2xl font-semibold text-text">Unable to load document</h1>
        <p className="max-w-md text-sm text-text/70">
          {docResult.error ?? "An unexpected error occurred while loading this document."}
        </p>
      </section>
    );
  }

  const previewPromise = fetchJson<{ html: string }>(
    `${apiBase}/api/doc/${id}/preview`
  );
  const schemaPromise = fetchJson<SchemaResponse>(
    `${apiBase}/api/doc/${id}/schema`
  );

  const [previewResult, schemaResult] = await Promise.all([
    previewPromise,
    schemaPromise
  ]);

  const previewHtml =
    previewResult.data?.html ??
    `<div class="text-sm text-red-400">Preview unavailable: ${
      previewResult.error ?? "unknown error"
    }</div>`;

  const schemaGroups = schemaResult.data?.groups ?? [];

  return (
    <section className="flex w-full flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold text-text">{docResult.data.filename}</h1>
        <p className="text-sm text-text/70">
          Uploaded{" "}
          {new Date(docResult.data.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
          })}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-h-[60vh] rounded-xl border border-primary/40 bg-background/60 p-4 shadow-inner shadow-primary/10">
          <article
            className="prose prose-invert max-w-none overflow-y-auto text-sm leading-relaxed [&>div]:space-y-4"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
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
