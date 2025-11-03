"use client";

import {
  Suspense,
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SchemaField = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  help?: string | null;
  repeat_group?: string | null;
  targets?: string[];
};

type SchemaGroup = {
  id?: string;
  title?: string;
  description?: string | null;
  fields?: SchemaField[];
};

type SchemaResponse = {
  groups?: SchemaGroup[];
  model_name?: string | null;
  _meta?: {
    id: string;
    doc_id: string;
    model_name: string | null;
    created_at: string;
  };
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
  const router = useRouter();

  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [formStatus, setFormStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const schemaGroups = useMemo(() => schema?.groups ?? [], [schema]);

  const [canLoadDoc, setCanLoadDoc] = useState(false);
  const lastProcessedIdRef = useRef<string | null>(null);
  const shouldDiscardRef = useRef(false);
  const isHydratingAnswersRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRequestIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storageKey = "fluidfill:last-doc-id";

    if (!id) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Ignore storage errors
      }
      setCanLoadDoc(false);
      shouldDiscardRef.current = false;
      lastProcessedIdRef.current = null;
      return;
    }

    if (lastProcessedIdRef.current === id) {
      return;
    }

    lastProcessedIdRef.current = id;

    const determineNavigationType = () => {
      if (typeof performance === "undefined") {
        return undefined;
      }
      const navEntries = performance.getEntriesByType(
        "navigation"
      ) as PerformanceNavigationTiming[];
      const latestEntry = navEntries[navEntries.length - 1];
      if (latestEntry?.type) {
        return latestEntry.type;
      }
      const legacyNav = (performance as any)?.navigation;
      if (legacyNav?.type === 1) return "reload";
      if (legacyNav?.type === 0) return "navigate";
      if (legacyNav?.type === 2) return "back_forward";
      return undefined;
    };

    const navType = determineNavigationType();

    let lastDocId: string | null = null;
    try {
      lastDocId = sessionStorage.getItem(storageKey);
    } catch {
      lastDocId = null;
    }

    if (navType === "reload" && lastDocId === id) {
      shouldDiscardRef.current = true;
      setCanLoadDoc(false);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Ignore storage errors
      }
      return;
    }

    try {
      sessionStorage.setItem(storageKey, id);
    } catch {
      // Ignore storage errors
    }
    shouldDiscardRef.current = false;
    setCanLoadDoc(true);
  }, [id]);

  useEffect(() => {
    if (!shouldDiscardRef.current || !id) {
      return;
    }

    let cancelled = false;

    router.replace("/upload");

    async function discardDocument() {
      try {
        await fetch(buildUrl(`/api/doc/${id}`), {
          method: "DELETE"
        });
      } catch (deleteError) {
        console.error("Failed to delete document after reload:", deleteError);
      } finally {
        if (!cancelled) {
          router.replace("/upload");
        }
        shouldDiscardRef.current = false;
      }
    }

    discardDocument();

    return () => {
      cancelled = true;
      shouldDiscardRef.current = false;
    };
  }, [id, router]);

  useEffect(() => {
    if (!canLoadDoc) {
      return;
    }

    if (!id) {
      setMeta(null);
      setPreviewHtml(null);
      setSchema(null);
      setAnswers({});
      setTouchedFields({});
      setSaveError(null);
      setFormStatus("idle");
      setLoading(false);
      setError("No document ID provided.");
      return;
    }

    let cancelled = false;

    async function loadDocument() {
      setLoading(true);
      setError(null);
      setFormStatus("loading");
      setSaveError(null);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveRequestIdRef.current += 1;

      try {
        const metaResp = await fetch(buildUrl(`/api/doc/${id}`));
        if (cancelled) return;

        if (metaResp.status === 404) {
          router.replace("/upload");
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

        let schemaData: SchemaResponse | null = null;

        if (schemaResp.ok) {
          schemaData = (await schemaResp.json()) as SchemaResponse;
        } else if (schemaResp.status === 404) {
          try {
            const createResp = await fetch(buildUrl(`/api/doc/${id}/schema`), {
              method: "POST",
              headers: { "Content-Type": "application/json" }
            });
            if (createResp.ok) {
              schemaData = (await createResp.json()) as SchemaResponse;
            } else {
              const createMessage = await createResp.text();
              console.warn("Schema creation failed", createMessage);
            }
          } catch (schemaError) {
            console.error("Schema creation error", schemaError);
          }
        } else {
          const schemaMessage = await schemaResp.text();
          console.warn("Schema request failed", schemaMessage);
        }

        if (!cancelled) {
          setSchema(schemaData);
        }

        let initialAnswers: Record<string, string> = {};
        const fieldTypeMap = new Map<string, string>();
        schemaData?.groups?.forEach((group) => {
          group.fields?.forEach((field) => {
            if (field?.key && field.type) {
              fieldTypeMap.set(field.key, field.type);
            }
          });
        });

        if (schemaData && !cancelled) {
          try {
            const answerResp = await fetch(buildUrl(`/api/doc/${id}/answer`));
            if (answerResp.ok) {
              const answerJson = (await answerResp.json()) as {
                body?: Record<string, unknown>;
              };
              const body = answerJson?.body;
              if (body && typeof body === "object" && !Array.isArray(body)) {
                initialAnswers = Object.entries(body).reduce<Record<string, string>>(
                  (acc, [key, value]) => {
                    const rawValue =
                      value === null || value === undefined ? "" : String(value);
                    const fieldType = fieldTypeMap.get(key);
                    if (fieldType === "date" && rawValue) {
                      acc[key] = rawValue.split("T")[0] ?? "";
                    } else {
                      acc[key] = rawValue;
                    }
                    return acc;
                  },
                  {}
                );
              }
            } else if (answerResp.status !== 404) {
              const answerMessage = await answerResp.text();
              console.warn("Answer request failed", answerMessage);
            }
          } catch (answerError) {
            console.error("Answer fetch error", answerError);
          }
        }

        if (!cancelled) {
          isHydratingAnswersRef.current = true;
          setAnswers(initialAnswers);
          setTouchedFields({});
          setSaveError(null);
          const hasGroups = !!schemaData && (schemaData.groups?.length ?? 0) > 0;
          const hasAnswers = Object.keys(initialAnswers).length > 0;
          setFormStatus(hasGroups ? (hasAnswers ? "saved" : "idle") : "saved");
        }
      } catch (err) {
        if (cancelled) return;
        const message =
      err instanceof Error ? err.message : "Unexpected error loading document.";
    setError(message);
    setMeta(null);
    setPreviewHtml(null);
    setSchema(null);
    setAnswers({});
    setTouchedFields({});
    setSaveError(message);
    setFormStatus("error");
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
  }, [id, canLoadDoc, router]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!id) {
      return;
    }
    if (schemaGroups.length === 0) {
      return;
    }
    if (isHydratingAnswersRef.current) {
      isHydratingAnswersRef.current = false;
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      const requestId = ++saveRequestIdRef.current;
      setFormStatus("saving");
      try {
        const resp = await fetch(buildUrl(`/api/doc/${id}/answer`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: answers })
        });

        if (!resp.ok) {
          const detail = await resp.text();
          throw new Error(detail || "Failed to save answers");
        }

        if (saveRequestIdRef.current === requestId) {
          setFormStatus("saved");
          setSaveError(null);
        }
      } catch (saveErr) {
        console.error("Answer save failed:", saveErr);
        const message =
          saveErr instanceof Error ? saveErr.message : "Failed to save answers.";
        if (saveRequestIdRef.current === requestId) {
          setFormStatus("error");
          setSaveError(message);
        }
      }
    }, 1200);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [answers, id, schemaGroups]);

  const handleFieldChange = (key: string, value: string) => {
    let didChange = false;
    setAnswers((prev) => {
      if (prev[key] === value) {
        return prev;
      }
      didChange = true;
      return { ...prev, [key]: value };
    });
    if (didChange) {
      saveRequestIdRef.current += 1;
      setFormStatus((prev) => (prev === "loading" ? "loading" : "idle"));
      setSaveError(null);
    }
  };

  const handleFieldBlur = (key: string) => {
    setTouchedFields((prev) => {
      if (prev[key]) {
        return prev;
      }
      return { ...prev, [key]: true };
    });
  };

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-text">Fill the form</h2>
              <p className="text-xs text-text/60">
                Values auto-save shortly after you stop typing.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                formStatus === "saved"
                  ? "bg-emerald-400/10 text-emerald-300"
                  : formStatus === "saving"
                  ? "bg-primary/20 text-primary"
                  : formStatus === "error"
                  ? "bg-red-400/10 text-red-300"
                  : "bg-primary/10 text-text/70"
              }`}
            >
              {formStatus === "idle"
                ? "Unsaved changes"
                : formStatus === "loading"
                ? "Loading…"
                : formStatus === "saving"
                ? "Saving…"
                : formStatus === "saved"
                ? "Saved"
                : "Save failed"}
            </span>
          </div>

          {saveError && (
            <div className="rounded-md border border-red-400/60 bg-red-400/10 px-3 py-2 text-sm text-red-200">
              {saveError}
            </div>
          )}

          {!schema ? (
            <div className="rounded-md border border-primary/20 bg-background/60 px-3 py-4 text-sm text-text/70">
              Loading schema…
            </div>
          ) : schemaGroups.length === 0 ? (
            <div className="rounded-md border border-primary/20 bg-background/60 px-3 py-4 text-sm text-text/70">
              We couldn&apos;t detect any fillable fields. You can still preview the
              template or upload a different document.
            </div>
          ) : (
            <form
              className="flex-1 space-y-6 overflow-y-auto"
              onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
            >
              {schemaGroups.map((group, groupIndex) => (
                <fieldset
                  key={group.id ?? `${group.title ?? "group"}-${groupIndex}`}
                  className="space-y-4 rounded-lg border border-primary/30 bg-background/60 p-4"
                  disabled={formStatus === "loading"}
                >
                  <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-primary">
                    {group.title || "Untitled Section"}
                  </legend>
                  {group.description && (
                    <p className="text-xs text-text/60">{group.description}</p>
                  )}
                  <div className="space-y-4">
                    {group.fields?.map((field) => {
                      if (!field?.key || !field.label) {
                        return null;
                      }
                      let value = answers[field.key] ?? "";
                      if (field.type === "date" && value) {
                        value = value.split("T")[0] ?? "";
                      }
                      const isRequired = field.required !== false;
                      const showError =
                        isRequired &&
                        touchedFields[field.key] &&
                        value.trim().length === 0;
                      const baseInputClasses =
                        "w-full rounded-md border border-primary/40 bg-background/80 px-3 py-2 text-sm text-text placeholder:text-text/40 focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/60";
                      const inputClasses = `${baseInputClasses}${
                        showError ? " border-red-400 focus:ring-red-400 focus:border-red-400" : ""
                      }`;
                      const handleChange = (
                        event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
                      ) => {
                        handleFieldChange(field.key, event.target.value);
                      };
                      const handleBlur = () => handleFieldBlur(field.key);

                      let inputNode: JSX.Element;
                      switch (field.type) {
                        case "email":
                          inputNode = (
                            <input
                              type="email"
                              id={field.key}
                              name={field.key}
                              value={value}
                              placeholder={field.label}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClasses}
                              autoComplete="email"
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                        case "date":
                          inputNode = (
                            <input
                              type="date"
                              id={field.key}
                              name={field.key}
                              value={value}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClasses}
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                        case "number":
                          inputNode = (
                            <input
                              type="number"
                              step="any"
                              id={field.key}
                              name={field.key}
                              value={value}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClasses}
                              inputMode="decimal"
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                        case "multiline":
                          inputNode = (
                            <textarea
                              id={field.key}
                              name={field.key}
                              value={value}
                              placeholder={field.label}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={`${inputClasses} min-h-[96px] resize-y`}
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                        case "select":
                          inputNode = (
                            <input
                              type="text"
                              id={field.key}
                              name={field.key}
                              value={value}
                              placeholder="Select options coming soon"
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClasses}
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                        case "phone":
                          inputNode = (
                            <input
                              type="tel"
                              id={field.key}
                              name={field.key}
                              value={value}
                              placeholder={field.label}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClasses}
                              autoComplete="tel"
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                        default:
                          inputNode = (
                            <input
                              type="text"
                              id={field.key}
                              name={field.key}
                              value={value}
                              placeholder={field.label}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClasses}
                              autoComplete="off"
                              required={isRequired}
                              aria-invalid={showError}
                            />
                          );
                          break;
                      }

                      return (
                        <div key={field.key} className="space-y-1">
                          <label
                            htmlFor={field.key}
                            className="flex items-center gap-1 text-sm font-medium text-text"
                          >
                            {field.label}
                            {isRequired && <span className="text-primary">*</span>}
                          </label>
                          {inputNode}
                          {field.help && (
                            <p className="text-xs text-text/60">{field.help}</p>
                          )}
                          {showError && (
                            <p className="text-xs text-red-300">
                              This field is required.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </form>
          )}
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
