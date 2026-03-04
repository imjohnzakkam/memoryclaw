import { existsSync, readFileSync } from "fs";
import { join } from "path";

export function loadSemanticFiles(
  semanticDir: string,
  files: string[],
): Map<string, string> {
  const data = new Map<string, string>();
  for (const file of files) {
    const path = join(semanticDir, file);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf-8");
    data.set(file, content);
  }
  return data;
}

export function lookupSemantic(
  semanticData: Map<string, string>,
  query: string,
): Record<string, string> {
  const facts: Record<string, string> = {};
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1);

  for (const [file, content] of semanticData) {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Match lines like "- Key: value" or "    key: value"
      const match = trimmed.match(/^-?\s*(\w[\w\s-]*):\s*(.+)$/);
      if (!match) continue;

      const key = match[1]!.trim();
      const value = match[2]!.trim();

      // Check if any query word matches the key or value
      const keyLower = key.toLowerCase();
      const valueLower = value.toLowerCase();

      for (const word of queryWords) {
        if (keyLower.includes(word) || valueLower.includes(word)) {
          facts[`${file}:${key}`] = value;
          break;
        }
      }
    }
  }

  return facts;
}
