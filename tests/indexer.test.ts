import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, cpSync } from "fs";
import { EpisodeIndex } from "../src/indexer.ts";

const MEMORYCLAW_DIR = join(import.meta.dirname!, "..", "memoryclaw");
const TEST_DIR = join(import.meta.dirname!, "..", "test-index");
const TEST_EPISODES = join(TEST_DIR, "episodes");
const TEST_INDEX = join(TEST_DIR, "index");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  cpSync(join(MEMORYCLAW_DIR, "episodes"), TEST_EPISODES, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("EpisodeIndex", () => {
  it("builds an index from episode files", () => {
    const index = new EpisodeIndex(TEST_INDEX);
    const count = index.buildIndex(TEST_EPISODES);

    expect(count).toBe(4);
    const stats = index.getStats();
    expect(stats.episodes).toBe(4);
    expect(stats.tags).toBeGreaterThan(0);

    index.close();
  });

  it("searches by tags", () => {
    const index = new EpisodeIndex(TEST_INDEX);
    index.buildIndex(TEST_EPISODES);

    const results = index.searchByTags(["email", "john"], 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toContain("email-john");

    index.close();
  });

  it("searches by full text", () => {
    const index = new EpisodeIndex(TEST_INDEX);
    index.buildIndex(TEST_EPISODES);

    const results = index.searchFullText("project update deadline", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);

    index.close();
  });

  it("combined search deduplicates results", () => {
    const index = new EpisodeIndex(TEST_INDEX);
    index.buildIndex(TEST_EPISODES);

    const results = index.search(["email"], "email project update", 10);
    const unique = new Set(results);
    expect(results.length).toBe(unique.size);

    index.close();
  });

  it("returns empty for no matches", () => {
    const index = new EpisodeIndex(TEST_INDEX);
    index.buildIndex(TEST_EPISODES);

    const results = index.searchByTags(["nonexistent_zzz"], 5);
    expect(results).toEqual([]);

    index.close();
  });

  it("handles re-indexing (idempotent)", () => {
    const index = new EpisodeIndex(TEST_INDEX);
    index.buildIndex(TEST_EPISODES);
    index.buildIndex(TEST_EPISODES); // second time

    const stats = index.getStats();
    expect(stats.episodes).toBe(4); // no duplicates

    index.close();
  });
});
