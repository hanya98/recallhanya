# Semantic Search Flow

## End-to-end

```
┌─────────────────────────────────────────────────────────┐
│  1. USER INPUT                                           │
│     User types in Spotlight: "react auth repo last week"│
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  2. CLIENT                                             │
│     Debounce 200ms. POST /v1/search.                    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  3. SERVER — query rewrite                              │
│     • tokenize                                          │
│     • detect time intent ("last week" → since:7d)        │
│     • detect category intent ("repo" → categories:['repo'])│
│     • reformulate to:  query='react auth repo'          │
│                         since=2026-07-18                 │
│                         categories=['repo']             │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  4. EMBED THE QUERY                                     │
│     OpenAI text-embedding-3-small → 1536-dim vector.    │
│     Cost: ~$0.00002. Latency: ~50ms.                    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  5. VECTOR CANDIDATES (pgvector)                        │
│     SELECT id, url, title, summary, category, tags,     │
│            visited_at,                                  │
│            1 - (embedding <=> $1) AS score              │
│     FROM memories                                       │
│     WHERE user_id = $2                                  │
│       AND processing_status = 'ready'                   │
│       AND deleted_at IS NULL                            │
│       AND visited_at >= $3                              │
│       AND category = ANY($4)                            │
│     ORDER BY embedding <=> $1                           │
│     LIMIT 50;                                           │
│     -- HNSW index on embedding makes this ~80ms         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  6. KEYWORD SCORES (BM25 via tsvector)                  │
│     SELECT id,                                          │
│            ts_rank(to_tsvector('english', title || ' '  │
│                                  || summary),           │
│                    plainto_tsquery('english', $1))       │
│            AS kw_score                                  │
│     FROM memories                                       │
│     WHERE id = ANY($2) AND user_id = $3;                │
│     -- ~10ms                                            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  7. HYBRID FUSION                                       │
│     final_score = α·cosine + β·kw_score + γ·freshness   │
│     α=0.7, β=0.2, γ=0.1                                │
│     freshness = exp(-days_since_visited / 30)           │
│     top 10 returned                                     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  8. OPTIONAL LLM RE-RANK (only if use_llm_rerank=true) │
│     Prompt:  "Given query, which of these 10 memories  │
│              are most relevant? Return top 5 ordered."  │
│     Model: Gemini 2.0 Flash. Latency ~400ms.            │
│     Use case: ambiguous queries where keyword match    │
│     disagrees with semantic match.                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  9. RELATED MEMORIES                                   │
│     For each top result, query the 3 nearest neighbors │
│     by embedding (above threshold 0.7).                 │
│     Dedup, return top 5 across all results.            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  10. SESSION DETECTION                                  │
│     If the top matches' visited_at cluster within a   │
│     30-min window AND share tags → emit                │
│     session_resume: { topic, urls: [...] }              │
│     Frontend shows "Resume session" CTA.               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  11. RESPONSE                                          │
│     { matches, related, session_resume }               │
└─────────────────────────────────────────────────────────┘
```

## Why hybrid?

Pure semantic (vector-only) search has known failure modes:
- **Exact names** ("github.com/nextauthjs/next-auth") → embedding may rank lower than a blog post.
- **Recent things** → semantic similarity doesn't track time.
- **Code-specific tokens** → embedding models sometimes mush identifiers.

Pure keyword (BM25) has different failure modes:
- **Synonyms** ("authentication" vs "login" vs "sign in").
- **Concept queries** ("internship email mentioning ₹50k").
- **Cross-language** (less of an issue for browsing, but still).

The hybrid is best-of-both. Cosine is the dominant signal; keyword rescues exact matches; freshness bias keeps recent memories from drowning.

## Tuning knobs

| Knob              | Default | When to tune                                     |
|-------------------|---------|--------------------------------------------------|
| `α` (cosine weight) | 0.7   | Lower if exact-name queries fail                 |
| `β` (kw weight)   | 0.2     | Higher if embeddings are off-topic                |
| `γ` (freshness)   | 0.1     | Higher if "last week" style queries matter more  |
| candidate pool    | 50      | Larger pool helps re-rank but adds latency       |
| `score_threshold` | 0.5     | Raise to suppress off-topic matches              |
| `neighbor_threshold` | 0.7  | Higher → fewer related                            |

## Latency budget (p95)

| Step                     | Time      |
|--------------------------|-----------|
| Network (client→server)  | 30ms      |
| Query rewrite            | 5ms       |
| Embed query              | 50ms      |
| Vector candidates        | 80ms      |
| Keyword scores           | 10ms      |
| Hybrid fusion            | 5ms       |
| Related (3-NN × 10)      | 40ms      |
| Session detection        | 5ms       |
| Network (server→client)  | 30ms      |
| **Total (no re-rank)**   | **~255ms**|
| + LLM re-rank            | +400ms    |
| **Total (with re-rank)** | **~655ms**|

Well within the 400ms target for no re-rank.

## Failure modes we handle

- **User has 0 memories.** Return empty + onboarding nudge.
- **User has 100k memories.** Vector index keeps search under 200ms. UI paginates.
- **Embedding API is down.** Fall back to BM25 only; show banner "semantic search temporarily degraded."
- **Query is non-English.** Embedding model handles it; FTS index is English-only → reweight to α=0.9.
- **All scores < threshold.** Return empty + "Try different words."
