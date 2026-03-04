import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import type { Episode } from "./types.ts";

export function parseEpisode(filePath: string): Episode {
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  return {
    timestamp:
      data.timestamp instanceof Date
        ? data.timestamp.toISOString()
        : String(data.timestamp ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    summary: data.summary ?? "",
    participants: Array.isArray(data.participants) ? data.participants : [],
    confidence: data.confidence ?? "medium",
    details: content.trim(),
    file: filePath,
  };
}

export function loadEpisodes(episodesDir: string): Episode[] {
  const files = readdirSync(episodesDir).filter((f) => f.endsWith(".md"));
  return files.map((f) => parseEpisode(join(episodesDir, f)));
}

export function searchEpisodes(
  episodes: Episode[],
  keywords: string[],
  maxResults: number,
): Episode[] {
  if (keywords.length === 0) return [];

  const scored = episodes.map((episode) => {
    let score = 0;
    const lowerSummary = episode.summary.toLowerCase();
    const lowerTags = episode.tags.map((t) => t.toLowerCase());

    for (const keyword of keywords) {
      // Tag exact match scores higher
      if (lowerTags.includes(keyword)) {
        score += 3;
      }
      // Summary contains keyword
      if (lowerSummary.includes(keyword)) {
        score += 1;
      }
    }

    return { episode, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.episode);
}
