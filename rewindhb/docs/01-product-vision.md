# RecallOS — Product Vision

## One-line vision
**RecallOS is "Google Search for your own browsing memory."** An AI second brain that quietly remembers everything you browse and lets you retrieve it with natural language.

## Why it matters
Humans don't remember filenames, URLs, or folders. They remember **ideas**.
A week from now you won't remember that the GitHub repo you loved was at `github.com/anthropic/experimental-mcp`, but you'll remember *"the authentication thing with Claude."*

## What it is
A Chrome extension + a web dashboard.
- The extension silently watches pages you visit and writes a lightweight AI memory snapshot for each one.
- The web app is the interface — spotlight search, timeline, graph, smart collections, context resume.

## What it is not
- Not a bookmark manager.
- Not a notes app.
- Not a chatbot.
- Not a productivity suite.
- Not an OS (yet — see roadmap).

## The single promise
*"You will never lose a useful thing you saw online."*

## Design tension we resolved
The brief asks for "Google Search for your own memory" while listing Apple/Arc/Raycast/Linear/Notion as inspiration. We commit to **Raycast-as-the-shell** (dark, keyboard-first, command bar) and **Linear-as-the-data** (tight, dense, precise, opinionated about hierarchy). One accent (electric violet). One accent only. Glassmorphism reserved for the search overlay — never as a default surface treatment.
