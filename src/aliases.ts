import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";

export type AliasMap = Map<string, string[]>;

export function loadAliases(aliasPath: string): AliasMap {
  const aliases: AliasMap = new Map();
  if (!existsSync(aliasPath)) return aliases;

  const raw = readFileSync(aliasPath, "utf-8");
  const parsed = parse(raw) as Record<string, string[]> | null;
  if (!parsed) return aliases;

  for (const [key, synonyms] of Object.entries(parsed)) {
    const lowerKey = key.toLowerCase();
    const lowerSynonyms = synonyms.map((s) => s.toLowerCase());
    aliases.set(lowerKey, lowerSynonyms);

    // Reverse mapping: each synonym also expands to the key and other synonyms
    for (const synonym of lowerSynonyms) {
      const existing = aliases.get(synonym) ?? [];
      if (!existing.includes(lowerKey)) {
        aliases.set(synonym, [...existing, lowerKey]);
      }
    }
  }

  return aliases;
}

export function expandKeywords(
  keywords: string[],
  aliases: AliasMap,
): string[] {
  const expanded = new Set(keywords);

  for (const keyword of keywords) {
    const synonyms = aliases.get(keyword);
    if (synonyms) {
      for (const synonym of synonyms) {
        expanded.add(synonym);
      }
    }
  }

  return [...expanded];
}
