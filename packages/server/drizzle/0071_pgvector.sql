-- pgvector 向量检索加速（条件启用）：
-- 扩展可用时创建 ai_kb_chunks.embedding_vec（无维度 vector 列，兼容任意 embedding 模型），
-- 不可用时静默跳过，运行时回退 JS 余弦相似度。该列不进入 Drizzle schema，读写走原生 SQL。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE "ai_kb_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector;
  END IF;
END $$;