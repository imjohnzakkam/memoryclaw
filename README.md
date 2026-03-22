<p align="center">
  <img src="assets/logo.png" alt="MemoryClaw" width="120" />
</p>

<h1 align="center">MemoryClaw</h1>

<p align="center">
  <strong>A brain-inspired memory system for AI agents.<br/>Transparent. Debuggable. No black boxes.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#cli">CLI</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/imjohnzakkam/memoryclaw/actions"><img src="https://img.shields.io/github/actions/workflow/status/imjohnzakkam/memoryclaw/ci.yml?branch=main&style=flat-square" alt="CI" /></a>
  <a href="https://github.com/imjohnzakkam/memoryclaw/blob/main/LICENSE"><img src="https://img.shields.io/github/license/imjohnzakkam/memoryclaw?style=flat-square" alt="License" /></a>
  <a href="https://github.com/imjohnzakkam/memoryclaw/stargazers"><img src="https://img.shields.io/github/stars/imjohnzakkam/memoryclaw?style=flat-square" alt="Stars" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-bun-f472b6?style=flat-square" alt="Bun" /></a>
</p>

---

Most AI memory systems are just vector search with extra steps. You can't read the memories, you can't debug why something was recalled, and you can't fix it when it breaks.

**MemoryClaw takes a different approach.** Every memory is a plain markdown file. Every retrieval is explainable — you can see exactly which keywords matched and why. Vector search exists only as a fallback for the ~20% of queries where keywords aren't enough.

```
"What did I discuss with Mahesh last week?"
  → keyword extraction: [mahesh, discuss, week]
  → alias expansion: [mahesh, mahes, discuss, talk, conversation, week]
  → 3 episodes matched (tags: mahesh, meeting)
  → 1 semantic fact found (Mahesh: works at Uber)
  → injected into working memory (412 tokens)
```

No embeddings computed. No API calls. Pure file I/O. **Fully transparent.**

---

## Why MemoryClaw?

| | Traditional RAG | MemoryClaw |
|---|---|---|
| **Storage** | Opaque vector embeddings | Plain markdown files you can read and edit |
| **Retrieval** | Black-box similarity search | Keyword + tag matching with explainable scoring |
| **Debuggability** | "Why was this recalled?" — Good luck | Every match shows exactly which keywords hit |
| **Cost** | Embedding API calls on every message | Zero API calls in default mode |
| **Privacy** | Often requires cloud APIs | 100% local by default (Ollama) |
| **Fallback** | N/A | Vector search kicks in only when keywords fail |

---

## How It Works

MemoryClaw implements a **four-tier memory hierarchy** inspired by human cognition:

```
┌─────────────────────────────────────────────────┐
│                 WORKING MEMORY                   │
│        Active context for current task           │
│              (~400-800 tokens)                   │
├─────────────────────────────────────────────────┤
│               EPISODIC MEMORY                    │
│     Compressed records of past interactions      │
│         Markdown + YAML frontmatter              │
├─────────────────────────────────────────────────┤
│               SEMANTIC MEMORY                    │
│       Persistent facts & relationships           │
│     contacts.md, projects.md, preferences.md     │
├─────────────────────────────────────────────────┤
│              PROCEDURAL MEMORY                   │
│    Reusable skills compiled from experience      │
│          Auto-generated, user-approved           │
└─────────────────────────────────────────────────┘
```

### The Retrieval Pipeline

```
User query
  │
  ├─→ Extract keywords ──→ Expand aliases/synonyms
  │                              │
  │                    ┌─────────┴─────────┐
  │                    │  Episode Search    │
  │                    │  (tag + summary    │
  │                    │   scoring)         │
  │                    └─────────┬─────────┘
  │                              │
  │              Results < threshold?
  │                    │              │
  │                   Yes             No
  │                    │              │
  │            Vector Fallback   Use keyword
  │            (optional)        results
  │                    │              │
  │                    └──────┬───────┘
  │                           │
  │                    Blend results
  │                           │
  │                  Semantic fact lookup
  │                           │
  │                  Inject into working memory
  │                           │
  └───────────────────→  LLM Call (~500 tokens)
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- [Ollama](https://ollama.ai) (optional, for consolidation + vector fallback)

### Install

```bash
git clone https://github.com/imjohnzakkam/memoryclaw.git
cd memoryclaw
bun install
```

### Run the CLI

```bash
# Search your memories
bun run src/cli.ts retrieve "meeting with John about project deadline"

# Audit recent memories
bun run src/cli.ts audit

# Process raw logs into episodes
bun run src/cli.ts consolidate

# Build the search index
bun run src/cli.ts index
```

### Run Tests

```bash
bun test
# 102 tests across 14 files
```

### Use as OpenClaw Plugin

```jsonc
// openclaw.plugin.json
{
  "name": "memoryclaw",
  "version": "0.1.0",
  "extensions": ["src/plugin.ts"]
}
```

MemoryClaw hooks into OpenClaw's lifecycle — logging interactions, retrieving context before LLM calls, and running consolidation as a background service.

---

## Architecture

```
src/
├── config.ts            # YAML config loader with defaults
├── keywords.ts          # Keyword extraction + stop word removal
├── aliases.ts           # Synonym/alias expansion
├── episodic.ts          # Episode parsing + scored keyword search
├── semantic.ts          # Semantic fact entity lookup
├── vector.ts            # Vector fallback (Ollama / OpenAI-compatible)
├── retrieve.ts          # Full retrieval pipeline orchestrator
├── logger.ts            # Raw interaction logging
├── llm.ts               # Chat completion abstraction
├── consolidate.ts       # Logs → episodes + facts (LLM-powered)
├── semantic-writer.ts   # Semantic updates with dedup + conflict detection
├── memories.ts          # User commands: audit, search, delete
├── patterns.ts          # Repeated action pattern detection
├── skill-compiler.ts    # Skill template generation + approval
├── working-memory.ts    # Working memory manager + onBeforeLLM hook
├── indexer.ts           # SQLite FTS5 inverted index
├── cli.ts               # CLI entry point
├── plugin.ts            # OpenClaw plugin integration
└── index.ts             # Public API
```

### Data Directory

```
~/.openclaw/memoryclaw/
├── episodes/            # Compressed interaction summaries
│   └── 2025-04-08_14-32-10_meeting-with-john.md
├── semantic/            # Persistent facts
│   ├── contacts.md
│   ├── projects.md
│   └── _pending.md      # Low-confidence facts awaiting review
├── skills/              # Auto-generated skill templates
├── logs/                # Raw interaction logs
│   └── processed/
├── index/               # SQLite FTS5 search index
└── config.yaml
```

### Episode File Format

Every memory is a plain markdown file with structured YAML frontmatter:

```markdown
---
timestamp: 2025-04-08T14:32:10Z
tags: [email, projectX, deadline, john]
summary: "Discussed project deadline with John. Confirmed April 10th."
participants: [user, assistant]
confidence: high
---
**Details:**
- Recipient: John <john@example.com>
- Subject: Project X deadline confirmation
- Agreed on April 10th hard deadline
```

---

## CLI

```
memoryclaw <command> [args]

Retrieval
  retrieve <query>            Search episodes + semantic facts
  search <query>              Keyword search across memories

Memory Management
  audit [limit]               Show recent episodes and pending facts
  delete <filename>           Delete an episode
  delete-fact <file> <key>    Remove a fact from a semantic file

Consolidation
  consolidate                 Process raw logs into episodes + facts

Skills
  patterns [threshold]        Detect repeated action patterns
  compile [threshold]         Generate draft skills from patterns
  skills                      List all skills (draft + approved)
  approve-skill <file>        Approve a draft skill
  reject-skill <file>         Reject a draft skill

Indexing
  index                       Build/rebuild SQLite FTS5 index
  index-search <query>        Search using the full-text index
```

---

## Configuration

Create `~/.openclaw/memoryclaw/config.yaml`:

```yaml
memoryclaw:
  disableDefaultMemory: true
  path: ~/.openclaw/memoryclaw

  retrieval:
    primary: keyword
    minPrimaryResults: 2      # Fallback triggers below this
    fallback: none            # "none" or "vector"
    maxResults: 5
    blendStrategy: primary_first

  llm:
    provider: ollama          # "ollama" or "openai-compatible"
    baseUrl: http://localhost:11434
    model: llama3:8b
    embeddingModel: nomic-embed
    apiKey: ""                # Only needed for openai-compatible

  consolidation:
    interval: 60              # Minutes between consolidation runs
    skillThreshold: 7         # Min pattern occurrences for skill suggestion
    factValidation: true      # Schema-validate extracted facts
    pendingReview: true       # Low-confidence facts → _pending.md

  semantic:
    files: [contacts.md, projects.md]
```

### LLM Backend

MemoryClaw supports any OpenAI-compatible API. Use Ollama for fully local operation, or point it at any hosted endpoint:

```yaml
# Local (default)
llm:
  provider: ollama
  baseUrl: http://localhost:11434
  model: llama3:8b

# Hosted / OpenAI-compatible
llm:
  provider: openai-compatible
  baseUrl: https://api.openai.com/v1
  model: gpt-4
  apiKey: sk-...
```

---

## Design Principles

1. **Keyword-first retrieval.** Transparent, explainable, zero-cost. Not another RAG wrapper.
2. **80/20 rule.** Keywords handle ~80% of queries. Vector fallback catches the rest.
3. **Files you can read.** Every memory is a markdown file. `grep` your memories. Edit them in vim. Version them with git.
4. **Privacy by default.** Ollama for local LLM. No cloud dependencies. Your memories stay on your machine.
5. **Honest about trade-offs.** Keyword matching struggles with paraphrasing — that's why vector fallback exists. Auto-generated skills require approval — because auto-executing buggy code is worse than no automation.

---

## Error Handling

MemoryClaw is designed to fail gracefully and transparently:

- **Confidence scoring** — Every episode carries a `confidence` field (low/medium/high)
- **Fact staging** — Low-confidence facts go to `_pending.md`, not canonical files
- **Conflict detection** — Contradictory facts are flagged, never silently overwritten
- **Source tracing** — Every fact links back to the originating log file
- **Raw log preservation** — Original logs kept for re-processing if summarization improves

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict mode, ES modules) |
| Storage | Markdown + YAML frontmatter |
| Search Index | SQLite FTS5 (via `bun:sqlite`) |
| LLM | Configurable — Ollama / OpenAI-compatible |
| Frontmatter | [gray-matter](https://github.com/jonschlinkert/gray-matter) |
| Testing | [Vitest](https://vitest.dev) (102 tests, 14 files) |
| Platform | [OpenClaw](https://github.com/openclaw) plugin |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone and install
git clone https://github.com/imjohnzakkam/memoryclaw.git
cd memoryclaw
bun install

# Run tests
bun test

# Run a specific test file
bun test tests/keywords.test.ts
```

---

## Roadmap

- [x] Core retrieval pipeline (keyword + tag scoring)
- [x] Synonym/alias expansion
- [x] Vector fallback (Ollama + OpenAI-compatible)
- [x] Raw interaction logging
- [x] Consolidation daemon (logs → episodes + facts)
- [x] Semantic memory with dedup + conflict detection
- [x] Pattern detection + skill compilation
- [x] Working memory injection (`onBeforeLLM` hook)
- [x] SQLite FTS5 indexing
- [x] OpenClaw plugin integration
- [x] CLI for all operations
- [ ] Web UI for memory browsing
- [ ] Multi-agent memory sharing
- [ ] Cross-device sync
- [ ] Advanced pattern mining (PrefixSpan)

---

## License

[MIT](LICENSE) &copy; [John Zakkam](https://github.com/imjohnzakkam)

---

<p align="center">
  <sub>Built with frustration at black-box AI memory systems.</sub>
</p>
