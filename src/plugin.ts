/**
 * OpenClaw Plugin Entry Point for MemoryClaw
 *
 * Wires MemoryClaw's memory system into OpenClaw's lifecycle via the Plugin API.
 * Registers hooks, tools, commands, services, and CLI subcommands.
 */

import { join, resolve } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
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
import type { MemoryClawConfig, WorkingMemory, LogMessage, LlmConfig } from "./types.ts";

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

  on?(
    hookName: string,
    handler: (...args: unknown[]) => Promise<unknown> | unknown,
    opts?: { priority?: number },
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
let llmFallbackConfig: LlmConfig | undefined;

// ---------- Helpers ----------

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function resolveConfig(apiConfig?: Record<string, unknown>): MemoryClawConfig {
  // Try OpenClaw config first, then fall back to file
  const mcConfig = apiConfig?.memoryclaw as Record<string, unknown> | undefined;

  if (mcConfig?.configPath) {
    return loadConfig(String(mcConfig.configPath));
  }

  // Look for config in standard locations (use absolute paths to avoid CWD issues)
  const homeDir = process.env.HOME ?? "/tmp";
  const candidates = [
    join(homeDir, ".openclaw", "memoryclaw", "config.yaml"),
    join(homeDir, ".openclaw", "workspace", "memoryclaw", "config.yaml"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return loadConfig(candidate);
    }
  }

  // Default path: always use absolute path under ~/.openclaw/memoryclaw
  const defaultPath = String(mcConfig?.path ?? join(homeDir, ".openclaw", "memoryclaw"));
  // If user specified a relative path, resolve it relative to HOME, not CWD
  const resolvedPath = defaultPath.startsWith("/")
    ? defaultPath
    : join(homeDir, ".openclaw", defaultPath);

  return {
    path: resolvedPath,
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

function resolveTemplate(value: string, envConfig?: Record<string, unknown>): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    const envVal = process.env[key];
    if (envVal) return envVal;
    const cfgVal = envConfig?.[key];
    return typeof cfgVal === "string" ? cfgVal : "";
  });
}

function resolveOpenClawLlmFallback(apiConfig?: Record<string, unknown>): LlmConfig | undefined {
  const models = asObject(apiConfig?.models);
  const providers = asObject(models?.providers);
  if (!providers) return undefined;

  const envConfig = asObject(apiConfig?.env);
  const defaults = asObject(apiConfig?.agents);
  const defaultsAgent = asObject(defaults?.defaults);
  const modelCfg = asObject(defaultsAgent?.model);
  const primary = typeof modelCfg?.primary === "string" ? modelCfg.primary : "";
  const [primaryProvider, ...primaryModelParts] = primary.split("/");
  const primaryModel = primaryModelParts.join("/");

  const providerEntries = Object.entries(providers)
    .map(([name, raw]) => ({ name, cfg: asObject(raw) }))
    .filter((entry): entry is { name: string; cfg: Record<string, unknown> } => Boolean(entry.cfg))
    .filter((entry) => String(entry.cfg.api ?? "") === "openai-completions");

  if (providerEntries.length === 0) return undefined;

  const preferred = providerEntries.find((p) => p.name === primaryProvider) ?? providerEntries[0]!;
  const baseUrl = String(preferred.cfg.baseUrl ?? "").trim();
  if (!baseUrl) return undefined;

  const modelsList = Array.isArray(preferred.cfg.models) ? preferred.cfg.models : [];
  let modelId = preferred.name === primaryProvider ? primaryModel : "";
  if (!modelId) {
    const first = modelsList[0];
    if (first && typeof first === "object") {
      modelId = String((first as Record<string, unknown>).id ?? "");
    }
  }
  if (!modelId) return undefined;

  const rawApiKey = String(preferred.cfg.apiKey ?? "");
  const apiKey = resolveTemplate(rawApiKey, envConfig);

  return {
    provider: "openai-compatible",
    baseUrl,
    model: modelId,
    embeddingModel: "nomic-embed",
    apiKey,
  };
}

function disableDefaultMemoryIfRequested(api: OpenClawPluginApi): void {
  const root = asObject(api.config);
  const mcConfig = asObject(root?.memoryclaw);
  if (mcConfig?.disableDefaultMemory !== true) return;

  // Best-effort config takeover for common OpenClaw config shapes.
  const memoryConfig = asObject(root?.memory);
  if (memoryConfig) {
    memoryConfig.enabled = false;
    api.logger.info("[memoryclaw] Disabled OpenClaw default memory (memory.enabled=false)");
    return;
  }

  const agentConfig = asObject(root?.agent);
  const agentMemory = asObject(agentConfig?.memory);
  if (agentMemory) {
    agentMemory.enabled = false;
    api.logger.info("[memoryclaw] Disabled OpenClaw default memory (agent.memory.enabled=false)");
    return;
  }

  api.logger.warn(
    "[memoryclaw] disableDefaultMemory=true but no known OpenClaw memory config was found. Set memory.enabled=false in your OpenClaw config.",
  );
}

function ensureDirectories(baseDir: string): void {
  const dirs = ["episodes", "semantic", "skills", "logs", "index"];
  for (const dir of dirs) {
    const dirPath = join(baseDir, dir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
  }

  const semanticDefaults: Array<{ file: string; content: string }> = [
    { file: "contacts.md", content: "# Contacts\n" },
    { file: "projects.md", content: "# Projects\n" },
    { file: "aliases.yaml", content: "{}\n" },
  ];
  for (const entry of semanticDefaults) {
    const path = join(baseDir, "semantic", entry.file);
    if (!existsSync(path)) {
      writeFileSync(path, entry.content, { mode: 0o600 });
    }
  }
}

function extractLatestUserMessage(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const normalized = messages
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : null))
    .filter((m): m is Record<string, unknown> => m !== null)
    .filter((m) => String(m.role ?? "").toLowerCase() === "user")
    .map((m) => String(m.content ?? "").trim())
    .filter((text) => text.length > 0);
  return normalized[normalized.length - 1] ?? "";
}

function extractContentText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    const parts = value.map(extractContentText).filter((s) => s.length > 0);
    return parts.join("\n").trim();
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if (obj.content !== undefined) {
      const nested = extractContentText(obj.content);
      if (nested) return nested;
    }
    if (Array.isArray(obj.parts)) {
      const fromParts = extractContentText(obj.parts);
      if (fromParts) return fromParts;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return "";
    }
  }

  return "";
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function normalizeLogMessages(messages: unknown[] | undefined): LogMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out: LogMessage[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as Record<string, unknown>;
    const role = String(msg.role ?? "").toLowerCase();
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") continue;
    const content = extractContentText(msg.content);
    if (!content) continue;
    out.push({
      role: role as LogMessage["role"],
      content,
      timestamp: normalizeTimestamp(msg.timestamp),
    });
  }
  return out;
}

function registerMemoryHooks(api: OpenClawPluginApi): void {
  // Preferred modern API in OpenClaw: lifecycle hooks via api.on(...)
  if (typeof api.on === "function") {
    api.on("before_agent_start", async (event: unknown) => {
      const e = (event ?? {}) as Record<string, unknown>;
      const latestQuery = extractLatestUserMessage(e.messages as unknown[] | undefined);
      if (!latestQuery) return;

      try {
        workingMemory = await hydrateWorkingMemory(
          workingMemory,
          latestQuery,
          memoryclawConfig,
        );

        const basePrompt = String(e.systemPrompt ?? e.prompt ?? "");
        const enrichedPrompt = onBeforeLLM(workingMemory, basePrompt);
        return { systemPrompt: enrichedPrompt };
      } catch (err) {
        api.logger.warn(`[memoryclaw] Retrieval failed: ${err}`);
      }
    });

    api.on("agent_end", async (event: unknown, ctx: unknown) => {
      const e = (event ?? {}) as Record<string, unknown>;
      const c = (ctx ?? {}) as Record<string, unknown>;
      const logMessages = normalizeLogMessages(e.messages as unknown[] | undefined);
      if (logMessages.length === 0) return;

      try {
        logInteraction(
          join(memoryclawDir, "logs"),
          String(c.messageProvider ?? "unknown"),
          logMessages,
        );
      } catch (err) {
        api.logger.warn(`[memoryclaw] Logging failed: ${err}`);
      }
    });

    return;
  }

  // Backward compatibility for older hook runtimes.
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

  api.registerHook(
    "agent:afterResponse",
    async (params: unknown) => {
      const p = params as {
        messages?: Array<{ role: string; content: string; timestamp?: string }>;
        channel?: string;
      };

      if (!p.messages || p.messages.length === 0) return;

      try {
        const logMessages = normalizeLogMessages(p.messages as unknown[]);
        if (logMessages.length === 0) return;

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
}

// ---------- Main Plugin Registration ----------

export default function register(api: OpenClawPluginApi): void {
  disableDefaultMemoryIfRequested(api);

  // Resolve config
  memoryclawConfig = resolveConfig(api.config);
  memoryclawDir = resolve(memoryclawConfig.path);
  llmFallbackConfig = resolveOpenClawLlmFallback(api.config);

  // Ensure directory structure exists
  ensureDirectories(memoryclawDir);

  api.logger.info(`[memoryclaw] Initialized — data dir: ${memoryclawDir}`);
  if (llmFallbackConfig) {
    api.logger.info(
      `[memoryclaw] LLM fallback enabled via OpenClaw provider/model: ${llmFallbackConfig.model}`,
    );
  }

  // ---- Hook registration (OpenClaw lifecycle API + legacy fallback) ----
  registerMemoryHooks(api);

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
            llmFallbackConfig,
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

        case "consolidate": {
          try {
            const report = await consolidate({
              logsDir: join(memoryclawDir, "logs"),
              episodesDir: join(memoryclawDir, "episodes"),
              semanticDir: join(memoryclawDir, "semantic"),
              llmConfig: memoryclawConfig.llm,
              llmFallbackConfig,
              consolidationConfig: memoryclawConfig.consolidation,
              semanticFiles: memoryclawConfig.semantic.files,
            });
            return {
              text: `**Consolidation complete:**\n\nProcessed: ${report.processed}\nSkipped: ${report.skipped}\nFailed: ${report.failed}\nEpisodes created: ${report.episodes.length}`,
            };
          } catch (err) {
            return { text: `Consolidation failed: ${err}` };
          }
        }

        default:
          return {
            text: `**MemoryClaw Commands:**
• /mclaw audit [limit] — Show recent memories
• /mclaw search <query> — Search memories
• /mclaw consolidate — Run consolidation now
• /mclaw delete <filename> — Delete an episode
• /mclaw delete-fact <file> <key> — Delete a fact
• /mclaw skills — List compiled skills
• /mclaw patterns [threshold] — Detect action patterns
• /mclaw_forget <filename> — Quick-delete an episode
• /mclaw_consolidate — Manually trigger log consolidation`,
          };
      }
    },
  });

  // ---- Slash Command: /mclaw_forget ----
  api.registerCommand({
    name: "mclaw_forget",
    description: "Delete a specific MemoryClaw episode by filename",
    acceptsArgs: true,
    handler: (ctx) => {
      const filename = (ctx.args ?? "").trim();
      if (!filename) return { text: "Usage: /mclaw-forget <episode-filename>" };
      const ok = deleteMemory(memoryclawDir, filename);
      return { text: ok ? `🗑️ Forgotten: ${filename}` : `Not found: ${filename}` };
    },
  });

  // ---- Slash Command: /mclaw_consolidate ----
  api.registerCommand({
    name: "mclaw_consolidate",
    description: "Manually trigger MemoryClaw log consolidation",
    handler: async () => {
      try {
        const report = await consolidate({
          logsDir: join(memoryclawDir, "logs"),
          episodesDir: join(memoryclawDir, "episodes"),
          semanticDir: join(memoryclawDir, "semantic"),
          llmConfig: memoryclawConfig.llm,
          llmFallbackConfig,
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
