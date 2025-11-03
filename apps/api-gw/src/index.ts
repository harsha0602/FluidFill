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
const allowedOrigins = new Set<string>(frontendOrigin ? [frontendOrigin] : []);

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

app.get("/api/doc/:id/schema", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await dbQuery<{
      parse_json: ParseResult | null;
    }>(
      `SELECT parse_json
       FROM documents
       WHERE id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Document not found" });
    }

    const placeholders = Array.isArray(row.parse_json?.placeholders)
      ? row.parse_json!.placeholders
      : [];

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

      const schemaJson = await schemaResp.json();
      return res.json(schemaJson);
    } catch (error) {
      const message =
        error instanceof DocServiceError
          ? `doc-service error (${error.status})`
          : "doc-service unreachable";
      console.error("Schema generation failed:", error);
      return res.status(502).json({ error: message });
    }
  } catch (error) {
    console.error("Schema fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch schema" });
  }
});

app.post("/api/doc/:id/answer", async (req, res) => {
  const { id } = req.params;
  const { key, value } = req.body ?? {};

  if (!key) {
    return res.status(400).json({ error: "key required" });
  }

  try {
    const result = await dbQuery(`SELECT 1 FROM documents WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Document not found" });
    }
  } catch (error) {
    console.error("Answer validation failed:", error);
    return res.status(500).json({ error: "Failed to persist answer" });
  }

  res.json({ ok: true, key, value });
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
