-- Documents and extracted placeholders
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  user_id UUID,
  filename TEXT NOT NULL,
  storage_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS placeholders (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT,
  description TEXT,
  UNIQUE(document_id, key)
);


CREATE TABLE IF NOT EXISTS occurrences (
  id UUID PRIMARY KEY,
  placeholder_id UUID NOT NULL REFERENCES placeholders(id) ON DELETE CASCADE,
  location_json JSONB NOT NULL,
  snippet TEXT
);


CREATE TABLE IF NOT EXISTS answers (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  placeholder_id UUID NOT NULL REFERENCES placeholders(id) ON DELETE CASCADE,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, placeholder_id)
);


CREATE TABLE IF NOT EXISTS versions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  diff_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Indexes
CREATE INDEX IF NOT EXISTS idx_placeholders_doc ON placeholders(document_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_ph ON occurrences(placeholder_id);
CREATE INDEX IF NOT EXISTS idx_answers_doc ON answers(document_id);
