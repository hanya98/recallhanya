# Information Architecture

## App map (top-level routes)

```
/                       Dashboard        (Monitor surface — today's timeline)
/search                 Spotlight        (Command surface — Cmd+K overlay default)
/memories               Memory list      (Explore surface — all memories, filterable)
/memories/:id           Memory detail    (Inspect surface — full summary + related)
/collections            Collections index(Explore — auto + manual groups)
/collections/:slug      Collection view  (Explore — focused cluster)
/graph                   Memory graph     (Explore — visual clusters)
/settings               Settings         (Configure surface)
/onboarding             First-run flow   (Configure)
```

## Primary nav (left rail, 64px wide)

```
┌──────┐
│ ◉    │  ← logo + accent dot, top
│      │
│ ▣    │  Timeline (default)
│ ◇    │  Search (Cmd+K)
│ ☰    │  All memories
│ ⌘    │  Collections
│ ⌬    │  Graph
│      │
│ ───  │
│ ⚙    │  Settings (bottom)
│ ◐    │  Theme toggle
│ AA   │  User avatar
└──────┘
```

## Spotlight overlay (Cmd+K)

```
┌─────────────────────────────────────────────┐
│  🔍  react auth repo last week           ⌫  │
├─────────────────────────────────────────────┤
│  TOP MATCH                                  │
│  ┌────────────────────────────────────┐    │
│  │ 🟣 GitHub · nextauthjs/next-auth   │    │
│  │ Auth library for Next.js with 200+│    │
│  │ providers. Open source. MIT.       │    │
│  │ 3 days ago · github.com            │    │
│  │                          [ Open ] │    │
│  └────────────────────────────────────┘    │
│                                             │
│  RELATED                                    │
│  · 📝 "How to add Google login" — medium    │
│  · 🎥 NextAuth tutorial — youtube           │
│  · 💬 StackOverflow: JWT in Next.js — so    │
│                                             │
│  ↑↓ navigate · ↵ open · ⌘↵ open all related │
└─────────────────────────────────────────────┘
```

## Memory card anatomy

```
┌──────────────────────────────────────────┐
│ 🌐  github.com/nextauthjs/next-auth      │ ← favicon + URL
│                                          │
│ NextAuth.js — Authentication for Next.js │ ← original title
│                                          │
│ ┌──────── AI SUMMARY ────────────────┐   │
│ │ Auth library for Next.js with      │   │
│ │ 200+ OAuth providers. MIT license. │   │
│ │ Drop-in middleware.                │   │
│ └────────────────────────────────────┘   │
│                                          │
│ #auth  #nextjs  #oauth  #opensource       │ ← auto tags (monospace)
│                                          │
│ 3 days ago · Tuesday 4:12pm              │
│                                          │
│ [Open]   [Related ▾]   [⋯]               │
└──────────────────────────────────────────┘
```

## Dashboard layout (Monitor surface — primary screen)

```
┌─────────┬───────────────────────────────────────┐
│         │                                       │
│  NAV    │   Today, July 25                      │
│         │   ───────────                         │
│         │   12 memories · 3 new collections    │
│         │                                       │
│         │   ┌─────────────────────────────────┐ │
│         │   │ 9:42am · arxiv.org              │ │
│         │   │ "Attention Is All You Need"     │ │
│         │   │ The original transformer paper. │ │
│         │   │ #ai #research #paper    [Open]  │ │
│         │   └─────────────────────────────────┘ │
│         │   ┌─────────────────────────────────┐ │
│         │   │ 11:15am · github.com            │ │
│         │   │ ...                             │ │
│         │   └─────────────────────────────────┘ │
│         │                                       │
│         │                                       │
│         │   [Spotlight: ⌘K to search]          │
└─────────┴───────────────────────────────────────┘
```

## Hierarchy rules

- **One primary CTA per screen.** Dashboard: nothing. Spotlight: the top match. Memory detail: Open.
- **Tertiary actions live behind `⋯`.** Delete, mute domain, report.
- **No modals except Spotlight.** Everything else is an inline expansion or a route.
- **No tabs.** Use cards or routes.
- **Settings is one scrollable page.** No nested settings trees.
