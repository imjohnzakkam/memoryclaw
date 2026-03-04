import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";
import type { ExtractedFact, SemanticConflict } from "./types.ts";

interface ParsedEntry {
  key: string;
  value: string;
  line: number;
}

function parseSemanticFile(content: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^-?\s*(\w[\w\s-]*):\s*(.+)$/);
    if (match) {
      entries.push({
        key: match[1]!.trim(),
        value: match[2]!.trim(),
        line: i,
      });
    }
  }

  return entries;
}

function findTargetFile(
  semanticDir: string,
  files: string[],
  entity: string,
): string | null {
  for (const file of files) {
    const filePath = join(semanticDir, file);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    if (content.toLowerCase().includes(entity.toLowerCase())) {
      return file;
    }
  }
  return null;
}

export interface SemanticUpdateResult {
  added: number;
  conflicts: SemanticConflict[];
  pending: number;
}

export function updateSemanticMemory(
  semanticDir: string,
  semanticFiles: string[],
  facts: ExtractedFact[],
  source: string,
  usePendingReview: boolean,
): SemanticUpdateResult {
  const result: SemanticUpdateResult = {
    added: 0,
    conflicts: [],
    pending: 0,
  };

  for (const fact of facts) {
    // Low-confidence facts always go to _pending.md
    if (usePendingReview && fact.confidence === "low") {
      appendToPending(semanticDir, fact, source);
      result.pending++;
      continue;
    }

    const factKey = `${fact.entity} ${fact.field}`.trim();
    const targetFile = findTargetFile(semanticDir, semanticFiles, fact.entity);

    if (targetFile) {
      const filePath = join(semanticDir, targetFile);
      const content = readFileSync(filePath, "utf-8");
      const entries = parseSemanticFile(content);

      // Check for existing entry with same key
      const existing = entries.find(
        (e) => e.key.toLowerCase() === factKey.toLowerCase(),
      );

      if (existing) {
        if (existing.value.toLowerCase() === fact.value.toLowerCase()) {
          // Duplicate — skip
          continue;
        }
        // Conflict — flag for review, don't overwrite
        result.conflicts.push({
          file: targetFile,
          entity: fact.entity,
          field: fact.field,
          existingValue: existing.value,
          newValue: fact.value,
          source,
        });
        appendToPending(semanticDir, fact, source, existing.value);
        continue;
      }

      // Append new fact to the file
      const newLine = `- ${factKey}: ${fact.value}\n`;
      appendFileSync(filePath, newLine, { mode: 0o600 });
      result.added++;
    } else {
      // No matching file — put in _pending for review
      appendToPending(semanticDir, fact, source);
      result.pending++;
    }
  }

  return result;
}

function appendToPending(
  semanticDir: string,
  fact: ExtractedFact,
  source: string,
  conflictWith?: string,
): void {
  const pendingPath = join(semanticDir, "_pending.md");
  const timestamp = new Date().toISOString();

  let line = `- ${fact.entity} ${fact.field}: ${fact.value} (confidence: ${fact.confidence}, source: ${source}, added: ${timestamp})`;
  if (conflictWith) {
    line += ` [CONFLICT with existing: "${conflictWith}"]`;
  }
  line += "\n";

  if (!existsSync(pendingPath)) {
    writeFileSync(pendingPath, `# Pending Facts for Review\n\n${line}`, {
      mode: 0o600,
    });
  } else {
    appendFileSync(pendingPath, line, { mode: 0o600 });
  }
}
