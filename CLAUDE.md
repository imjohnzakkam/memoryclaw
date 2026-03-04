# CLAUDE.md — MemoryClaw

## Project Overview

MemoryClaw is a **brain-inspired, hierarchical memory system** built as a plugin layer for the [OpenClaw](https://github.com/openclaw) personal AI assistant. It replaces opaque vector embeddings with file-based storage and transparent retrieval, reducing token consumption and making every memory operation debuggable.

## Architecture

### Four-Tier Memory Hierarchy

1. **Working Memory** — In-memory JSON for the current task/session context (~2k tokens max)
2. **Episodic Memory** — Compressed markdown files with YAML frontmatter in `memoryclaw/episodes/`
3. **Semantic Memory** — Persistent facts (contacts, preferences, projects) in `memoryclaw/semantic/`
4. **Procedural Memory** — Reusable skill files (JSON) in `memoryclaw/skills/`

### Source Modules

| Module | Purpose |
|--------|---------|
| `src/config.ts` | YAML config loader with defaults |
| `src/keywords.ts` | Keyword extraction with stop word removal |
| `src/aliases.ts` | Synonym/alias expansion from `aliases.yaml` |
| `src/episodic.ts` | Episode file parsing (gray-matter) + scored keyword search |
| `src/semantic.ts` | Semantic fact entity lookup |
| `src/vector.ts` | Vector fallback — Ollama or OpenAI-compatible embedding APIs |
| `src/retrieve.ts` | Full retrieval pipeline orchestrator |
| `src/logger.ts` | Raw interaction logging (markdown + YAML frontmatter) |
| `src/llm.ts` | Chat completion abstraction (Ollama / OpenAI-compatible) |
| `src/consolidate.ts` | Consolidation daemon: logs → episodes + facts |
| `src/semantic-writer.ts` | Semantic memory updates with dedup + conflict detection |
| `src/memories.ts` | User commands: audit, search, delete |
| `src/patterns.ts` | Pattern detection from episode tag sequences |
| `src/skill-compiler.ts` | Skill template generation + approval workflow |
| `src/working-memory.ts` | Working memory manager + `onBeforeLLM` hook |
| `src/indexer.ts` | SQLite FTS5 inverted index for fast search at scale |
| `src/cli.ts` | CLI entry point for all MemoryClaw commands |
| `src/plugin.ts` | OpenClaw plugin entry point (hooks, commands, services) |
| `src/index.ts` | Public API re-exports |

### Retrieval Pipeline

```
User query → Keyword extraction → Synonym/alias expansion
  → Episode search (keyword/tag scoring)
  → If results < minPrimaryResults and fallback=vector → Vector search
  → Blend results (keyword first) → Semantic fact lookup → Inject into working memory
```

## Directory Structure

```
src/                       # TypeScript source
tests/                     # Vitest test files
memoryclaw/
├── episodes/              # Episodic memory (markdown + YAML frontmatter)
├── semantic/              # Semantic files + aliases.yaml + _pending.md
├── skills/                # Skill files (draft/approved JSON)
├── logs/                  # Raw interaction logs
│   └── processed/         # Processed logs
├── index/                 # SQLite FTS5 index (episodes.db)
└── config.yaml            # MemoryClaw configuration
```

## Design Philosophy

- **Keyword-first is the core differentiator.** Transparent, explainable retrieval. Not another RAG system.
- **80/20 rule:** Keyword/tag matching handles ~80% transparently. Vector fallback catches the ~20% where keywords fail.
- **Configurable LLM backend:** Ollama default for privacy; accepts any OpenAI-compatible endpoint.
- **Synonym/alias expansion:** Expand keywords via alias map before falling back to vectors.
- **Never pay the cost of opacity unless necessary.** Vector fallback only triggers when keyword search comes up short.

## Tech Stack

- **Runtime:** Bun (TypeScript, ES modules)
- **Storage:** Markdown + YAML frontmatter, SQLite FTS5 for indexing
- **LLM:** Configurable — Ollama (default) or any OpenAI-compatible API
- **Dependencies:** gray-matter, yaml, better-sqlite3
- **Testing:** Vitest
- **Parent platform:** OpenClaw

## CLI

```bash
bun run src/cli.ts <command> [args]

# Retrieval
  retrieve <query>          Search episodes + facts
  search <query>            Search memories by keyword

# Memory management
  audit [limit]             Show recent episodes and pending facts
  delete <filename>         Delete an episode
  delete-fact <file> <key>  Delete a fact from a semantic file

# Consolidation
  consolidate               Process raw logs into episodes

# Skills
  patterns [threshold]      Detect repeated action patterns
  compile [threshold]       Generate draft skills from patterns
  skills                    List all skills
  approve-skill <file>      Approve a draft skill
  reject-skill <file>       Reject a draft skill

# Indexing
  index                     Build/rebuild SQLite search index
  index-search <query>      Search using the SQLite index
```

## Configuration Reference

```yaml
memoryclaw:
  disableDefaultMemory: true
  path: ./memoryclaw
  retrieval:
    primary: keyword
    minPrimaryResults: 2
    fallback: none | vector
    maxResults: 5
    blendStrategy: primary_first
  llm:
    provider: ollama | openai-compatible
    baseUrl: http://localhost:11434
    model: llama3:8b
    embeddingModel: nomic-embed
    apiKey: ""
  consolidation:
    interval: 60
    skillThreshold: 7
    factValidation: true
    pendingReview: true
  semantic:
    files: [contacts.md, projects.md]
```

## Coding Conventions

- ES modules (`import`/`export`) only — no CommonJS
- Episode filenames: `YYYY-MM-DD_HH-MM-SS_summary.md`
- Log filenames: `YYYY-MM-DD_HH-MM-SS_channel_raw.md` (human-readable, no ISO `T` separator)
- YAML frontmatter must include: `timestamp`, `tags`, `summary`, `participants`, `confidence`
- Low-confidence facts → `_pending.md`, not canonical files
- Auto-generated skills require explicit user approval
- File permissions: `0600` for files, `0700` for directories
- **Data directory:** Always use absolute path `~/.openclaw/memoryclaw/` — never relative paths that depend on CWD
- **Content serialization:** NEVER write raw objects to log files. All message content must be serialized to string via `contentToString()`. Handle OpenClaw message shapes: `{text: "..."}`, `{type: "text", text: "..."}`, arrays of content blocks. Fall back to `JSON.stringify`, never produce `[object Object]`
- **Timestamps in log bodies:** Use human-readable format (`2025-04-08 14:32`) not raw epoch/ISO

## Error Handling

- `confidence` field on summaries (low/medium/high)
- `source` field on facts for traceability
- Contradictory facts flagged, not silently overwritten
- Raw logs preserved for re-processing
- Schema validation before writing to semantic memory

## Testing

Run: `bun test`

91 tests across 14 files covering:
- Keyword extraction, alias expansion
- Episode parsing, scoring, indexing (SQLite FTS5)
- Semantic lookup, dedup, conflict detection
- Consolidation pipeline (mocked LLM)
- Pattern detection, skill compilation, approval workflow
- Working memory lifecycle, prompt injection
- Logging format and file creation
- OpenClaw plugin registration (hooks, commands, services)
