import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import type { Episode } from "./types.ts";
import { parseEpisode } from "./episodic.ts";
import { extractKeywords } from "./keywords.ts";
import { loadAliases, expandKeywords } from "./aliases.ts";

export interface AuditEntry {
  type: "episode" | "fact";
  file: string;
  content: string;
  timestamp: string;
  confidence: string;
}

export function auditMemories(
  memoryclawDir: string,
  limit: number = 10,
): AuditEntry[] {
  const entries: AuditEntry[] = [];

  // Recent episodes
  const episodesDir = join(memoryclawDir, "episodes");
  if (existsSync(episodesDir)) {
    const files = readdirSync(episodesDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit);

    for (const file of files) {
      const episode = parseEpisode(join(episodesDir, file));
      entries.push({
        type: "episode",
        file,
        content: episode.summary,
        timestamp: episode.timestamp,
        confidence: episode.confidence,
      });
    }
  }

  // Pending facts
  const pendingPath = join(memoryclawDir, "semantic", "_pending.md");
  if (existsSync(pendingPath)) {
    const content = readFileSync(pendingPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().startsWith("-"));
    for (const line of lines.slice(-limit)) {
      entries.push({
        type: "fact",
        file: "_pending.md",
        content: line.trim().replace(/^-\s*/, ""),
        timestamp: "",
        confidence: "pending",
      });
    }
  }

  return entries;
}

export function searchMemories(
  memoryclawDir: string,
  query: string,
  maxResults: number = 10,
): Episode[] {
  const episodesDir = join(memoryclawDir, "episodes");
  if (!existsSync(episodesDir)) return [];

  const files = readdirSync(episodesDir).filter((f) => f.endsWith(".md"));
  const episodes = files.map((f) => parseEpisode(join(episodesDir, f)));

  const rawKeywords = extractKeywords(query);
  const aliasPath = join(memoryclawDir, "semantic", "aliases.yaml");
  const aliases = loadAliases(aliasPath);
  const keywords = expandKeywords(rawKeywords, aliases);

  if (keywords.length === 0) return episodes.slice(0, maxResults);

  const scored = episodes.map((episode) => {
    let score = 0;
    const lowerSummary = episode.summary.toLowerCase();
    const lowerTags = episode.tags.map((t) => t.toLowerCase());
    const lowerDetails = episode.details.toLowerCase();

    for (const keyword of keywords) {
      if (lowerTags.includes(keyword)) score += 3;
      if (lowerSummary.includes(keyword)) score += 2;
      if (lowerDetails.includes(keyword)) score += 1;
    }

    return { episode, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.episode);
}

export function deleteMemory(
  memoryclawDir: string,
  filename: string,
): boolean {
  const episodePath = join(memoryclawDir, "episodes", filename);
  if (existsSync(episodePath)) {
    unlinkSync(episodePath);
    return true;
  }
  return false;
}

export function deleteFact(
  memoryclawDir: string,
  semanticFile: string,
  factKey: string,
): boolean {
  const filePath = join(memoryclawDir, "semantic", semanticFile);
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const keyLower = factKey.toLowerCase();

  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^-?\s*(\w[\w\s-]*):\s*(.+)$/);
    if (!match) return true;
    return match[1]!.trim().toLowerCase() !== keyLower;
  });

  if (filtered.length === lines.length) return false;

  writeFileSync(filePath, filtered.join("\n"), { mode: 0o600 });
  return true;
}
