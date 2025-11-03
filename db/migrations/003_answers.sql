DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'answers'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'answers'
        AND column_name = 'doc_id'
    ) THEN
      DROP TABLE answers;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'answers'
  ) THEN
    CREATE TABLE answers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      schema_id UUID REFERENCES schemas(id) ON DELETE SET NULL,
      body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_answers_doc ON answers(doc_id);
