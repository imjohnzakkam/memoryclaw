import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  cpSync,
} from "fs";
import { consolidate } from "../src/consolidate.ts";
import type { LlmConfig, ConsolidationConfig } from "../src/types.ts";

// Mock the LLM module
vi.mock("../src/llm.ts", () => ({
  chatCompletion: vi.fn().mockResolvedValue(
    JSON.stringify({
      summary: "User asked to send an email to John about the project deadline.",
      tags: ["email", "john", "deadline", "projectX"],
      facts: [
        {
          entity: "John",
          field: "email",
          value: "john@example.com",
          confidence: "high",
        },
        {
          entity: "projectX",
          field: "deadline",
          value: "2025-04-10",
          confidence: "medium",
        },
      ],
      confidence: "high",
    }),
  ),
}));

const TEST_DIR = join(import.meta.dirname!, "..", "test-consolidate");
const LOGS_DIR = join(TEST_DIR, "logs");
const EPISODES_DIR = join(TEST_DIR, "episodes");
const SEMANTIC_DIR = join(TEST_DIR, "semantic");

const testLlmConfig: LlmConfig = {
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "llama3:8b",
  embeddingModel: "nomic-embed",
  apiKey: "",
};

const testConsolidationConfig: ConsolidationConfig = {
  interval: 60,
  skillThreshold: 7,
  factValidation: true,
  pendingReview: true,
};

beforeEach(() => {
  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(EPISODES_DIR, { recursive: true });
  mkdirSync(SEMANTIC_DIR, { recursive: true });

  // Create a sample unprocessed log
  writeFileSync(
    join(LOGS_DIR, "2025-04-08T14-30-00_telegram_raw.md"),
    `---
timestamp: 2025-04-08T14:30:00Z
channel: telegram
message_count: 2
processed: false
---

### user (2025-04-08T14:30:00Z)

Send an email to John about the project deadline.

### assistant (2025-04-08T14:30:05Z)

I'll send the email to John about the project deadline right away.
`,
  );

  // Create a semantic file for fact matching
  writeFileSync(
    join(SEMANTIC_DIR, "contacts.md"),
    "# Contacts\n- John: john@example.com\n",
  );
  writeFileSync(
    join(SEMANTIC_DIR, "projects.md"),
    "# Projects\n- projectX deadline: 2025-04-10\n",
  );
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("consolidate", () => {
  it("processes unprocessed logs and creates episodes", async () => {
    const report = await consolidate({
      logsDir: LOGS_DIR,
      episodesDir: EPISODES_DIR,
      semanticDir: SEMANTIC_DIR,
      llmConfig: testLlmConfig,
      consolidationConfig: testConsolidationConfig,
      semanticFiles: ["contacts.md", "projects.md"],
    });

    expect(report.processed).toBe(1);
    expect(report.episodes.length).toBe(1);
    expect(report.failed).toBe(0);

    // Episode file should exist
    const episodeFiles = readdirSync(EPISODES_DIR).filter((f) =>
      f.endsWith(".md"),
    );
    expect(episodeFiles.length).toBe(1);

    // Episode should have correct content
    const episodeContent = readFileSync(
      join(EPISODES_DIR, episodeFiles[0]!),
      "utf-8",
    );
    expect(episodeContent).toContain("email");
    expect(episodeContent).toContain("confidence: high");
  });

  it("moves processed logs to processed/ directory", async () => {
    await consolidate({
      logsDir: LOGS_DIR,
      episodesDir: EPISODES_DIR,
      semanticDir: SEMANTIC_DIR,
      llmConfig: testLlmConfig,
      consolidationConfig: testConsolidationConfig,
      semanticFiles: ["contacts.md", "projects.md"],
    });

    // Original log should be moved
    const remainingLogs = readdirSync(LOGS_DIR).filter((f) =>
      f.endsWith("_raw.md"),
    );
    expect(remainingLogs.length).toBe(0);

    // Should be in processed/
    const processedDir = join(LOGS_DIR, "processed");
    expect(existsSync(processedDir)).toBe(true);
    const processedFiles = readdirSync(processedDir);
    expect(processedFiles.length).toBe(1);
  });

  it("skips already-processed logs", async () => {
    // Mark the log as processed
    const logPath = join(LOGS_DIR, "2025-04-08T14-30-00_telegram_raw.md");
    const content = readFileSync(logPath, "utf-8");
    writeFileSync(logPath, content.replace("processed: false", "processed: true"));

    const report = await consolidate({
      logsDir: LOGS_DIR,
      episodesDir: EPISODES_DIR,
      semanticDir: SEMANTIC_DIR,
      llmConfig: testLlmConfig,
      consolidationConfig: testConsolidationConfig,
      semanticFiles: ["contacts.md", "projects.md"],
    });

    expect(report.processed).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("returns empty report when no logs exist", async () => {
    rmSync(LOGS_DIR, { recursive: true });

    const report = await consolidate({
      logsDir: LOGS_DIR,
      episodesDir: EPISODES_DIR,
      semanticDir: SEMANTIC_DIR,
      llmConfig: testLlmConfig,
      consolidationConfig: testConsolidationConfig,
      semanticFiles: ["contacts.md", "projects.md"],
    });

    expect(report.processed).toBe(0);
    expect(report.skipped).toBe(0);
  });
});
