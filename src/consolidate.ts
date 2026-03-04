import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import type { LlmConfig, ConsolidationResult, ConsolidationConfig } from "./types.ts";
import { chatCompletion } from "./llm.ts";
import { updateSemanticMemory } from "./semantic-writer.ts";

const SUMMARIZATION_PROMPT = `You are a memory consolidation system. Analyze the following conversation transcript and produce a JSON response with:

1. "summary": A one-sentence summary of what happened in this interaction.
2. "tags": An array of 3-7 lowercase keyword tags relevant to the interaction.
3. "facts": An array of factual items extracted from the conversation. Each fact is an object with "entity" (the subject), "field" (the attribute), "value" (the value), and "confidence" ("low", "medium", or "high").
4. "confidence": Overall confidence in this summary ("low", "medium", or "high") based on transcript clarity.

IMPORTANT:
- Do NOT include passwords, API keys, tokens, or personal identification numbers in your output.
- Only extract facts that are explicitly stated, not inferred.
- Tags should be concrete nouns or verbs, not abstract concepts.

Respond with ONLY valid JSON, no markdown fencing.`;

function parseLogFrontmatter(filePath: string): { processed: boolean; timestamp: string; channel: string } {
  const raw = readFileSync(filePath, "utf-8");
  const { data } = matter(raw);
  const parsedTimestamp = data.timestamp instanceof Date
    ? data.timestamp.toISOString()
    : String(data.timestamp ?? "");
  return {
    processed: data.processed === true || data.processed === "true",
    timestamp: parsedTimestamp,
    channel: String(data.channel ?? "unknown"),
  };
}

function getLogContent(filePath: string): string {
  const raw = readFileSync(filePath, "utf-8");
  const { content } = matter(raw);
  return content.trim();
}

function markAsProcessed(filePath: string, processedDir: string): void {
  if (!existsSync(processedDir)) {
    mkdirSync(processedDir, { recursive: true });
  }
  const filename = filePath.split("/").pop()!;
  renameSync(filePath, join(processedDir, filename));
}

function parseConsolidationResponse(response: string): ConsolidationResult | null {
  try {
    // Strip markdown code fences if present
    const cleaned = response.replace(/^```json?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.summary || !Array.isArray(parsed.tags)) return null;

    return {
      summary: String(parsed.summary),
      tags: parsed.tags.map(String),
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.map((f: Record<string, unknown>) => ({
            entity: String(f.entity ?? ""),
            field: String(f.field ?? ""),
            value: String(f.value ?? ""),
            confidence: ["low", "medium", "high"].includes(String(f.confidence))
              ? (String(f.confidence) as "low" | "medium" | "high")
              : "low",
          }))
        : [],
      confidence: ["low", "medium", "high"].includes(String(parsed.confidence))
        ? (String(parsed.confidence) as "low" | "medium" | "high")
        : "medium",
    };
  } catch {
    return null;
  }
}

function writeEpisode(
  episodesDir: string,
  timestamp: string,
  result: ConsolidationResult,
  sourceLog: string,
): string {
  if (!existsSync(episodesDir)) {
    mkdirSync(episodesDir, { recursive: true });
  }

  const slug = result.summary
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);

  const datePrefix = timestamp.replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${datePrefix}_${slug}.md`;
  const filePath = join(episodesDir, filename);

  const lines = [
    "---",
    `timestamp: ${timestamp}`,
    `tags: [${result.tags.join(", ")}]`,
    `summary: "${result.summary.replace(/"/g, '\\"')}"`,
    `participants: [user, assistant]`,
    `confidence: ${result.confidence}`,
    `source: ${sourceLog}`,
    "---",
    "",
    "**Details:**",
    "",
    ...result.facts.map(
      (f) => `- ${f.entity} ${f.field}: ${f.value} (confidence: ${f.confidence})`,
    ),
  ];

  writeFileSync(filePath, lines.join("\n"), { mode: 0o600 });
  return filePath;
}

export interface ConsolidateOptions {
  logsDir: string;
  episodesDir: string;
  semanticDir: string;
  llmConfig: LlmConfig;
  llmFallbackConfig?: LlmConfig;
  consolidationConfig: ConsolidationConfig;
  semanticFiles: string[];
}

export interface ConsolidateReport {
  processed: number;
  skipped: number;
  failed: number;
  episodes: string[];
  conflicts: { entity: string; field: string; existingValue: string; newValue: string }[];
}

export async function consolidate(opts: ConsolidateOptions): Promise<ConsolidateReport> {
  const report: ConsolidateReport = {
    processed: 0,
    skipped: 0,
    failed: 0,
    episodes: [],
    conflicts: [],
  };

  const processedDir = join(opts.logsDir, "processed");

  // Find unprocessed logs
  if (!existsSync(opts.logsDir)) return report;

  const logFiles = readdirSync(opts.logsDir)
    .filter((f) => f.endsWith("_raw.md"))
    .map((f) => join(opts.logsDir, f));

  for (const logFile of logFiles) {
    const meta = parseLogFrontmatter(logFile);
    if (meta.processed) {
      report.skipped++;
      continue;
    }

    const transcript = getLogContent(logFile);
    if (!transcript) {
      report.skipped++;
      continue;
    }

    // Call LLM for summarization
    const response = await chatCompletion(
      [
        { role: "system", content: SUMMARIZATION_PROMPT },
        { role: "user", content: transcript },
      ],
      opts.llmConfig,
    );

    const fallbackResponse = !response && opts.llmFallbackConfig
      ? await chatCompletion(
          [
            { role: "system", content: SUMMARIZATION_PROMPT },
            { role: "user", content: transcript },
          ],
          opts.llmFallbackConfig,
        )
      : null;

    const finalResponse = response ?? fallbackResponse;

    if (!finalResponse) {
      report.failed++;
      continue;
    }

    const result = parseConsolidationResponse(finalResponse);
    if (!result) {
      report.failed++;
      continue;
    }

    // Write episode
    const episodePath = writeEpisode(
      opts.episodesDir,
      meta.timestamp || new Date().toISOString(),
      result,
      logFile.split("/").pop()!,
    );
    report.episodes.push(episodePath);

    // Update semantic memory with extracted facts
    if (result.facts.length > 0) {
      const updateResult = updateSemanticMemory(
        opts.semanticDir,
        opts.semanticFiles,
        result.facts,
        logFile.split("/").pop()!,
        opts.consolidationConfig.pendingReview,
      );
      report.conflicts.push(...updateResult.conflicts);
    }

    // Move log to processed
    markAsProcessed(logFile, processedDir);
    report.processed++;
  }

  return report;
}
