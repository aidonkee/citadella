-- Reset and recreate with 768 dimensions (compatible with HNSW index)
DROP TABLE IF EXISTS knowledge_base CASCADE;
DROP FUNCTION IF EXISTS match_knowledge;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  embedding vector(768) NOT NULL,
  metadata jsonb
);

-- HNSW supports max 2000 dimensions — 768 is safe
CREATE INDEX knowledge_base_embedding_idx ON knowledge_base USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(768),
  match_count int DEFAULT 5
) RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT knowledge_base.id, knowledge_base.content, knowledge_base.metadata,
    1 - (knowledge_base.embedding <=> query_embedding) AS similarity
  FROM knowledge_base
  ORDER BY knowledge_base.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
