import { readFileSync } from "fs";
import { join, resolve } from "path";
import { parse } from "yaml";
import type { MemoryClawConfig } from "./types.ts";

const HOME = process.env.HOME ?? "/tmp";

const DEFAULTS: MemoryClawConfig = {
  path: join(HOME, ".openclaw", "memoryclaw"),
  retrieval: {
    primary: "keyword",
    minPrimaryResults: 2,
    fallback: "none",
    maxResults: 5,
    blendStrategy: "primary_first",
  },
  llm: {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "llama3:8b",
    embeddingModel: "nomic-embed",
    apiKey: "",
  },
  consolidation: {
    interval: 60,
    skillThreshold: 7,
    factValidation: true,
    pendingReview: true,
  },
  semantic: {
    files: ["contacts.md", "projects.md"],
  },
};

export function loadConfig(configPath: string): MemoryClawConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw);
  const mc = parsed?.memoryclaw ?? parsed;

  // Always resolve path to absolute — relative paths are resolved against ~/.openclaw/
  const rawPath = mc?.path ?? DEFAULTS.path;
  const resolvedPath = rawPath.startsWith("/")
    ? rawPath
    : resolve(join(HOME, ".openclaw"), rawPath);

  return {
    path: resolvedPath,
    retrieval: { ...DEFAULTS.retrieval, ...mc?.retrieval },
    llm: { ...DEFAULTS.llm, ...mc?.llm },
    consolidation: { ...DEFAULTS.consolidation, ...mc?.consolidation },
    semantic: { ...DEFAULTS.semantic, ...mc?.semantic },
  };
}
