# CLAUDE.md — MemoryClaw

## Project Overview

MemoryClaw is a **brain-inspired, hierarchical memory system** built as a plugin layer for the [OpenClaw](https://github.com/openclaw) personal AI assistant. It replaces opaque vector embeddings with file-based storage and transparent retrieval, reducing token consumption and making every memory operation debuggable.

## Architecture

### Four-Tier Memory Hierarchy

1. **Working Memory** — In-memory JSON for the current task/session context (~2k tokens max)
2. **Episodic Memory** — Compressed markdown files with YAML frontmatter in `memoryclaw/episodes/`
3. **Semantic Memory** — Persistent facts (contacts, preferences, projects) in `memoryclaw/semantic/`
4. **Procedural Memory** — Reusable skill files (JSON/JS) in `memoryclaw/skills/`

### Key Components

- **Retrieval plugin** (`memoryclaw_retrieve`) — Keyword/tag search with optional vector fallback via local embeddings (Ollama)
- **Logging plugin** (`memoryclaw_log`) — Raw interaction logging to `memoryclaw/logs/`
- **Consolidation daemon** — Cron-based Node.js script that summarizes raw logs, extracts facts, detects action patterns
- **Skill compiler** (experimental) — Auto-generates reusable skill templates from repeated action sequences

### Retrieval Pipeline

```
User query → Keyword extraction → Synonym/alias expansion
  → Episode search (primary, keyword/tag matching)
  → If results < minPrimaryResults and fallback=vector → Vector search
  → Blend results (keyword first) → Semantic fact lookup → Inject into working memory
```

## Directory Structure

```
memoryclaw/
├── episodes/          # Episodic memory (markdown + YAML frontmatter)
├── semantic/          # Semantic memory (contacts.md, projects.md, preferences.md, _pending.md)
├── skills/            # Procedural memory (JSON/JS skill files)
├── logs/              # Raw interaction logs
│   └── processed/     # Processed logs
├── index/             # Inverted index (SQLite) for fast search
├── daemon/            # Consolidation scripts
│   ├── consolidate.js
│   └── detect_patterns.js
└── config.yaml        # MemoryClaw configuration
```

## Design Philosophy

- **Keyword-first is the core differentiator.** MemoryClaw is not "another RAG system." Transparent, explainable retrieval is the value proposition. Vector search is a fallback, not the primary path.
- **80/20 rule:** Keyword/tag matching handles ~80% of queries transparently. Vector fallback catches the ~20% where keyword search silently fails (paraphrasing, cross-domain links, vague queries).
- **Configurable LLM backend:** Ollama is the default for privacy, but the system accepts any OpenAI-compatible API endpoint (Groq, Together, cloud providers). The consolidation daemon just needs a chat completion endpoint.
- **Synonym/alias expansion:** Before falling back to vectors, expand keywords via an alias map (e.g., "marketing" → "campaign-team", "budget" → "finance"). This reduces how often the vector fallback is needed.
- **Never pay the cost of opacity unless necessary.** Vector fallback only triggers when keyword search returns fewer than `minPrimaryResults`.

## Tech Stack

- **Runtime:** Bun (TypeScript, ES modules)
- **Storage:** Markdown files with YAML frontmatter, SQLite for indexing
- **LLM backend:** Configurable — Ollama (default, local/private), or any OpenAI-compatible API endpoint
- **Embedding models:** Configurable — nomic-embed via Ollama (default), or any compatible embedding API
- **Configuration:** YAML
- **Testing:** Vitest
- **Parent platform:** OpenClaw (skills, cron, tools ecosystem)

## Coding Conventions

- Use ES modules (`import`/`export`) — not CommonJS
- Skill files export a default object with `name`, `triggers`, and `run(params, context)` method
- Episode filenames follow `YYYY-MM-DD_HH-MM-SS_summary.md` convention
- YAML frontmatter in episodes must include: `timestamp`, `tags`, `summary`, `participants`, `confidence`
- Facts extracted with low confidence go to `_pending.md`, not canonical semantic files
- All auto-generated skills require explicit user approval — never auto-activate

## Configuration Reference

Key settings in `memoryclaw/config.yaml`:

```yaml
retrieval:
  primary: keyword
  minPrimaryResults: 2
  fallback: vector | none
  vectorModel: nomic-embed
  maxResults: 5
  blendStrategy: primary_first

llm:
  provider: ollama              # ollama | openai-compatible
  baseUrl: http://localhost:11434  # any OpenAI-compatible endpoint
  model: llama3:8b              # for summarization
  embeddingModel: nomic-embed   # for vector fallback
  apiKey: ""                    # only needed for cloud providers

consolidation:
  interval: 60  # minutes
  skillThreshold: 7  # occurrences before suggesting a skill
  factValidation: true
  pendingReview: true
```

## Error Handling Principles

- Summaries include a `confidence` field (low/medium/high)
- Facts include a `source` field referencing the originating log
- Contradictory facts are flagged for user review, not silently overwritten
- Raw logs are preserved (not deleted) for re-processing capability
- Schema validation on extracted facts before writing to semantic memory

## Security

- Memory files: `0600` permissions; directories: `0700`
- Summarization prompts instruct LLM to omit passwords, API keys, tokens
- Post-processing regex scanner catches leaked secret patterns
- Ollama configured to listen only on localhost

## User Commands

- `/memories audit` — Review recently added facts and episode summaries
- `/memories search <query>` — Manual memory search
- `/memories delete <id>` — Remove specific facts
- `/memories list` — List stored memories
- `/forget <topic>` — Remove memories about a topic

## Development Phases

The project follows a phased roadmap:
- **Phase 0:** Foundation / repo setup
- **Phase 1:** Core retrieval + hybrid fallback
- **Phase 2:** Logging and raw storage
- **Phase 3:** Consolidation daemon
- **Phase 4:** Semantic memory updates
- **Phase 5:** Skill compilation (experimental)
- **Phase 6:** Working memory injection (`onBeforeLLM` hook)
- **Phase 7:** Optimization and scaling (SQLite, web UI, ClawHub)

## Testing

- Test retrieval quality across: exact match, paraphrase, vague queries
- Validate summarization output against schemas
- Test skill compilation with conservative thresholds
- Verify deduplication and conflict detection in semantic updates
