CREATE TABLE IF NOT EXISTS schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  model_name TEXT,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schemas_doc ON schemas(doc_id);
