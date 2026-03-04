export { retrieve } from "./retrieve.ts";
export { loadConfig } from "./config.ts";
export { extractKeywords } from "./keywords.ts";
export { loadAliases, expandKeywords } from "./aliases.ts";
export { loadEpisodes, parseEpisode, searchEpisodes } from "./episodic.ts";
export { loadSemanticFiles, lookupSemantic } from "./semantic.ts";
export { vectorSearch } from "./vector.ts";
export { logInteraction } from "./logger.ts";
export { chatCompletion } from "./llm.ts";
export { consolidate } from "./consolidate.ts";
export { updateSemanticMemory } from "./semantic-writer.ts";
export { auditMemories, searchMemories, deleteMemory, deleteFact } from "./memories.ts";
export type {
  MemoryClawConfig,
  LlmConfig,
  Episode,
  RetrievalResult,
  RetrievalConfig,
  ConsolidationConfig,
  SemanticConfig,
  LogEntry,
  LogMessage,
  ConsolidationResult,
  ExtractedFact,
  SemanticConflict,
} from "./types.ts";
