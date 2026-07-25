# Demo Script — RecallOS

**Total runtime:** 3 minutes
**Setup:** Stage laptop with RecallOS dashboard open in one tab, a few Chrome tabs pre-browsed (extension installed), and an empty Spotlight.

## Pre-demo (1 minute before stage)

- [ ] Extension installed, capturing paused state confirmed off
- [ ] Logged in as `demo@recallos.com`
- [ ] Dashboard at `/timeline` — should show ~30 memories
- [ ] Spotlight overlay ready to fire via Cmd+K
- [ ] Graph view bookmarked at `/graph`
- [ ] Memory detail page for "Attention Is All You Need" loaded
- [ ] Laptop plugged in, demo mode enabled (notifications off)

---

## The Script

### 0:00 — Cold open (15 seconds)

> "I'm Aarav. Last Tuesday I read a paper about transformers, a Karpathy tutorial, a Stripe internship email, three recipes, and a Hacker News thread about MCP. It's Saturday. I want to find one of those things. I have no idea where I saw it."
>
> "Watch this."

Open Spotlight: press **Cmd+K**.

Type: `react auth repo last week`

> "I never bookmarked it. I just remember the idea. RecallOS remembers too."

Press **Enter**.

Result: Top match is the `nextauthjs/next-auth` GitHub repo with AI summary.

> "Found it. AI summary, tags, link. Took 87 milliseconds."

### 0:30 — Context Resume (30 seconds)

Scroll to the "Context Resume" block at the bottom of Spotlight.

> "But here's the bigger thing. Last Tuesday I was deep in a research session about AI. I had six tabs open. I closed my laptop. Watch."

Click **"Resume 6 tabs"**.

Six tabs open instantly: the arxiv paper, the Karpathy video, the HuggingFace repo, the FlashAttention paper, a blog post, a Twitter thread.

> "RecallOS doesn't just find one tab. It picks up where I left off."

Close the extra tabs.

### 1:00 — Smart Collections (30 seconds)

Switch to dashboard tab. Scroll up.

> "Look at this — RecallOS auto-grouped those six things into a collection called 'AI Research.' It did that without me telling it to. It just noticed they belonged together."

Click into the **AI Research** collection.

> "Every memory I had this week, organized by topic. No folders, no tags."

Scroll through the timeline showing all 14 memories in the collection.

### 1:30 — Memory Detail (30 seconds)

Click on the **Attention Is All You Need** card.

> "Every memory gets a page. AI summary on top — the thing you actually remember. Tags below. Excerpt of the original. And the killer feature: related memories."

Scroll to "Related memories" section.

> "These five weren't tagged the same. They don't share a folder. RecallOS connected them because the *concepts* are similar. Click any one — boom, you're back in the paper you were reading three days ago."

### 2:00 — Memory Graph (30 seconds)

Navigate to **Graph**.

> "This is every memory I've made this week, organized by topic. The bigger the cluster, the more time I spent there."

Point to AI Research cluster.

> "Purple is AI Research. Blue is Dev Tools. Yellow is Recipes. Indigo is Internship Search. Each node is one page. Each line is a relationship RecallOS found."

Click on the "Attention" node.

> "Click any node — you get the full inspector on the right. Title, summary, related memories, the cluster it belongs to."

Click **Resume** in the inspector.

> "And — one click — we're back in the session."

### 2:30 — Privacy (15 seconds)

Click the extension icon → settings.

> "One thing we care about: privacy. Pause capture — instant. Delete everything — one click. We never store the raw HTML of any page. Just title, URL, AI summary. End-to-end private. Never trained on."

### 2:45 — Close (15 seconds)

> "RecallOS. Google Search for your own browsing memory. Free extension, free dashboard. Chrome Web Store link in the README. Thank you."

---

## Failure modes & contingencies

| If...                                 | Then...                                                              |
|---------------------------------------|----------------------------------------------------------------------|
| Spotlight doesn't open                | Use the dashboard search bar at the top — same backend                |
| Search returns no results             | Type a broader query: `auth` instead of `react auth repo last week`  |
| Demo WiFi dies                        | Demo runs entirely client-side; only the *new* capture needs network |
| Memory card image doesn't load        | All assets are inline — there is no remote dependency                |
| The extension isn't capturing         | Use the seeded dashboard data — pre-loaded with 30 memories          |
| Judge asks about cost                 | "$0.77/user/month at 1k MAU. Detailed in /docs/07."                  |
| Judge asks about privacy              | "We never store raw HTML. Only title, URL, summary, tags. /docs/."   |
| Judge asks about OS support           | "Not yet. Roadmap calls for a desktop agent in 6 months."            |
| Judge asks "what if I clear history?" | "RecallOS is separate from Chrome history. Independent."             |
| Judge asks about scaling              | "pgvector scales to ~5M memories per user. Beyond that, Pinecone."   |

---

## Tagline options (pick one for the close)

- *"RecallOS — Google Search for your own browsing memory."*
- *"You will never lose a useful thing you saw online."*
- *"RecallOS — the second brain you don't have to write to."*

---

## Speaker notes

- Talk slow at the **Resume** moment. The audience needs to register that *six tabs opened in one click*.
- Pause before clicking the Graph node. Let the visual land.
- Don't read the AI summaries aloud. Let the audience read them.
- Don't mention the word "AI" more than 4 times in the whole demo. The product speaks for itself.
