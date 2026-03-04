import { describe, it, expect } from "vitest";
import { join } from "path";
import { parseEpisode, loadEpisodes, searchEpisodes } from "../src/episodic.ts";

const EPISODES_DIR = join(import.meta.dirname!, "..", "memoryclaw", "episodes");

describe("parseEpisode", () => {
  it("parses YAML frontmatter from an episode file", () => {
    const episode = parseEpisode(
      join(EPISODES_DIR, "2025-04-08_14-32-10_email-john-project-update.md"),
    );

    expect(episode.timestamp).toBe("2025-04-08T14:32:10.000Z");
    expect(episode.tags).toEqual(["email", "projectX", "deadline", "john"]);
    expect(episode.summary).toContain("send project update email to John");
    expect(episode.participants).toEqual(["user", "assistant"]);
    expect(episode.confidence).toBe("high");
    expect(episode.details).toContain("Recipient: John");
  });
});

describe("loadEpisodes", () => {
  it("loads all episode files from directory", () => {
    const episodes = loadEpisodes(EPISODES_DIR);
    expect(episodes.length).toBe(4);
    expect(episodes.every((e) => e.tags.length > 0)).toBe(true);
  });
});

describe("searchEpisodes", () => {
  it("finds episodes matching keywords by tags", () => {
    const episodes = loadEpisodes(EPISODES_DIR);
    const results = searchEpisodes(episodes, ["email", "john"], 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.tags).toContain("email");
  });

  it("ranks tag matches higher than summary matches", () => {
    const episodes = loadEpisodes(EPISODES_DIR);
    const results = searchEpisodes(episodes, ["email"], 5);

    // The episode tagged "email" should be first
    expect(results[0]!.tags).toContain("email");
  });

  it("returns empty array when no keywords match", () => {
    const episodes = loadEpisodes(EPISODES_DIR);
    const results = searchEpisodes(episodes, ["nonexistent", "zzzzz"], 5);
    expect(results).toEqual([]);
  });

  it("returns empty array for empty keywords", () => {
    const episodes = loadEpisodes(EPISODES_DIR);
    const results = searchEpisodes(episodes, [], 5);
    expect(results).toEqual([]);
  });

  it("respects maxResults limit", () => {
    const episodes = loadEpisodes(EPISODES_DIR);
    const results = searchEpisodes(episodes, ["email", "budget", "travel", "slack"], 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
