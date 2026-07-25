# Database Schema

## Stack
- PostgreSQL 16 + pgvector extension
- All timestamps UTC
- All IDs: `uuid_generate_v4()` (we'll use `gen_random_uuid()` from pgcrypto)

## Tables

### `users`
```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  avatar_url      TEXT,
  google_sub      TEXT UNIQUE,                  -- Google subject claim
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ,
  capture_paused  BOOLEAN NOT NULL DEFAULT FALSE,
  plan            TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro' | 'team'
  -- feature flags
  embeddings_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  summary_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  -- per-user dedup of "seen this URL" window
  dedup_window_seconds INT NOT NULL DEFAULT 60
);
CREATE INDEX idx_users_email ON users(email);
```

### `memories`
The core table. One row per page visit (after dedup).

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  domain          TEXT GENERATED ALWAYS AS (
                  split_part(url, '/', 3)
                ) STORED,
  canonical_url   TEXT,                       -- if page has <link rel=canonical>
  title           TEXT NOT NULL,
  favicon_url     TEXT,
  excerpt_raw     TEXT,                       -- first 4000 chars of visible text
  excerpt_clean   TEXT,                       -- cleaned (whitespace, scripts removed)

  -- AI-generated (nullable while processing)
  summary         TEXT,                       -- 1-2 sentence AI summary
  category        TEXT,                       -- 'repo' | 'article' | 'video' | 'doc' | 'recipe' | 'paper' | 'social' | 'shopping' | 'email' | 'forum' | 'news' | 'other'
  tags            TEXT[],                     -- up to 8 lowercase tags
  embedding       vector(1536),               -- OpenAI text-embedding-3-small
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',

  -- metadata
  content_type    TEXT,                       -- mime-type if known
  word_count      INT,
  language        TEXT,
  read_time_sec   INT,

  -- timing
  visited_at      TIMESTAMPTZ NOT NULL,
  indexed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT NOT NULL DEFAULT 'processing',  -- 'processing' | 'ready' | 'failed'

  -- soft delete / mute
  deleted_at      TIMESTAMPTZ,
  pinned          BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes
CREATE INDEX idx_memories_user_visited ON memories(user_id, visited_at DESC);
CREATE INDEX idx_memories_user_status  ON memories(user_id, processing_status);
CREATE INDEX idx_memories_user_domain  ON memories(user_id, domain);
CREATE INDEX idx_memories_user_tags    ON memories USING GIN(tags);
CREATE INDEX idx_memories_user_category ON memories(user_id, category);

-- vector index (HNSW — good for cosine)
CREATE INDEX idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- full-text search index (for hybrid re-rank)
CREATE INDEX idx_memories_fts ON memories
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'')));
```

### `collections`
Smart Collections — auto-grouped or user-created.

```sql
CREATE TABLE collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,             -- 'ai-research', 'internship-search'
  title           TEXT NOT NULL,
  description     TEXT,
  color           TEXT,                      -- accent for the card
  icon            TEXT,                      -- single emoji or null
  source          TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  -- auto-cluster metadata (nullable when source='manual')
  cluster_method  TEXT,                      -- 'embedding-kmeans' | 'embedding-dbscan'
  centroid        vector(1536),
  member_count    INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ,

  UNIQUE(user_id, slug)
);
CREATE INDEX idx_collections_user ON collections(user_id, last_activity_at DESC);
```

### `collection_memories`
Many-to-many between memories and collections.

```sql
CREATE TABLE collection_memories (
  collection_id   UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  memory_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relevance_score REAL,                       -- distance to cluster centroid
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, memory_id)
);
CREATE INDEX idx_cm_memory ON collection_memories(memory_id);
```

### `memory_relations`
Pre-computed edges for the Memory Graph.

```sql
CREATE TABLE memory_relations (
  source_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  weight          REAL NOT NULL,             -- similarity 0..1
  relation_type   TEXT NOT NULL DEFAULT 'similar',  -- 'similar' | 'same_topic' | 'sequence'
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX idx_mr_target ON memory_relations(target_id);
```

### `search_history`
Recent searches (for personalization + "resume where you left off").

```sql
CREATE TABLE search_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query           TEXT NOT NULL,
  result_count    INT,
  clicked_memory_id UUID REFERENCES memories(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_search_user_recent ON search_history(user_id, created_at DESC);
```

### `user_settings`
One row per user. JSONB blob for flexibility.

```sql
CREATE TABLE user_settings (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blocklist_domains TEXT[] NOT NULL DEFAULT '{}',
  pause_until     TIMESTAMPTZ,
  theme           TEXT NOT NULL DEFAULT 'dark',
  -- capture filters
  capture_min_words INT NOT NULL DEFAULT 50,
  capture_max_per_day INT NOT NULL DEFAULT 500,
  -- which categories to capture
  capture_categories TEXT[] NOT NULL DEFAULT ARRAY['repo','article','video','doc','recipe','paper','social','forum','news','shopping','email','other'],
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `sessions` (for Context Resume)
Tracks "session windows" — a set of related memories opened in a tight time window.

```sql
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic           TEXT,                       -- LLM-suggested topic
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  memory_ids      UUID[] NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_sessions_user ON sessions(user_id, started_at DESC);
```

## Notes

- We **never store full HTML.** Only `excerpt_clean` (≤ 4000 chars). This keeps storage tiny and dodges most copyright concerns.
- Embeddings are **per-user.** A user only ever searches their own memory.
- `processing_status='ready'` gates the UI — users only see ready memories.
- Soft-delete via `deleted_at`; hard-delete by cron after 30 days.
