# API Endpoints

## Base URL
`https://api.recallos.com`

All endpoints require `Authorization: Bearer <jwt>` unless noted. JWT is obtained from Google OAuth.

## Conventions

- **Request bodies:** JSON. Dates in ISO 8601.
- **Response bodies:** JSON. Snake_case keys. Times in UTC ISO 8601.
- **Errors:** `{ "error": { "code": "string", "message": "string", "request_id": "uuid" } }`
- **Status codes:** standard REST.
- **Pagination:** cursor-based (`?cursor=<id>&limit=20`). For listing endpoints.
- **Idempotency:** `Idempotency-Key` header on POSTs that may be retried.

---

## Auth

### `POST /v1/auth/google`
Exchange Google ID token for a RecallOS JWT.

**Request**
```json
{ "id_token": "..." }
```

**Response 200**
```json
{
  "jwt": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "you@example.com",
    "display_name": "...",
    "avatar_url": "...",
    "plan": "free",
    "capture_paused": false
  }
}
```

---

## Memories

### `POST /v1/memories`
Capture a new memory (called by extension).

**Request**
```json
{
  "url": "https://github.com/nextauthjs/next-auth",
  "title": "NextAuth.js",
  "excerpt": "Authentication for Next.js...",
  "favicon_url": "https://github.com/favicon.ico",
  "visited_at": "2026-07-25T11:15:42Z",
  "content_type": "text/html",
  "dedup_key": "sha256(url+visited_at_minute)"
}
```

**Response 202**
```json
{ "memory_id": "uuid", "status": "processing" }
```

If a memory with the same `(user_id, dedup_key)` already exists, returns 200 with `{ "memory_id": "...", "status": "duplicate" }`.

### `GET /v1/memories`
List the user's memories.

**Query**
- `cursor` — pagination cursor (memory id)
- `limit` — default 20, max 100
- `since` — ISO timestamp, default 30 days ago
- `until` — ISO timestamp, default now
- `category` — repeatable, e.g. `?category=repo&category=article`
- `domain` — repeatable
- `tag` — repeatable
- `collection_id` — UUID
- `q` — keyword fallback search (no embedding, uses tsvector)
- `status` — `processing` | `ready` (default `ready`)

**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "url": "https://github.com/...",
      "domain": "github.com",
      "title": "NextAuth.js",
      "summary": "Auth library for Next.js with 200+ OAuth providers. MIT license.",
      "category": "repo",
      "tags": ["auth","nextjs","oauth"],
      "visited_at": "2026-07-25T11:15:42Z",
      "favicon_url": "..."
    }
  ],
  "next_cursor": "uuid|null"
}
```

### `GET /v1/memories/:id`
Fetch one memory.

**Response 200** — full memory object including `excerpt_clean` and `related[]` (top 5 by similarity).

### `DELETE /v1/memories/:id`
Soft-delete a memory. Returns 204.

### `POST /v1/memories/bulk-delete`
```json
{ "ids": ["uuid", "uuid", ...] }
```
Returns `{ "deleted": 3 }`.

### `PATCH /v1/memories/:id`
Update memory user-controlled fields:
```json
{ "pinned": true, "tags": ["custom","tag"] }
```

---

## Search

### `POST /v1/search`
Semantic + keyword hybrid search.

**Request**
```json
{
  "query": "react auth repo last week",
  "limit": 10,
  "since": "2026-07-18T00:00:00Z",
  "categories": ["repo","article"],
  "use_llm_rerank": false
}
```

**Response 200**
```json
{
  "query_id": "uuid",
  "matches": [
    {
      "memory_id": "uuid",
      "url": "https://github.com/...",
      "title": "NextAuth.js",
      "summary": "Auth library for Next.js...",
      "category": "repo",
      "tags": ["auth","nextjs","oauth"],
      "visited_at": "...",
      "score": 0.89,
      "matched_field": "embedding+title"
    }
  ],
  "related": [
    { "memory_id": "uuid", "title": "...", "score": 0.74 }
  ],
  "session_resume": null
}
```

### `GET /v1/search/recent`
Last 20 queries the user ran.

---

## Collections

### `GET /v1/collections`
List collections for current user.

**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "slug": "ai-research",
      "title": "AI Research",
      "description": "Papers, repos, and posts about transformer architectures and interpretability.",
      "color": "#8B5CF6",
      "icon": "🧠",
      "source": "auto",
      "member_count": 14,
      "last_activity_at": "..."
    }
  ]
}
```

### `POST /v1/collections`
Manually create a collection.

```json
{ "title": "Recipes", "description": "...", "color": "#10B981", "icon": "🍝" }
```

### `POST /v1/collections/:id/resume`
Reopen all memories in a collection (Context Resume).

**Response 200**
```json
{
  "session_id": "uuid",
  "urls": ["https://...","https://..."],
  "count": 6
}
```
The extension uses `chrome.tabs.create({ url })` for each.

### `PATCH /v1/collections/:id`
Update title, description, color. Also allows the user to override auto-cluster.

### `DELETE /v1/collections/:id`
Delete a collection. Memories are NOT deleted.

### `POST /v1/collections/recompute`
Force a re-cluster of all the user's memories into Smart Collections.

---

## Graph

### `GET /v1/graph`
Returns nodes and edges for the Memory Graph view.

**Query**
- `collection_id` — optional, scope to a collection
- `since` — date filter

**Response 200**
```json
{
  "nodes": [
    { "id": "uuid", "title": "...", "category": "repo", "tags": [...], "domain": "...", "size": 1 }
  ],
  "edges": [
    { "source": "uuid", "target": "uuid", "weight": 0.83, "type": "similar" }
  ]
}
```

---

## Settings

### `GET /v1/settings`
### `PATCH /v1/settings`

```json
{
  "capture_paused": false,
  "theme": "dark",
  "blocklist_domains": ["bank.example.com"],
  "capture_categories": ["repo","article","video","doc"],
  "capture_max_per_day": 500
}
```

---

## Health

### `GET /healthz`
Returns `{ "ok": true }`.

### `GET /readyz`
Checks DB + Redis. Returns 200 only when all healthy.
