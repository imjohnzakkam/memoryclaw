---
name: memoryclaw-retrieve
description: Retrieve relevant past memories (episodes + facts) before responding to user queries. Transparent keyword-first retrieval with optional vector fallback.
metadata: { "openclaw": { "always": true, "emoji": "🧠" } }
---

# MemoryClaw Retrieval

You have access to MemoryClaw, a hierarchical memory system that stores past interactions as compressed episodes and extracted facts.

## When to Use

Before answering a user query that could benefit from past context, memory is **automatically injected** into your system prompt via the `agent:beforeLLM` hook. You do not need to call a tool manually.

The injected context appears under `**[MemoryClaw Working Memory]**` and includes:

- **Relevant Past Interactions** — matched episodes from keyword/tag search (with optional vector fallback)
- **Retrieved Facts** — semantic facts (contacts, projects, preferences) matching entities in the query
- **Current Goal** — the active task context
- **Known Facts** — facts accumulated during the current session

## How Retrieval Works

1. Keywords are extracted from the user's latest message
2. Keywords are expanded via synonym/alias mappings
3. Episodes are searched by tag and summary matching
4. If too few results, an optional vector similarity fallback triggers
5. Semantic facts are looked up by entity name
6. Results are injected into the system prompt (~400–800 tokens)

## User Memory Commands

Users can manage their memories via slash commands:

- `/mclaw audit [limit]` — Show recent episodes and pending facts
- `/mclaw search <query>` — Search memories by keyword
- `/mclaw delete <filename>` — Delete an episode
- `/mclaw delete-fact <file> <key>` — Delete a semantic fact
- `/mclaw skills` — List compiled skills
- `/mclaw patterns [threshold]` — Detect action patterns
- `/mclaw-forget <filename>` — Quick delete an episode
- `/mclaw-consolidate` — Manually trigger log → episode processing

## Important Notes

- All memory is stored in human-readable markdown files on the user's machine
- No data leaves the local machine unless the user configures a remote LLM
- Low-confidence facts go to `_pending.md` for user review before promotion
- Conflicting facts are flagged, never silently overwritten
