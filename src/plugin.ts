/**
 * OpenClaw Plugin Entry Point for MemoryClaw
 *
 * Wires MemoryClaw's memory system into OpenClaw's lifecycle via the Plugin API.
 * Registers hooks, tools, commands, services, and CLI subcommands.
 */

import { join, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { loadConfig } from "./config.ts";
import { retrieve } from "./retrieve.ts";
import { logInteraction } from "./logger.ts";
import { consolidate } from "./consolidate.ts";
import {
  auditMemories,
  searchMemories,
  deleteMemory,
  deleteFact,
} from "./memories.ts";
import { detectPatterns } from "./patterns.ts";
import {
  compileSkill,
  writeSkillDraft,
  listSkills,
  approveSkill,
  rejectSkill,
} from "./skill-compiler.ts";
import {
  createWorkingMemory,
  hydrateWorkingMemory,
  onBeforeLLM,
} from "./working-memory.ts";
import type { MemoryClawConfig, WorkingMemory, LogMessage } from "./types.ts";

// ---------- Types for OpenClaw Plugin API ----------

/**
 * Minimal type definitions for the OpenClaw Plugin API.
 * These are intentionally loose to avoid tight coupling with OpenClaw's internals.
 */
export interface OpenClawPluginApi {
  registerHook(
    event: string,
    handler: (...args: unknown[]) => Promise<unknown> | unknown,
    meta?: { name: string; description: string },
  ): void;

  registerCommand(opts: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: CommandContext) => Promise<{ text: string }> | { text: string };
  }): void;

  registerService(opts: {
    id: string;
    start: () => void | Promise<void>;
    stop: () => void | Promise<void>;
  }): void;

  registerCli?(
    factory: (opts: { program: unknown }) => void,
    meta?: { commands: string[] },
  ): void;

  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  config?: Record<string, unknown>;
}

export interface CommandContext {
  senderId?: string;
  channel?: string;
  isAuthorizedSender?: boolean;
  args?: string;
  commandBody?: string;
  config?: Record<string, unknown>;
}

// ---------- Plugin State ----------

let memoryclawConfig: MemoryClawConfig;
let memoryclawDir: string;
let workingMemory: WorkingMemory = createWorkingMemory("");
let consolidationTimer: ReturnType<typeof setInterval> | null = null;

// ---------- Helpers ----------

function resolveConfig(apiConfig?: Record<string, unknown>): MemoryClawConfig {
  // Try OpenClaw config first, then fall back to file
  const mcConfig = apiConfig?.memoryclaw as Record<string, unknown> | undefined;

  if (mcConfig?.configPath) {
    return loadConfig(String(mcConfig.configPath));
  }

  // Look for config in standard locations
  const candidates = [
    "./memoryclaw/config.yaml",
    join(process.env.HOME ?? "~", ".openclaw", "workspace", "memoryclaw", "config.yaml"),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      return loadConfig(resolved);
    }
  }

  // Fall back to defaults by loading from a non-existent path (will throw)
  // Instead, build a default config
  return {
    path: resolve(
      String(mcConfig?.path ?? "./memoryclaw"),
    ),
    retrieval: {
      primary: "keyword",
      minPrimaryResults: Number(mcConfig?.minPrimaryResults ?? 2),
      fallback: (mcConfig?.fallback as "none" | "vector") ?? "none",
      maxResults: Number(mcConfig?.maxResults ?? 5),
      blendStrategy: "primary_first",
    },
    llm: {
      provider: (mcConfig?.llmProvider as "ollama" | "openai-compatible") ?? "ollama",
      baseUrl: String(mcConfig?.llmBaseUrl ?? "http://localhost:11434"),
      model: String(mcConfig?.llmModel ?? "llama3:8b"),
      embeddingModel: String(mcConfig?.embeddingModel ?? "nomic-embed"),
      apiKey: String(mcConfig?.llmApiKey ?? ""),
    },
    consolidation: {
      interval: Number(mcConfig?.consolidationInterval ?? 60),
      skillThreshold: Number(mcConfig?.skillThreshold ?? 7),
      factValidation: mcConfig?.factValidation !== false,
      pendingReview: mcConfig?.pendingReview !== false,
    },
    semantic: {
      files: (mcConfig?.semanticFiles as string[]) ?? ["contacts.md", "projects.md"],
    },
  };
}

function ensureDirectories(baseDir: string): void {
  const dirs = ["episodes", "semantic", "skills", "logs", "index"];
  for (const dir of dirs) {
    const dirPath = join(baseDir, dir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
  }
}

// ---------- Main Plugin Registration ----------

export default function register(api: OpenClawPluginApi): void {
  // Resolve config
  memoryclawConfig = resolveConfig(api.config);
  memoryclawDir = resolve(memoryclawConfig.path);

  // Ensure directory structure exists
  ensureDirectories(memoryclawDir);

  api.logger.info(`[memoryclaw] Initialized — data dir: ${memoryclawDir}`);

  // ---- Hook: Before LLM (inject memory context) ----
  api.registerHook(
    "agent:beforeLLM",
    async (params: unknown) => {
      const p = params as { systemPrompt?: string; messages?: Array<{ role: string; content: string }> };
      const userMessages = (p.messages ?? []).filter((m) => m.role === "user");
      const latestQuery = userMessages[userMessages.length - 1]?.content ?? "";

      if (!latestQuery) return params;

      try {
        workingMemory = await hydrateWorkingMemory(
          workingMemory,
          latestQuery,
          memoryclawConfig,
        );

        const enrichedPrompt = onBeforeLLM(
          workingMemory,
          p.systemPrompt ?? "",
        );

        return { ...p, systemPrompt: enrichedPrompt };
      } catch (err) {
        api.logger.warn(`[memoryclaw] Retrieval failed: ${err}`);
        return params;
      }
    },
    {
      name: "memoryclaw.before-llm",
      description: "Injects relevant memories into the LLM context before each call",
    },
  );

  // ---- Hook: After Response (log interaction) ----
  api.registerHook(
    "agent:afterResponse",
    async (params: unknown) => {
      const p = params as {
        messages?: Array<{ role: string; content: string; timestamp?: string }>;
        channel?: string;
      };

      if (!p.messages || p.messages.length === 0) return;

      try {
        const logMessages: LogMessage[] = p.messages.map((m) => ({
          role: m.role as LogMessage["role"],
          content: m.content,
          timestamp: m.timestamp ?? new Date().toISOString(),
        }));

        logInteraction(
          join(memoryclawDir, "logs"),
          p.channel ?? "unknown",
          logMessages,
        );
      } catch (err) {
        api.logger.warn(`[memoryclaw] Logging failed: ${err}`);
      }
    },
    {
      name: "memoryclaw.after-response",
      description: "Logs each conversation turn for later consolidation",
    },
  );

  // ---- Background Service: Consolidation Daemon ----
  api.registerService({
    id: "memoryclaw-consolidation",
    start: () => {
      const intervalMs = memoryclawConfig.consolidation.interval * 60 * 1000;
      api.logger.info(
        `[memoryclaw] Consolidation daemon started (every ${memoryclawConfig.consolidation.interval}m)`,
      );

      const runConsolidation = async () => {
        try {
          const report = await consolidate({
            logsDir: join(memoryclawDir, "logs"),
            episodesDir: join(memoryclawDir, "episodes"),
            semanticDir: join(memoryclawDir, "semantic"),
            llmConfig: memoryclawConfig.llm,
            consolidationConfig: memoryclawConfig.consolidation,
            semanticFiles: memoryclawConfig.semantic.files,
          });

          if (report.processed > 0) {
            api.logger.info(
              `[memoryclaw] Consolidated ${report.processed} logs → ${report.episodes.length} episodes`,
            );
          }
          if (report.conflicts.length > 0) {
            api.logger.warn(
              `[memoryclaw] ${report.conflicts.length} fact conflict(s) detected — check _pending.md`,
            );
          }
        } catch (err) {
          api.logger.error(`[memoryclaw] Consolidation error: ${err}`);
        }
      };

      // Run immediately on start, then on interval
      runConsolidation();
      consolidationTimer = setInterval(runConsolidation, intervalMs);
    },
    stop: () => {
      if (consolidationTimer) {
        clearInterval(consolidationTimer);
        consolidationTimer = null;
      }
      api.logger.info("[memoryclaw] Consolidation daemon stopped");
    },
  });

  // ---- Slash Command: /mclaw ----
  api.registerCommand({
    name: "mclaw",
    description: "Search, audit, or manage MemoryClaw episodic memories",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim().split(/\s+/);
      const subcommand = args[0] ?? "audit";

      switch (subcommand) {
        case "search": {
          const query = args.slice(1).join(" ");
          if (!query) return { text: "Usage: /memories search <query>" };
          const results = searchMemories(memoryclawDir, query);
          if (results.length === 0) return { text: "No memories found." };
          const lines = results.map(
            (ep) => `• [${ep.confidence}] ${ep.summary}\n  tags: ${ep.tags.join(", ")}`,
          );
          return { text: `**Memories matching "${query}":**\n\n${lines.join("\n\n")}` };
        }

        case "audit": {
          const limit = parseInt(args[1] ?? "10");
          const entries = auditMemories(memoryclawDir, limit);
          if (entries.length === 0) return { text: "No memories yet." };
          const lines = entries.map((e) => {
            const icon = e.type === "episode" ? "📝" : "📌";
            return `${icon} [${e.confidence}] ${e.content}`;
          });
          return { text: `**Recent memories:**\n\n${lines.join("\n")}` };
        }

        case "delete": {
          const target = args[1];
          if (!target) return { text: "Usage: /memories delete <filename>" };
          const ok = deleteMemory(memoryclawDir, target);
          return { text: ok ? `Deleted: ${target}` : `Not found: ${target}` };
        }

        case "delete-fact": {
          const file = args[1];
          const key = args[2];
          if (!file || !key) return { text: "Usage: /memories delete-fact <file> <key>" };
          const ok = deleteFact(memoryclawDir, file, key);
          return { text: ok ? `Deleted fact: ${key} from ${file}` : `Not found: ${key} in ${file}` };
        }

        case "skills": {
          const skills = listSkills(join(memoryclawDir, "skills"));
          if (skills.length === 0) return { text: "No skills found." };
          const lines = skills.map((s) => {
            const icon = s.status === "approved" ? "✅" : s.status === "draft" ? "📝" : "❌";
            return `${icon} ${s.name} (${s.status})`;
          });
          return { text: `**Skills:**\n\n${lines.join("\n")}` };
        }

        case "patterns": {
          const threshold = parseInt(args[1] ?? String(memoryclawConfig.consolidation.skillThreshold));
          const patterns = detectPatterns(join(memoryclawDir, "episodes"), threshold);
          if (patterns.length === 0) return { text: `No patterns found (threshold: ${threshold}).` };
          const lines = patterns.map((p) => `• [${p.count}×] ${p.actions.join(" → ")}`);
          return { text: `**Patterns (threshold: ${threshold}):**\n\n${lines.join("\n")}` };
        }

        default:
          return {
            text: `**MemoryClaw Commands:**
• /mclaw audit [limit] — Show recent memories
• /mclaw search <query> — Search memories
• /mclaw delete <filename> — Delete an episode
• /mclaw delete-fact <file> <key> — Delete a fact
• /mclaw skills — List compiled skills
• /mclaw patterns [threshold] — Detect action patterns
• /mclaw-forget <filename> — Quick-delete an episode
• /mclaw-consolidate — Manually trigger log consolidation`,
          };
      }
    },
  });

  // ---- Slash Command: /mclaw-forget ----
  api.registerCommand({
    name: "mclaw-forget",
    description: "Delete a specific MemoryClaw episode by filename",
    acceptsArgs: true,
    handler: (ctx) => {
      const filename = (ctx.args ?? "").trim();
      if (!filename) return { text: "Usage: /mclaw-forget <episode-filename>" };
      const ok = deleteMemory(memoryclawDir, filename);
      return { text: ok ? `🗑️ Forgotten: ${filename}` : `Not found: ${filename}` };
    },
  });

  // ---- Slash Command: /mclaw-consolidate ----
  api.registerCommand({
    name: "mclaw-consolidate",
    description: "Manually trigger MemoryClaw log consolidation",
    handler: async () => {
      try {
        const report = await consolidate({
          logsDir: join(memoryclawDir, "logs"),
          episodesDir: join(memoryclawDir, "episodes"),
          semanticDir: join(memoryclawDir, "semantic"),
          llmConfig: memoryclawConfig.llm,
          consolidationConfig: memoryclawConfig.consolidation,
          semanticFiles: memoryclawConfig.semantic.files,
        });

        const lines = [
          `Processed: ${report.processed}`,
          `Skipped: ${report.skipped}`,
          `Failed: ${report.failed}`,
          `Episodes created: ${report.episodes.length}`,
        ];

        if (report.conflicts.length > 0) {
          lines.push(
            `\n⚠️ Conflicts:`,
            ...report.conflicts.map(
              (c) => `  ${c.entity} ${c.field}: "${c.existingValue}" vs "${c.newValue}"`,
            ),
          );
        }

        return { text: `**Consolidation complete:**\n\n${lines.join("\n")}` };
      } catch (err) {
        return { text: `Consolidation failed: ${err}` };
      }
    },
  });

  api.logger.info("[memoryclaw] Plugin registered successfully");
}

// Named export for flexible imports
export { register };
