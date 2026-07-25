"""Schema bootstrap — runs raw DDL on startup so we don't need a separate

CREATE TABLE IF NOT EXISTS collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  color           TEXT,
  icon            TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  cluster_method  TEXT,
  centroid        vector(1536),
  member_count    INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ,
  UNIQUE(user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS collection_memories (
  collection_id   UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  memory_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relevance_score REAL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_memory ON collection_memories(memory_id);

CREATE TABLE IF NOT EXISTS memory_relations (
  source_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  weight          REAL NOT NULL,
  relation_type   TEXT NOT NULL DEFAULT 'similar',
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_mr_target ON memory_relations(target_id);

CREATE TABLE IF NOT EXISTS search_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query           TEXT NOT NULL,
  result_count    INT,
  clicked_memory_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_search_user_recent ON search_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blocklist_domains TEXT[] NOT NULL DEFAULT '{}',
  pause_until     TIMESTAMPTZ,
  theme           TEXT NOT NULL DEFAULT 'dark',
  capture_min_words INT NOT NULL DEFAULT 50,
  capture_max_per_day INT NOT NULL DEFAULT 500,
  capture_categories TEXT[] NOT NULL DEFAULT ARRAY['repo','article','video','doc','recipe','paper','social','forum','news','shopping','email','other'],
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic           TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  memory_ids      UUID[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC);
"""


async def ensure_schema(engine: AsyncEngine) -> None:
    """Run idempotent DDL. Safe to call on every startup.

    Splits the multi-statement DDL on semicolons and runs each as its own
    transaction — asyncpg (and psycopg in async mode) reject multi-statement
    prepared statements.
    """
    from sqlalchemy import text
    import logging
    log = logging.getLogger(__name__)

    statements = [s.strip() for s in DDL.split(";") if s.strip()]
    for stmt in statements:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as e:
            err = str(e)
            # Tolerate missing extensions (vector/pgcrypto) — server still boots
            if "extension" in err.lower() or "does not exist" in err.lower() or "column" in err.lower():
                log.warning(f"Skipping DDL (extension/column unavailable): {err[:120]}")
            else:
                raise
