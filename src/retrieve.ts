import { join } from "path";
import type { MemoryClawConfig, RetrievalResult } from "./types.ts";
import { extractKeywords } from "./keywords.ts";
import { loadAliases, expandKeywords } from "./aliases.ts";
import { loadEpisodes, searchEpisodes } from "./episodic.ts";
import { loadSemanticFiles, lookupSemantic } from "./semantic.ts";
import { vectorSearch } from "./vector.ts";

export async function retrieve(
  query: string,
  config: MemoryClawConfig,
): Promise<RetrievalResult> {
  const episodesDir = join(config.path, "episodes");
  const semanticDir = join(config.path, "semantic");
  const aliasPath = join(semanticDir, "aliases.yaml");

  // 1. Load episodes
  const allEpisodes = loadEpisodes(episodesDir);

  // 2. Keyword extraction + alias expansion
  const rawKeywords = extractKeywords(query);
  const aliases = loadAliases(aliasPath);
  const keywords = expandKeywords(rawKeywords, aliases);

  // 3. Episode search (primary)
  let episodes = searchEpisodes(
    allEpisodes,
    keywords,
    config.retrieval.maxResults,
  );

  // 4. Vector fallback if needed
  if (
    episodes.length < config.retrieval.minPrimaryResults &&
    config.retrieval.fallback === "vector"
  ) {
    const vectorResults = await vectorSearch(
      query,
      allEpisodes,
      config.llm,
      config.retrieval.maxResults,
    );

    // Blend: keyword results first, then vector (deduplicated)
    const seen = new Set(episodes.map((e) => e.file));
    for (const vr of vectorResults) {
      if (!seen.has(vr.file)) {
        episodes.push(vr);
      }
    }
    episodes = episodes.slice(0, config.retrieval.maxResults);
  }

  // 5. Semantic lookup
  const semanticData = loadSemanticFiles(semanticDir, config.semantic.files);
  const facts = lookupSemantic(semanticData, query);

  return { episodes, facts };
}
