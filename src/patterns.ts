import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import type { ActionSequence } from "./types.ts";

interface EpisodeActions {
  tags: string[];
  file: string;
}

function extractActionsFromEpisode(filePath: string): EpisodeActions | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { data } = matter(raw);
    if (!Array.isArray(data.tags) || data.tags.length === 0) return null;
    return {
      tags: data.tags.map(String).sort(),
      file: filePath.split("/").pop()!,
    };
  } catch {
    return null;
  }
}

function sequenceKey(actions: string[]): string {
  return actions.join("|");
}

export function detectPatterns(
  episodesDir: string,
  threshold: number,
  minSequenceLength: number = 2,
  maxSequenceLength: number = 4,
): ActionSequence[] {
  if (!existsSync(episodesDir)) return [];

  const files = readdirSync(episodesDir).filter((f) => f.endsWith(".md"));
  const episodes = files
    .map((f) => extractActionsFromEpisode(join(episodesDir, f)))
    .filter((e): e is EpisodeActions => e !== null);

  // Count tag combination frequencies
  const frequencyMap = new Map<
    string,
    { actions: string[]; count: number; sources: string[] }
  >();

  for (const episode of episodes) {
    // Generate all subsequences of length minSequenceLength to maxSequenceLength
    for (
      let len = minSequenceLength;
      len <= Math.min(maxSequenceLength, episode.tags.length);
      len++
    ) {
      for (let i = 0; i <= episode.tags.length - len; i++) {
        const subsequence = episode.tags.slice(i, i + len);
        const key = sequenceKey(subsequence);

        const existing = frequencyMap.get(key);
        if (existing) {
          existing.count++;
          if (!existing.sources.includes(episode.file)) {
            existing.sources.push(episode.file);
          }
        } else {
          frequencyMap.set(key, {
            actions: subsequence,
            count: 1,
            sources: [episode.file],
          });
        }
      }
    }
  }

  // Filter by threshold and return sorted by frequency
  return [...frequencyMap.values()]
    .filter((entry) => entry.count >= threshold)
    .sort((a, b) => b.count - a.count);
}
