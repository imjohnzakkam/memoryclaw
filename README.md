# MemoryClaw: A Deterministic Memory Layer for OpenClaw

## Complete Specification — Revised Draft

---

## 1. Executive Summary

MemoryClaw is a **brain-inspired, hierarchical memory system** designed as a plugin layer for the OpenClaw personal AI assistant. It addresses inefficiencies in current agent memory architectures by replacing opaque vector embeddings with **file-based storage and transparent retrieval**. MemoryClaw reduces token consumption, eliminates embedding costs, and makes every memory operation debuggable.

MemoryClaw integrates with OpenClaw as a suite of plugins, leveraging its existing skills, cron, and tooling ecosystems. It is designed for users who value privacy, transparency, and long-term learning in their personal AI.

**Key design goals:**

- All memories stored in human-readable markdown files, editable and version-controllable.
- Primary retrieval via keyword and tag matching on pre-summarized episodes, with a hybrid vector fallback available from day one for cases where keyword matching falls short.
- Only a compact working memory payload is injected into the LLM context, typically 400–800 tokens including system framing.
- A consolidation daemon continuously summarizes raw interactions, extracts facts, and detects reusable action patterns.
- No embedding API calls required for default operation; retrieval is pure file I/O, with local LLMs handling summarization.

---

## 2. The Memory Model: Inspired by Human Cognition

MemoryClaw implements a four-tier memory hierarchy, mirroring theories of human memory. Each tier serves a distinct purpose and has its own storage format, access pattern, and known limitations.

| Tier | Name | Function | Storage | Access |
|------|------|----------|---------|--------|
| 1 | **Working Memory** | Active context for current task | In-memory JSON (agent session) | Direct |
| 2 | **Episodic Memory** | Compressed records of past interactions | Markdown files with YAML frontmatter | Keyword/tag + optional vector |
| 3 | **Semantic Memory** | Persistent facts and relationships | Markdown files (structured lists/tables) | Entity-based lookup |
| 4 | **Procedural Memory** | Reusable skills compiled from experience | OpenClaw skill files (JSON/JavaScript) | Intent matching |

### 2.1 Working Memory

**Purpose:** Holds everything the LLM needs for the current reasoning step. It is the active context window of the agent.

**Structure:** A JSON object with configurable size limits (default ~2k tokens). Example:

```json
{
  "goal": "send email to John about project update",
  "plan": ["get_recipient", "compose", "send"],
  "facts": {
    "recipient_email": "john@example.com",
    "project_deadline": "2025-04-10"
  },
  "recent_observations": ["draft created"],
  "active_skill": "send_email"
}
```

**Lifecycle:** Created at the start of a task, updated after each LLM response or tool result, and cleared upon task completion.

### 2.2 Episodic Memory

**Purpose:** Stores compressed, tagged summaries of past interactions for future reference.

**Storage:** Markdown files in `memoryclaw/episodes/` with naming convention `YYYY-MM-DD_HH-MM-SS_summary.md`. Each file contains YAML frontmatter (timestamp, tags, summary, participants) followed by structured detail.

**File format:**

```markdown
---
timestamp: 2025-04-08T14:32:10Z
tags: [email, projectX, deadline]
summary: "User asked to send project update email to John. Used send_email skill. Email contained deadline info."
participants: [user, assistant]
confidence: high
---
**Details:**
- Recipient: John <john@example.com>
- Subject: Project update
- Body: "Hi John, just a reminder that the deadline is April 10th..."
```

**Retrieval:** Primary retrieval is via keyword search on the `summary` and `tags` fields. An inverted index (SQLite) is recommended for performance once episode count exceeds a few hundred. A hybrid vector fallback is available as a configurable option (see Section 3.3).

### 2.3 Semantic Memory

**Purpose:** Persistent, decontextualized facts such as contacts, preferences, and project metadata.

**Storage:** One or more markdown files in `memoryclaw/semantic/` (e.g., `contacts.md`, `projects.md`, `preferences.md`). Format is simple key-value lists, YAML, or markdown tables.

```markdown
# Contacts
- John: john@example.com
- Sarah: sarah@work.com

# Projects
- projectX:
    deadline: 2025-04-10
    stakeholders: [John, Sarah]
```

**Retrieval:** Direct entity lookup via regex or simple parsing. Results cached in memory after first read.

**Scaling note:** This flat-file approach works well for personal-scale data (tens to low hundreds of entities). For users who accumulate hundreds of entities with complex relationships, the semantic layer will need to migrate toward a lightweight structured store (e.g., SQLite with a markdown export layer). The roadmap accounts for this as a Phase 7 enhancement, but implementers should be aware that flat markdown does not scale indefinitely.

### 2.4 Procedural Memory

**Purpose:** Reusable routines for common tasks, potentially executed without LLM invocation.

**Storage:** OpenClaw skill files in `memoryclaw/skills/`, in either JSON declarative format (for simple sequences) or JavaScript format (for complex logic using OpenClaw's skill API).

**JSON declarative skill example:**

```json
{
  "name": "send_email",
  "triggers": ["send email", "email"],
  "preconditions": {
    "recipient": {"type": "email", "source": "semantic or user"},
    "subject": {"type": "string", "optional": false},
    "body": {"type": "string", "optional": false}
  },
  "steps": [
    {"action": "call_tool", "tool": "email_api", "params": {
      "to": "$recipient",
      "subject": "$subject",
      "body": "$body"
    }}
  ]
}
```

**JavaScript skill example:**

```javascript
export default {
  name: 'send_email',
  triggers: ['send email', 'email'],
  async run(params, context) {
    // implementation
  }
};
```

**Compilation:** Skills can be automatically suggested by the consolidation daemon when repeated action patterns are detected. They can also be written manually. See Section 3.5 for an honest discussion of the challenges involved in automatic skill compilation.

---

## 3. How MemoryClaw Works: End-to-End Flow

### 3.1 User Interaction Cycle

1. **User sends a message** via any OpenClaw-supported channel (WhatsApp, Telegram, CLI, etc.).
2. **OpenClaw routes the message** to the appropriate agent and invokes its configured pipeline.
3. **MemoryClaw retrieval plugin** is triggered before the LLM call. It extracts keywords from the user query and current goal, searches episodic memory for relevant summaries, looks up semantic facts for mentioned entities, and (optionally) falls back to vector search if keyword results are insufficient. The top results are injected into the agent's working memory.
4. **LLM call** occurs with the working memory as context plus the system prompt. Realistic total prompt size is typically 400–800 tokens depending on how many episodes and facts are retrieved.
5. **LLM response** may include tool calls, plan updates, or a final answer.
6. **Post-response hook** logs the raw interaction (full transcript) to `memoryclaw/logs/`.
7. **Consolidation daemon** (running as a cron job) later processes raw logs: summarizes them, writes episode files, updates semantic memory, and detects action patterns.
8. **User receives answer** (or sees a skill executed).

### 3.2 Retrieval Strategy: Strengths and Limitations

The default retrieval mechanism is keyword and tag matching on episode summaries and semantic files. This approach is deterministic, transparent, and fast. When a memory is recalled, the user can see exactly which keywords matched, making the system fully debuggable.

**Where keyword matching excels:**

- Queries that use the same vocabulary as the stored episodes (e.g., "what did I email John about?" when the episode is tagged with "email" and "John").
- Lookups involving proper nouns, project names, dates, and other concrete terms.
- Cases where the user has built up a consistent tagging vocabulary over time.

**Where keyword matching struggles:**

- Semantic paraphrasing: if the user asks about "that budget conversation with marketing" but the episode was tagged with "finance, campaign-team, Q3-review," keyword matching will miss it entirely.
- Vague or abstract queries: "that thing we discussed last week about the restructuring" may not match any stored keywords.
- Cross-domain connections: linking a "flight booking" episode to a "travel reimbursement" query requires understanding that these are related concepts, not just matching words.

Because these failure modes are common in real usage, MemoryClaw includes a hybrid retrieval option from Phase 1. When keyword matching returns fewer than the configured minimum results, the system can fall back to a lightweight vector similarity search using a local embedding model (e.g., via Ollama). This fallback is off by default to preserve the deterministic-first philosophy but can be enabled in configuration. The intent is that keyword matching handles the common case cheaply and transparently, while vector search catches the long tail of semantically related but lexically different queries.

### 3.3 Hybrid Retrieval Configuration

The retrieval pipeline supports a configurable fallback chain:

```yaml
retrieval:
  primary: keyword          # Always runs first
  minPrimaryResults: 2      # Minimum results before fallback triggers
  fallback: vector           # Options: none, vector
  vectorModel: nomic-embed   # Local model via Ollama
  maxResults: 5
  blendStrategy: primary_first  # keyword results ranked above vector
```

When the fallback is set to `none`, the system operates in pure deterministic mode. When set to `vector`, the system runs vector search only when keyword matching produces fewer than `minPrimaryResults`. Results from both sources are blended, with keyword matches ranked first to preserve transparency. This means the system is deterministic by default and only introduces fuzziness when it would otherwise return nothing useful.

### 3.4 Consolidation Daemon Workflow

**Trigger:** Runs on a schedule (e.g., every hour) or after a certain number of new logs accumulate.

**Input:** Raw log files in `memoryclaw/logs/` that have not yet been processed.

For each unprocessed log, the daemon:

1. Reads the full transcript.
2. Calls a local LLM (via Ollama or similar) with a summarization prompt that requests a one-sentence summary, key tags, and any new facts in JSON format.
3. Parses the LLM output and validates it against a schema before writing (emails must look like email addresses, dates must parse correctly, etc.).
4. Writes a new episode file in `memoryclaw/episodes/` with YAML frontmatter including a `confidence` field.
5. Updates semantic memory files by appending new facts (with deduplication checks). Low-confidence facts go to `_pending.md` for user review.
6. Moves or marks the raw log as processed.

**Pattern detection (experimental):** The daemon maintains a frequency table of action sequences (e.g., `[tool_call_A, tool_call_B]`). When a sequence occurs more than a configurable threshold number of times, it generates a skill template and flags it for user review. See Section 3.5 for caveats.

### 3.5 Skill Compilation: Approach and Caveats

Automatic skill compilation is one of the most ambitious features in MemoryClaw. The idea is that when the system detects a user repeatedly performing the same sequence of actions (e.g., look up a contact, draft an email, send it), it can generate a reusable skill template that automates the sequence.

**What makes this hard:**

- Distinguishing genuine patterns from coincidental sequences. Two tool calls happening in the same order three times does not necessarily mean they belong together as a skill.
- Correctly parameterizing the generated skill. A sequence that worked for "email John about project X" needs to be generalized to "email [recipient] about [topic]," and the parameters need to be extracted reliably.
- Ensuring the generated code is correct and safe to execute. A buggy auto-generated skill that sends emails to the wrong person is worse than no skill at all.

**Mitigation strategy:**

- All auto-generated skills require explicit user approval before activation (no auto-approve by default).
- Generated skills are initially created as "draft" templates with clear TODO markers for the user to review.
- The pattern detection threshold is set conservatively high (default: 7 occurrences) to reduce false positives.
- This feature is explicitly marked as experimental in documentation and release notes. The roadmap allocates extended time for iteration (see Section 7).

---

## 4. Failure Modes and Error Handling

Any system that relies on LLM-generated summaries to build a persistent knowledge base must account for the possibility of errors. This section documents known failure modes and the mechanisms MemoryClaw uses to mitigate them.

### 4.1 Bad Summaries from the Consolidation Daemon

**Risk:** The local LLM used for summarization may produce inaccurate summaries, miss important details, hallucinate facts, or generate tags that don't reflect the actual conversation.

**Mitigation:**

- All generated episode files include a `confidence` field in frontmatter (low/medium/high), based on the length and clarity of the source transcript.
- A validation step checks that extracted facts conform to expected schemas before writing to semantic memory.
- The raw log is preserved (not deleted) for a configurable retention period, allowing re-processing if a summarization model is upgraded.
- Users can run a `/memories audit` command that displays recently added facts and episode summaries for manual review.

### 4.2 Hallucinated Facts in Semantic Memory

**Risk:** The daemon may extract a "fact" that was never actually stated, such as inferring a contact's email from context that doesn't support it.

**Mitigation:**

- New facts are written with a `source` field that references the originating log file and timestamp. This makes it possible to trace any fact back to its origin.
- Facts extracted with low confidence are written to a staging file (`memoryclaw/semantic/_pending.md`) rather than directly to the canonical semantic files. They are promoted only after user confirmation or after being corroborated by a second interaction.
- The `/memories delete` command allows targeted removal of individual facts.

### 4.3 Retrieval Misses

**Risk:** The system fails to retrieve a relevant memory, causing the agent to behave as if it has no memory of a past interaction.

**Mitigation:**

- The hybrid retrieval fallback (Section 3.3) catches many cases where keyword matching alone would miss.
- Episode files are re-indexed whenever semantic files are updated, so that new entity aliases (e.g., "marketing" added as an alias for "campaign-team") propagate to retrieval.
- A `/memories search` command allows users to manually search their memories with arbitrary queries, helping diagnose retrieval gaps.

### 4.4 Stale or Contradictory Facts

**Risk:** Semantic memory may contain outdated information (e.g., an old email address) or contradictory entries.

**Mitigation:**

- Facts include a `last_updated` timestamp. When the agent retrieves a fact, it surfaces the age to the LLM so it can decide whether to trust it or ask the user for confirmation.
- The consolidation daemon includes a conflict detection step: if a newly extracted fact contradicts an existing one (same entity, same field, different value), both are flagged for user review rather than silently overwriting.

---

## 5. Integration with OpenClaw

### 5.1 Plugin Architecture

MemoryClaw is distributed as a set of components that integrate with OpenClaw through its natural extension points:

| Component | Integration Method |
|-----------|-------------------|
| **Retrieval** | Custom tool (`memoryclaw_retrieve`) called before each response, or a contributed `onBeforeLLM` hook (preferred long-term). |
| **Logging** | Post-response hook implemented as a chained tool after LLM call. |
| **Consolidation** | OpenClaw cron job (configured in agent YAML). |
| **Skill Compilation** | Standalone script writing draft skills to `memoryclaw/skills/` for user review. |
| **Configuration** | Agent `config.yaml` extended with a `memoryclaw` section. |

### 5.2 Directory Structure

```
~/.openclaw/workspace/
├── agents/
│   └── my-agent/
│       ├── config.yaml
│       └── skills/
├── memoryclaw/
│   ├── episodes/
│   │   ├── 2025-04-08_summary.md
│   │   └── ...
│   ├── semantic/
│   │   ├── contacts.md
│   │   ├── projects.md
│   │   ├── preferences.md
│   │   └── _pending.md
│   ├── skills/
│   ├── logs/
│   │   ├── 2025-04-08_raw.md
│   │   └── processed/
│   ├── index/
│   ├── daemon/
│   │   ├── consolidate.js
│   │   └── detect_patterns.js
│   └── config.yaml
└── ...
```

### 5.3 Agent Configuration Example

```yaml
name: my-agent
model: gpt-4
memoryclaw:
  enabled: true
  path: ~/.openclaw/workspace/memoryclaw
  retrieval:
    primary: keyword
    minPrimaryResults: 2
    fallback: vector
    vectorModel: nomic-embed
    maxResults: 5
    useIndex: true
  consolidation:
    interval: 60  # minutes
    model: llama3:8b
    skillThreshold: 7
    factValidation: true
    pendingReview: true
  semantic:
    files: [contacts.md, projects.md, preferences.md]

cron:
  - schedule: "0 * * * *"
    command: "node ~/.openclaw/workspace/memoryclaw/daemon/consolidate.js --agent my-agent"

system_prompt: |
  You are a helpful assistant. Before you answer, you MUST call the tool
  `memoryclaw_retrieve` with the user's query to get relevant past memories.
  Then use that information to formulate your response.
```

### 5.4 The Retrieval Tool

Place in `agents/my-agent/skills/memoryclaw_retrieve.js`:

```javascript
import fs from 'fs/promises';
import path from 'path';
import { extractKeywords, searchEpisodes, lookupSemantic, vectorSearch } from '../lib/memoryclaw.js';

export default {
  name: 'memoryclaw_retrieve',
  description: 'Retrieve relevant past episodes and facts based on a query.',
  async run({ query, maxResults = 5 }, context) {
    const config = context.config.memoryclaw;
    const memoryclawPath = config.path;

    // Primary: keyword search
    const keywords = extractKeywords(query);
    let episodes = await searchEpisodes(memoryclawPath, keywords, maxResults);

    // Fallback: vector search if keyword results are insufficient
    if (episodes.length < config.retrieval.minPrimaryResults && config.retrieval.fallback === 'vector') {
      const vectorResults = await vectorSearch(memoryclawPath, query, maxResults);
      // Blend: keyword results first, then vector results (deduplicated)
      const seen = new Set(episodes.map(e => e.file));
      for (const vr of vectorResults) {
        if (!seen.has(vr.file)) episodes.push(vr);
      }
      episodes = episodes.slice(0, maxResults);
    }

    const facts = await lookupSemantic(memoryclawPath, query);

    return {
      episodes: episodes.map(e => e.summary),
      facts
    };
  }
};
```

### 5.5 Post-Response Logging Tool

Another skill (`memoryclaw_log`) can be called after the main response to save the raw interaction. The agent's flow would be: `memoryclaw_retrieve` → LLM → `memoryclaw_log`.

---

## 6. Key Benefits and Honest Trade-offs

### 6.1 Transparent, Debuggable Memory

Unlike vector embeddings, which are opaque, MemoryClaw's keyword and tag matching is fully explainable. Users can see exactly why a memory was recalled by examining the matching keywords. All memory files are plain markdown — editable, version-controllable, and portable. This is a genuine differentiator for users who want to understand and control what their agent remembers.

### 6.2 Meaningful Token Reduction

MemoryClaw significantly reduces the context window payload compared to approaches that inject full conversation histories. A realistic estimate for the working memory injection (including system framing, retrieved episodes, and facts) is **400–800 tokens**, compared to the thousands of tokens required when raw conversation history is passed directly.

It is important to note that this comparison is against naive history injection, not against well-designed RAG systems that also use summarization. The token savings are real but should not be overstated — MemoryClaw's advantage is primarily in transparency and debuggability rather than raw token count.

### 6.3 Reduced Embedding Costs

In default (keyword-only) mode, no embedding API calls are required. Retrieval is pure file I/O, and summarization uses local LLMs. When the optional vector fallback is enabled, embedding calls are limited to query-time only (episode embeddings can be pre-computed and cached locally during consolidation). This keeps costs significantly lower than systems that require embedding every message in real time.

### 6.4 Continuous Learning

The consolidation daemon runs in the background, turning raw logs into compressed, useful memories. Over time, the agent builds a growing knowledge base and (with the experimental skill compilation feature) can learn reusable routines. The rate of improvement depends on summarization quality and the user's engagement with the review mechanisms described in Section 4.

### 6.5 Privacy-First

All data stays on the user's machine by default. No cloud dependencies unless the user chooses to use remote LLMs. Raw logs are processed locally and can be deleted after summarization.

### 6.6 OpenClaw Integration

MemoryClaw leverages OpenClaw's existing skill ecosystem and works with all supported channels (WhatsApp, Telegram, Discord, etc.) out of the box.

---

## 7. Implementation Roadmap

Timeline estimates assume a single developer working part-time. Adjust proportionally for team size.

### Phase 0: Foundation (Week 1)

- Set up OpenClaw development environment and create GitHub repository.
- Write initial documentation: vision, architecture, getting started.

### Phase 1: Core Retrieval with Hybrid Fallback (Weeks 2–4)

- Implement keyword extraction and episode search.
- Build the `memoryclaw_retrieve` tool.
- Integrate optional vector fallback using a local embedding model.
- Test retrieval quality across a range of query types (exact match, paraphrase, vague).

### Phase 2: Logging and Raw Storage (Week 5)

- Implement `memoryclaw_log` tool.
- Ensure raw logs are written with proper format, permissions, and rotation.

### Phase 3: Consolidation Daemon (Weeks 6–8)

- Build Node.js script for summarization using local LLM (Ollama).
- Implement fact extraction with schema validation.
- Add the pending facts staging mechanism.
- Integrate with OpenClaw cron and test summarization quality on sample conversations.

### Phase 4: Semantic Memory Updates (Weeks 9–10)

- Implement safe updates to semantic markdown files (append, merge, deduplication).
- Add conflict detection for contradictory facts.
- Build the `/memories audit`, `/memories search`, and `/memories delete` commands.

### Phase 5: Skill Compilation — Experimental (Weeks 11–15)

- Implement pattern detection from logs with conservative thresholds.
- Generate draft skill templates with TODO markers.
- Build user approval workflow.
- Extensive testing with real-world usage patterns. This phase is intentionally longer because the problem is genuinely hard and requires iteration.

### Phase 6: Working Memory Injection (Weeks 16–17)

- Contribute `onBeforeLLM` hook to OpenClaw core (or implement as a wrapper).
- Refactor retrieval to be automatic rather than tool-based.

### Phase 7: Optimization and Scaling (Ongoing)

- Add inverted index for fast episode search at scale.
- Explore migration path from flat markdown to SQLite for semantic memory when entity count grows large.
- Improve summarization prompts based on real-world error analysis.
- Build optional web UI for memory browsing and editing.
- Publish on ClawHub.

---

## 8. Security and Privacy Considerations

- **File permissions:** All memory files should be readable/writable only by the user (`0600` for files, `0700` for directories).
- **Sensitive data redaction:** Summarization prompts instruct the LLM to omit passwords, API keys, tokens, and personal identification numbers. A post-processing regex scanner catches common secret patterns that the LLM may have missed.
- **User control:** Commands (`/forget`, `/memories list`, `/memories search`, `/memories delete`, `/memories audit`) allow users to manage their memory directly.
- **Local LLM security:** Ollama should be configured to listen only on localhost.
- **Encryption at rest:** For sensitive environments, users can encrypt their workspace directory using standard tools (VeraCrypt, encrypted home folder, etc.).

---

## 9. Adoption Strategy

MemoryClaw will be distributed as a ClawHub package with standard metadata. Documentation includes a 5-minute quick start guide, a detailed user guide covering each memory layer and configuration option, and a developer guide for extending the system or writing custom skills that leverage memory.

Community engagement will focus on the OpenClaw Discord, demo screencasts showing real retrieval and consolidation in action, and upstream contributions to the OpenClaw core (particularly the `onBeforeLLM` hook). Target use cases for early showcases include personal assistant memory (preferences, contacts, conversation history), project management (deadlines, stakeholders, action items), and expense tracking (automatic extraction from emails).

---

## 10. Future Enhancements

- **Multi-agent memory sharing:** Allow multiple agents to share semantic memory via symlinks or a common store.
- **Memory visualization:** Integrate with OpenClaw's Canvas to display memory graphs or episode timelines.
- **Cross-device sync:** Use file syncing tools (Dropbox, Syncthing) to keep memory consistent across devices.
- **Memory export/import:** Allow users to export their entire memory as a zip and import on another instance.
- **Advanced pattern mining:** Use sequence mining algorithms (e.g., PrefixSpan) for longer-range pattern detection in skill compilation.
- **Structured semantic store:** Migrate from flat markdown to a lightweight database (SQLite with markdown export) for users with large entity counts.

---

## 11. Conclusion

MemoryClaw reimagines how AI agents remember. By drawing inspiration from human memory and implementing a file-based system with transparent retrieval, it offers a debuggable, cost-effective, and continuously learning memory layer for OpenClaw.

This revised specification is honest about what works well (transparency, debuggability, privacy, reduced costs) and what requires careful engineering (retrieval quality for paraphrased queries, summarization accuracy, automatic skill compilation). By including hybrid retrieval from day one, building in fact validation and staging mechanisms, and setting realistic timelines for the harder features, MemoryClaw is positioned to deliver on its core promise without overselling its capabilities.

The system embodies OpenClaw's spirit: local, fast, and always-on. With a clear integration path, honest trade-off analysis, and strong error handling foundations, MemoryClaw aims to become a reliable and trusted memory solution for the OpenClaw ecosystem.