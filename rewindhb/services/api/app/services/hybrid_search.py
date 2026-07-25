"""Hybrid search fusion — combines vector + keyword + freshness scores."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Sequence


def hybrid_fuse(
    candidates: Sequence,
    kw_scores: dict,
    top_k: int = 10,
    alpha: float = 0.7,
    beta: float = 0.2,
    gamma: float = 0.1,
) -> list[dict]:
    """Combine cosine, BM25, and freshness into a single ranking.

    Args:
        candidates: rows with .id, .url, .title, .summary, .category, .tags,
                    .visited_at, .vec_score
        kw_scores:  {memory_id: ts_rank}
        top_k:      how many to return

    Returns:
        list of dicts sorted by final_score desc
    """
    if not candidates:
        return []

    # Normalize BM25 across the candidate set (min-max)
    kw_vals = [kw_scores.get(c.id, 0.0) or 0.0 for c in candidates]
    kw_max = max(kw_vals) if kw_vals else 1.0
    kw_min = min(kw_vals) if kw_vals else 0.0
    kw_range = (kw_max - kw_min) or 1.0

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    matches = []
    for c in candidates:
        vec = float(c.vec_score or 0.0)
        kw_norm = ((kw_scores.get(c.id, 0.0) or 0.0) - kw_min) / kw_range
        # Freshness — exp decay over 30 days
        visited_at = c.visited_at.replace(tzinfo=timezone.utc) if c.visited_at.tzinfo is None else c.visited_at.astimezone(timezone.utc)
        age_days = max(0.0, (now - visited_at).total_seconds() / 86400.0)
        fresh = math.exp(-age_days / 30.0)
        final = alpha * vec + beta * kw_norm + gamma * fresh
        matches.append({
            "memory_id": c.id,
            "url": c.url,
            "title": c.title,
            "summary": c.summary,
            "category": c.category,
            "tags": c.tags or [],
            "visited_at": c.visited_at,
            "score": round(final, 4),
            "matched_field": "embedding+title" if vec > 0.5 else "title",
        })

    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches[:top_k]
