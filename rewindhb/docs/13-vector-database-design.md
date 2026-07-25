# Vector Database Design

## Why pgvector (not Pinecone) for MVP

| Concern            | pgvector                          | Pinecone                          |
|--------------------|-----------------------------------|-----------------------------------|
| Operational cost   | $0 (it's Postgres)                | $70/mo minimum                    |
| Cold start         | One `CREATE EXTENSION`            | Account, index creation, SDK      |
| Latency at 10k     | ~30ms                             | ~50ms                             |
| Latency at 1M      | ~150ms with HNSW                  | ~80ms                             |
| Backup             | Same as Postgres                  | Separate process                  |
| Joins with metadata| Native SQL                        | Metadata filtering API only       |
| Vendor lock-in     | None                              | High                              |

Decision: **pgvector for MVP, until we hit scale issues.** When we hit ~5M memories across all users, evaluate Pinecone or Weaviate.

## Index configuration

```sql
-- HNSW index — better for cosine, supports incremental inserts
CREATE INDEX idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (
    m = 16,                  -- # neighbors per node (16 is default, 24 for higher recall)
    ef_construction = 64     -- candidate list size during construction (64 default, 128 for higher recall)
  );

-- At query time, you can tune ef_search:
SET hnsw.ef_search = 100;    -- default 40, raise for higher recall
```

For ~100k memories per user, this index gives p95 < 80ms queries.

## Embedding model

- **Model:** OpenAI `text-embedding-3-small`
- **Dimensions:** 1536 (we don't use Matryoshka dimensionality reduction yet)
- **Cost:** $0.02 per 1M tokens
- **Per-memory cost:** ~$0.00002 (we embed ~500 tokens)

We store the model name with each embedding so we can re-embed everything if we change models.

## Embedding text composition

What we feed the embedding model:

```
EMBED_INPUT = title + "  " + summary + "  " + excerpt_clean_first_500_chars
```

Rationale:
- **Title** — strong signal, low-noise.
- **Summary** — high signal, AI-compressed version of the page.
- **First 500 chars of excerpt** — catches concrete terms (names, code, numbers) the summary may have smoothed over.

We do **not** embed the full excerpt — cost & noise.

## Search at query time

```sql
-- 1. Get top 50 candidates by cosine similarity
WITH candidates AS (
  SELECT id, url, title, summary, category, tags, visited_at,
         1 - (embedding <=> $1::vector) AS score
  FROM memories
  WHERE user_id = $2
    AND processing_status = 'ready'
    AND deleted_at IS NULL
    AND visited_at >= $3              -- 'since' filter
    AND category = ANY($4)            -- 'categories' filter
    AND (cardinality($5::text[]) = 0 OR tags && $5)  -- optional tag filter
  ORDER BY embedding <=> $1::vector
  LIMIT 50
)
SELECT * FROM candidates;
```

## Hybrid re-rank

```sql
-- 2. Compute BM25 score for the candidates
SELECT c.id,
       c.score AS vec_score,
       ts_rank(
         to_tsvector('english',
           coalesce(c.title,'') || ' ' || coalesce(c.summary,'')),
         plainto_tsquery('english', $1)
       ) AS kw_score,
       -- freshness (recent things score higher)
       exp(-extract(epoch FROM (now() - c.visited_at)) / (30 * 86400)) AS fresh
FROM candidates c;
```

Final score (computed in app layer):

```python
final = 0.7 * vec_score + 0.2 * normalized_kw_score + 0.1 * fresh
```

## Vector hygiene

- **Re-embedding on model change.** If we change embedding models, we run a one-shot job to re-embed every memory. Store `embedding_model` per row.
- **Embedding drift.** If a page's content changes after capture, we don't re-embed. The user can `Re-capture this URL` from the memory card menu.
- **Soft-deleted memories** are excluded from search (`WHERE deleted_at IS NULL`).
- **User-scoped.** Every query filters by `user_id`. No cross-user leakage.

## Cold storage / scaling path

When a single Postgres instance can't hold the data:

1. **Partition `memories` by user_id hash.** Postgres native partitioning. 16 partitions.
2. **Move free-tier users' oldest memories to cold storage** (S3 + Parquet). Search them lazily only when user explicitly opts in.
3. **Or migrate to Pinecone.** Keep Postgres for metadata, store embeddings in Pinecone. Sync via a CDC pipeline.

We are nowhere near this in the MVP.

## Capacity math

Per memory (Postgres row):
- Fixed fields: ~1 KB
- Embedding: 6 KB (1536 × 4 bytes)
- Excerpt: 4 KB
- Total: ~11 KB on disk + indexes (~6 KB more)

For 100k memories per power user: ~1.7 GB.
For 1k users × 10k memories average: ~170 GB. Comfortably fits in a single Postgres instance.

## Privacy guarantees

- Embeddings are derived from page content the user already saw in their own browser.
- Embeddings are stored encrypted-at-rest by the Postgres provider (Neon, Supabase, RDS).
- Embeddings are never shared with other users, never used for training, never sold.
- Deleting a memory deletes the embedding immediately (cascade delete).
