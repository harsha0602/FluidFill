import cors from "cors";
import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import pg from "pg";

const rootEnvPath = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function dbQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: any[]
) {
  return pool.query<T>(text, params);
}

async function applyMigrations() {
  const migrationsDir = path.resolve(process.cwd(), "../../db/migrations");
  try {
    const entries = await fsp.readdir(migrationsDir);
    const migrations = entries
      .filter((file) => file.toLowerCase().endsWith(".sql"))
      .sort();

    for (const file of migrations) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fsp.readFile(filePath, "utf8");
      console.log(`Applying migration: ${file}`);
      await pool.query(sql);
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

const app = express();
const port = Number(process.env.PORT) || 4000;
const docServiceBase =
  (process.env.DOC_SERVICE_URL || "http://localhost:5001").replace(/\/$/, "");
const uploadsDir = path.resolve(process.cwd(), "../../uploads");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

const frontendOrigin = (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, "");
const allowedOrigins = new Set<string>(
  [frontendOrigin, "http://localhost:3000"].filter((origin) => origin)
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      const normalized = origin.replace(/\/$/, "");
      if (allowedOrigins.has(normalized)) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "api-gw" });
});

class DocServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function ensureUploadsDir() {
  await fsp.mkdir(uploadsDir, { recursive: true });
}

async function callDocServiceMultipart(
  endpoint: string,
  buffer: Buffer,
  filename: string
) {
  const url = `${docServiceBase}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const form = new FormData();
  const blobSource = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  form.append("file", new Blob([blobSource]), filename);

  const resp = await fetch(url, {
    method: "POST",
    body: form
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new DocServiceError(resp.status, detail || "doc-service request failed");
  }

  return resp.json();
}

type ParsePlaceholder = {
  key: string;
  label: string;
  occurrences?: number;
};

type ParseResult = {
  document_id: string;
  placeholders: ParsePlaceholder[];
};

type SchemaRow = {
  id: string;
  doc_id: string;
  model_name: string | null;
  body: unknown;
  created_at: string;
};

type AnswerRow = {
  id: string;
  doc_id: string;
  schema_id: string | null;
  body: unknown;
  created_at: string;
  updated_at: string;
};

const defaultSchemaModel = process.env.AI_STUDIO_MODEL || null;

type SchemaPayload = {
  model_name?: string | null;
  groups: Array<{
    id: string;
    title: string;
    description?: string | null;
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
      help?: string | null;
      repeat_group?: string | null;
      targets?: string[];
    }>;
  }>;
};

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "file required" });
  }

  const originalName = file.originalname;
  const isDocx =
    originalName.toLowerCase().endsWith(".docx") ||
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!isDocx) {
    return res.status(400).json({ error: ".docx only" });
  }

  const documentId = randomUUID();
  const storedFilename = `${documentId}.docx`;
  const filePath = path.join(uploadsDir, storedFilename);

  try {
    await ensureUploadsDir();
    await fsp.writeFile(filePath, file.buffer as NodeJS.ArrayBufferView);
  } catch (error) {
    console.error("Failed to persist upload:", error);
    return res.status(500).json({ error: "Failed to store uploaded file" });
  }

  const storageUrl = filePath;
  const blobUrl = storageUrl;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO documents (id, filename, storage_url, mime, size_bytes, blob_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        documentId,
        originalName,
        storageUrl,
        file.mimetype,
        file.size,
        blobUrl
      ]
    );

    let parseResult: ParseResult | null = null;
    let previewHtml: string | null = null;
    try {
      parseResult = (await callDocServiceMultipart(
        "/parse",
        file.buffer,
        originalName
      )) as ParseResult;
      const previewResponse = await callDocServiceMultipart(
        "/to_html",
        file.buffer,
        originalName
      );
      previewHtml =
        typeof previewResponse?.html === "string" ? previewResponse.html : null;
    } catch (error) {
      await client.query("ROLLBACK");
      await fsp.unlink(filePath).catch(() => {});
      const message =
        error instanceof DocServiceError
          ? `doc-service error (${error.status})`
          : "doc-service unreachable";
      console.error("Doc-service call failed:", error);
      return res.status(502).json({ error: message });
    }

    await client.query(
      `UPDATE documents
         SET parse_json = $1::jsonb,
             preview_html = $2
       WHERE id = $3`,
      [JSON.stringify(parseResult), previewHtml, documentId]
    );

    const placeholders = Array.isArray(parseResult?.placeholders)
      ? parseResult.placeholders
      : [];

    for (const placeholder of placeholders) {
      if (!placeholder?.key || !placeholder?.label) continue;
      await client.query(
        `INSERT INTO placeholders (id, document_id, key, label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, key)
         DO UPDATE SET label = EXCLUDED.label`,
        [randomUUID(), documentId, placeholder.key, placeholder.label]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await fsp.unlink(filePath).catch(() => {});
    console.error("Upload handling failed:", error);
    return res.status(500).json({ error: "Failed to persist document" });
  } finally {
    client.release();
  }

  res.json({ documentId });
});

app.get("/api/doc/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbQuery<{
      id: string;
      filename: string;
      storage_url: string | null;
      mime: string | null;
      size_bytes: string | number | null;
      blob_url: string | null;
      parse_json: ParseResult | null;
      preview_html: string | null;
      created_at: Date;
    }>(
      `SELECT id, filename, storage_url, mime, size_bytes, blob_url, parse_json, preview_html, created_at
       FROM documents
       WHERE id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Document not found" });
    }

    const parsePlaceholders =
      Array.isArray(row.parse_json?.placeholders) && row.parse_json
        ? row.parse_json.placeholders
        : [];

    res.json({
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      storageUrl: row.storage_url,
      blobUrl: row.blob_url,
      createdAt: row.created_at,
      placeholderCount: parsePlaceholders.length,
      hasPreview: Boolean(row.preview_html)
    });
  } catch (error) {
    console.error("Failed to load document:", error);
    res.status(500).json({ error: "Failed to load document" });
  }
});

app.delete("/api/doc/:id", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const docResult = await client.query<{ storage_url: string | null }>(
      `SELECT storage_url
         FROM documents
         WHERE id = $1
         FOR UPDATE`,
      [id]
    );

    const doc = docResult.rows[0];

    if (!doc) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, deleted: false });
    }

    await client.query(`DELETE FROM documents WHERE id = $1`, [id]);
    await client.query("COMMIT");

    if (doc.storage_url) {
      try {
        await fsp.unlink(doc.storage_url);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          console.error("Failed to remove stored document:", error);
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to delete document:", error);
    res.status(500).json({ error: "Failed to delete document" });
  } finally {
    client.release();
  }
});

app.get("/api/doc/:id/preview", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await dbQuery<{
      filename: string;
      storage_url: string | null;
      preview_html: string | null;
    }>(
      `SELECT filename, storage_url, preview_html
       FROM documents
       WHERE id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (row.preview_html) {
      return res.json({ html: row.preview_html });
    }

    if (!row.storage_url) {
      return res.status(500).json({ error: "No stored document location" });
    }

    let buffer: Buffer;
    try {
      buffer = await fsp.readFile(row.storage_url);
    } catch (error) {
      console.error("Unable to read stored document:", error);
      return res.status(500).json({ error: "Failed to read stored document" });
    }

    try {
      const previewResponse = await callDocServiceMultipart(
        "/to_html",
        buffer,
        row.filename
      );
      const html =
        typeof previewResponse?.html === "string" ? previewResponse.html : null;
      if (!html) {
        return res.status(502).json({ error: "Invalid preview response" });
      }

      await dbQuery(
        `UPDATE documents SET preview_html = $1 WHERE id = $2`,
        [html, id]
      );

      return res.json({ html });
    } catch (error) {
      const message =
        error instanceof DocServiceError
          ? `doc-service error (${error.status})`
          : "doc-service unreachable";
      console.error("Preview generation failed:", error);
      return res.status(502).json({ error: message });
    }
  } catch (error) {
    console.error("Preview fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch preview" });
  }
});

function normalizePlaceholderList(parseJson: ParseResult | null | undefined) {
  if (!parseJson || !Array.isArray(parseJson.placeholders)) {
    return [];
  }
  return parseJson.placeholders.filter(
    (item): item is ParsePlaceholder & { key: string } =>
      !!item && typeof item.key === "string" && typeof item.label === "string"
  );
}

async function fetchDocument(docId: string) {
  const result = await dbQuery<{
    id: string;
    parse_json: ParseResult | null;
  }>(
    `SELECT id, parse_json
       FROM documents
       WHERE id = $1`,
    [docId]
  );
  return result.rows[0] ?? null;
}

function formatSchemaPayload(row: SchemaRow) {
  const rawBody = row.body;
  const schemaBody =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};

  return {
    ...schemaBody,
    _meta: {
      id: row.id,
      doc_id: row.doc_id,
      model_name: row.model_name,
      created_at: row.created_at
    }
  };
}

app.get("/api/doc/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await fetchDocument(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found", not_found: true });
    }

    const schemaResult = await dbQuery<SchemaRow>(
      `SELECT id, doc_id, model_name, body, created_at
         FROM schemas
        WHERE doc_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [id]
    );

    const schemaRow = schemaResult.rows[0];
    if (!schemaRow) {
      return res.status(404).json({ not_found: true });
    }

    return res.json(formatSchemaPayload(schemaRow));
  } catch (error) {
    console.error("Schema lookup failed:", error);
    res.status(500).json({ error: "Failed to fetch schema" });
  }
});

app.post("/api/doc/:id/schema", async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await fetchDocument(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const existing = await dbQuery<SchemaRow>(
      `SELECT id, doc_id, model_name, body, created_at
         FROM schemas
        WHERE doc_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [id]
    );

    if (existing.rows[0]) {
      return res.json(formatSchemaPayload(existing.rows[0]));
    }

    const placeholders = normalizePlaceholderList(doc.parse_json);

    let schemaJson: SchemaPayload;
    try {
      const schemaResp = await fetch(`${docServiceBase}/schema`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeholders })
      });

      if (!schemaResp.ok) {
        const detail = await schemaResp.text();
        throw new DocServiceError(
          schemaResp.status,
          detail || "doc-service schema failed"
        );
      }

      schemaJson = (await schemaResp.json()) as SchemaPayload;
    } catch (error) {
      const message =
        error instanceof DocServiceError
          ? `doc-service error (${error.status})`
          : "doc-service unreachable";
      console.error("Schema generation failed:", error);
      return res.status(502).json({ error: message });
    }

    const inferredModel =
      schemaJson && typeof schemaJson === "object" && schemaJson !== null
        ? (schemaJson as Record<string, unknown>).model_name ?? defaultSchemaModel
        : defaultSchemaModel;

    const insertResult = await dbQuery<SchemaRow>(
      `INSERT INTO schemas (doc_id, model_name, body)
       VALUES ($1, $2, $3)
       RETURNING id, doc_id, model_name, body, created_at`,
      [id, inferredModel, schemaJson]
    );

    return res.status(201).json(formatSchemaPayload(insertResult.rows[0]));
  } catch (error) {
    console.error("Schema generation failed:", error);
    res.status(500).json({ error: "Failed to generate schema" });
  }
});

app.get("/api/doc/:id/answer", async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await fetchDocument(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const result = await dbQuery<AnswerRow>(
      `SELECT id, doc_id, schema_id, body, created_at, updated_at
         FROM answers
        WHERE doc_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return res.json({ body: {} });
    }
    return res.json({
      id: row.id,
      doc_id: row.doc_id,
      schema_id: row.schema_id,
      body: row.body ?? {},
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  } catch (error) {
    console.error("Answer lookup failed:", error);
    res.status(500).json({ error: "Failed to fetch answers" });
  }
});

app.post("/api/doc/:id/answer", async (req, res) => {
  const { id } = req.params;
  const payload = req.body as {
    body?: Record<string, unknown>;
    schema_id?: string;
  };

  if (!payload || typeof payload !== "object" || payload.body == null) {
    return res.status(400).json({ error: "body map required" });
  }

  if (typeof payload.body !== "object" || Array.isArray(payload.body)) {
    return res.status(400).json({ error: "body must be an object map" });
  }

  const schemaId =
    typeof payload.schema_id === "string" ? payload.schema_id : null;

  try {
    const doc = await fetchDocument(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const existing = await dbQuery<AnswerRow>(
      `SELECT id
         FROM answers
        WHERE doc_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [id]
    );

    if (existing.rows[0]) {
      const updateResult = await dbQuery<AnswerRow>(
        `UPDATE answers
            SET body = $1::jsonb,
                schema_id = COALESCE($2::uuid, schema_id),
                updated_at = now()
          WHERE id = $3
          RETURNING id, doc_id, schema_id, body, created_at, updated_at`,
        [payload.body, schemaId, existing.rows[0].id]
      );
      return res.json(updateResult.rows[0]);
    }

    const insertResult = await dbQuery<AnswerRow>(
      `INSERT INTO answers (doc_id, schema_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, doc_id, schema_id, body, created_at, updated_at`,
      [id, schemaId, payload.body]
    );
    return res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error("Answer persistence failed:", error);
    res.status(500).json({ error: "Failed to persist answers" });
  }
});

async function startServer() {
  await applyMigrations();
  app.listen(port, () => {
    console.log(`api-gw listening on :${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
