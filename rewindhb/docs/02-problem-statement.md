# Problem Statement

## The experience everyone has

```
Monday   →  Open 14 tabs of "interesting stuff."
Friday   →  "I saw something great on Monday… where was it?"

         →  scroll Chrome history (chronological, useless)
         →  Cmd+F bookmark manager (empty, nothing is bookmarked)
         →  try Google's `site:` operators (forgot the site)
         →  give up. The thing is gone.
```

This is the daily lived experience of every curious person online. The average knowledge worker discovers **40–80 useful web artifacts per week** (repos, articles, docs, recipes, posts) and retrieves maybe **5** of them later. The other 35–75 are silently lost.

## The cost

- **Re-finding time.** Average knowledge worker spends ~5.5 hrs/week re-finding information they already saw. (Source: McKinsey, 2012 — still cited because nothing has changed.)
- **Lost signal.** The thing you saw *once* was probably the highest-leverage thing you'll see all week. Letting it die in browser history is leaking attention.
- **Invisible context.** "That internship email mentioning ₹50k" is a complete thought. We have no system that holds thoughts at the level of ideas instead of URLs.

## Why existing tools fail

| Tool          | Failure mode                                            |
|---------------|---------------------------------------------------------|
| Browser history | Chronological, not semantic.                           |
| Bookmarks      | Requires the act of saving. 80% of useful things never get saved. |
| Google         | Knows the public web, not *your* private stream of it. |
| Notion         | Requires you to write. We forget the moment we read.   |
| Read-later apps | Same as bookmarks, with a guilt layer.                 |
| AI chatbots    | No memory of what *you* saw. Generic.                   |

## The thesis

**The browser is a memory leak.** Every page you visit leaves a residue of context that evaporates within hours. RecallOS turns that residue into a queryable, semantic memory — without requiring you to save anything.

## Who this hurts most

- **Students** doing research across courses.
- **Engineers** discovering tools, repos, docs, StackOverflow answers.
- **Founders & PMs** collecting competitive intel, ideas, references.
- **Designers** gathering inspiration.
- **Anyone** with a curious browsing habit and a finite brain.
