# Roadmap

## Phase 0 — Hackathon MVP (24 hours)

- Chrome extension (Manifest V3) — passive page capture
- AI summary, tags, category, embedding per page
- Postgres + pgvector backend, FastAPI
- Dashboard: timeline, memory detail, collections
- Spotlight search (Cmd+K)
- Smart Collections (auto-cluster)
- Context Resume
- Sign-in with Google

**Definition of done:** A judge can install the extension, browse 10 pages, then on stage say *"react auth repo last week"* and find the right one in under 2 seconds.

## Phase 1 — Post-hackathon polish (weeks 1–4)

- **Memory Graph** — force-directed visualization of related memories.
- **Per-collection AI descriptions** — LLM generates a 1-sentence description of each cluster.
- **Email digest** — daily summary email of the user's browsing highlights.
- **Mobile-responsive dashboard** — works on iPad / phones.
- **Cross-device sync** — sign in once, memory on all machines.
- **Keyboard navigation** — j/k for next/prev memory card, Cmd+K for spotlight from anywhere.
- **Bulk operations** — multi-select memories, delete / pin / move to collection.
- **Better empty states & onboarding.**

## Phase 2 — Beyond the browser (months 2–3)

- **Gmail connector** — read-only OAuth, snapshots each email's subject + body excerpt.
- **Google Drive** — snapshots for Docs, Sheets, Slides, PDFs.
- **Notion** — per-page snapshots.
- **VS Code extension** — snapshots of opened files.
- **Local file watcher** — captures Documents/Downloads.

## Phase 3 — OS-wide memory (months 4–6)

- **Desktop agent** (Tauri or Electron) — captures from any app, not just browser.
- **Cross-app search** — "the design doc I edited yesterday" works whether it was in Notion, Google Docs, or VS Code.
- **macOS first** (Apple Silicon), then Windows.

## Phase 4 — Mobile & ambient (months 6–9)

- **iOS share-sheet extension** — capture from any app, save to RecallOS.
- **Android share-sheet.**
- **Apple Watch / Wear OS glance** — "what did I see today?"
- **Siri / Google Assistant integration** — "Hey Siri, find that recipe I saw Friday."

## Phase 5 — Proactive AI (months 9–12)

- **Daily morning briefing** — what you read, what was new in your areas of interest, what to revisit.
- **Recommendations** — "You read 6 things about LangGraph last week. Here's a new paper on it."
- **Auto-recollections** — "Last year this week you read X. Want to revisit?"
- **Knowledge graph** — connect ideas across weeks ("you first read about transformers in March 2025, then revisited in August, here's how your understanding evolved").

## Phase 6 — Team & enterprise (year 2)

- **Team workspaces** — shared memory for an org.
- **SSO** — Google Workspace, Okta, Microsoft Entra.
- **Compliance** — SOC 2, GDPR, HIPAA-aligned data handling.
- **API & SDK** — third-party apps can read your memory (with consent).
- **Mobile apps** — first-class iOS / Android.

## Phase 7 — Platform (year 2+)

- **Public memory API** — controlled, opt-in. "Share this memory cluster publicly."
- **Marketplace** — community-built smart collections.
- **Plugins** — third-party connectors for any data source.

## What we are deliberately NOT building

- A full-blown productivity suite (calendar, tasks, notes). RecallOS is *retrieval*, not *creation*.
- A social feed. Memory is private by default.
- A chatbot as the primary surface. Search is the surface.
- An OS. Yet. (Phase 3 begins to flirt with this; the proper OS-wide layer is Phase 5+.)
