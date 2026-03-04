import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
} from "fs";
import {
  auditMemories,
  searchMemories,
  deleteMemory,
  deleteFact,
} from "../src/memories.ts";

const MEMORYCLAW_DIR = join(import.meta.dirname!, "..", "memoryclaw");
const TEST_DIR = join(import.meta.dirname!, "..", "test-memories");

beforeEach(() => {
  // Copy memoryclaw data to test dir
  cpSync(MEMORYCLAW_DIR, TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("auditMemories", () => {
  it("returns recent episodes", () => {
    const entries = auditMemories(TEST_DIR);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.type === "episode")).toBe(true);
  });

  it("respects limit parameter", () => {
    const entries = auditMemories(TEST_DIR, 2);
    const episodes = entries.filter((e) => e.type === "episode");
    expect(episodes.length).toBeLessThanOrEqual(2);
  });
});

describe("searchMemories", () => {
  it("finds episodes matching a query", () => {
    const results = searchMemories(TEST_DIR, "email John");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.tags).toContain("email");
  });

  it("finds episodes via alias expansion", () => {
    const results = searchMemories(TEST_DIR, "finance review");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.tags).toContain("budget");
  });

  it("searches details field too", () => {
    const results = searchMemories(TEST_DIR, "JAL airline");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for unrelated query", () => {
    const results = searchMemories(TEST_DIR, "zzz nonexistent");
    expect(results.length).toBe(0);
  });
});

describe("deleteMemory", () => {
  it("deletes an existing episode file", () => {
    const filename = "2025-04-08_14-32-10_email-john-project-update.md";
    const deleted = deleteMemory(TEST_DIR, filename);
    expect(deleted).toBe(true);
    expect(existsSync(join(TEST_DIR, "episodes", filename))).toBe(false);
  });

  it("returns false for nonexistent file", () => {
    expect(deleteMemory(TEST_DIR, "nonexistent.md")).toBe(false);
  });
});

describe("deleteFact", () => {
  it("removes a fact from a semantic file", () => {
    const deleted = deleteFact(TEST_DIR, "contacts.md", "John");
    expect(deleted).toBe(true);

    const content = readFileSync(
      join(TEST_DIR, "semantic", "contacts.md"),
      "utf-8",
    );
    expect(content).not.toContain("john@example.com");
    // Other entries should remain
    expect(content).toContain("Sarah");
  });

  it("returns false for nonexistent fact", () => {
    expect(deleteFact(TEST_DIR, "contacts.md", "NonexistentPerson")).toBe(false);
  });

  it("returns false for nonexistent file", () => {
    expect(deleteFact(TEST_DIR, "nonexistent.md", "John")).toBe(false);
  });
});
