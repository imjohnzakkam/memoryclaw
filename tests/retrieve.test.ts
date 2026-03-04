import { describe, it, expect } from "vitest";
import { join } from "path";
import { retrieve } from "../src/retrieve.ts";
import type { MemoryClawConfig } from "../src/types.ts";

const MEMORYCLAW_DIR = join(import.meta.dirname!, "..", "memoryclaw");

const testConfig: MemoryClawConfig = {
  path: MEMORYCLAW_DIR,
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

describe("retrieve", () => {
  it("returns matching episodes and facts for a query", async () => {
    const result = await retrieve("email John about project", testConfig);

    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    expect(result.episodes[0]!.tags).toContain("email");

    // Should also find John's contact info
    expect(result.facts["contacts.md:John"]).toBe("john@example.com");
  });

  it("returns budget-related episodes for finance query", async () => {
    const result = await retrieve("budget review meeting", testConfig);

    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    expect(result.episodes[0]!.tags).toContain("budget");
  });

  it("returns empty episodes for unrelated query", async () => {
    const result = await retrieve("zzz nonexistent topic", testConfig);

    expect(result.episodes.length).toBe(0);
  });

  it("returns facts even when no episodes match", async () => {
    const result = await retrieve("Sarah contact info", testConfig);

    expect(result.facts["contacts.md:Sarah"]).toBe("sarah@work.com");
  });

  it("finds episodes via alias expansion (finance → budget)", async () => {
    const result = await retrieve("finance review", testConfig);

    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    expect(result.episodes[0]!.tags).toContain("budget");
  });

  it("finds episodes via alias expansion (trip → travel)", async () => {
    const result = await retrieve("trip reimbursement", testConfig);

    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    expect(result.episodes[0]!.tags).toContain("travel");
  });
});
