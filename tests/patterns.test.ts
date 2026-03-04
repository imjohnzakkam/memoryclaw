import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { detectPatterns } from "../src/patterns.ts";

const TEST_DIR = join(import.meta.dirname!, "..", "test-patterns", "episodes");

function writeTestEpisode(filename: string, tags: string[]) {
  writeFileSync(
    join(TEST_DIR, filename),
    `---\ntimestamp: 2025-04-08T14:00:00Z\ntags: [${tags.join(", ")}]\nsummary: "test"\nparticipants: [user]\nconfidence: high\n---\nDetails`,
  );
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  const parent = join(import.meta.dirname!, "..", "test-patterns");
  if (existsSync(parent)) rmSync(parent, { recursive: true });
});

describe("detectPatterns", () => {
  it("detects repeated tag combinations above threshold", () => {
    // Create 3 episodes with the same tag pair
    writeTestEpisode("ep1.md", ["email", "john"]);
    writeTestEpisode("ep2.md", ["email", "john"]);
    writeTestEpisode("ep3.md", ["email", "john"]);

    const patterns = detectPatterns(TEST_DIR, 3);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0]!.actions).toEqual(["email", "john"]);
    expect(patterns[0]!.count).toBe(3);
  });

  it("ignores patterns below threshold", () => {
    writeTestEpisode("ep1.md", ["email", "john"]);
    writeTestEpisode("ep2.md", ["email", "john"]);

    const patterns = detectPatterns(TEST_DIR, 5);
    expect(patterns.length).toBe(0);
  });

  it("returns empty for nonexistent directory", () => {
    expect(detectPatterns("/nonexistent/dir", 1)).toEqual([]);
  });

  it("sorts by frequency descending", () => {
    // 4 occurrences of [budget, meeting]
    for (let i = 0; i < 4; i++) {
      writeTestEpisode(`budget_${i}.md`, ["budget", "meeting"]);
    }
    // 3 occurrences of [email, john]
    for (let i = 0; i < 3; i++) {
      writeTestEpisode(`email_${i}.md`, ["email", "john"]);
    }

    const patterns = detectPatterns(TEST_DIR, 3);
    expect(patterns[0]!.actions).toEqual(["budget", "meeting"]);
  });
});
