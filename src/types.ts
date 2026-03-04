export interface RetrievalConfig {
  primary: "keyword";
  minPrimaryResults: number;
  fallback: "none" | "vector";
  maxResults: number;
  blendStrategy: "primary_first";
}

export interface LlmConfig {
  provider: "ollama" | "openai-compatible";
  baseUrl: string;
  model: string;
  embeddingModel: string;
  apiKey: string;
}

export interface ConsolidationConfig {
  interval: number;
  skillThreshold: number;
  factValidation: boolean;
  pendingReview: boolean;
}

export interface SemanticConfig {
  files: string[];
}

export interface MemoryClawConfig {
  path: string;
  retrieval: RetrievalConfig;
  llm: LlmConfig;
  consolidation: ConsolidationConfig;
  semantic: SemanticConfig;
}

export interface Episode {
  timestamp: string;
  tags: string[];
  summary: string;
  participants: string[];
  confidence: "low" | "medium" | "high";
  details: string;
  file: string;
}

export interface RetrievalResult {
  episodes: Episode[];
  facts: Record<string, string>;
}

export interface LogEntry {
  timestamp: string;
  channel: string;
  messages: LogMessage[];
  metadata: Record<string, unknown>;
}

export interface LogMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
}

export interface ConsolidationResult {
  summary: string;
  tags: string[];
  facts: ExtractedFact[];
  confidence: "low" | "medium" | "high";
}

export interface ExtractedFact {
  entity: string;
  field: string;
  value: string;
  confidence: "low" | "medium" | "high";
}

export interface SemanticConflict {
  file: string;
  entity: string;
  field: string;
  existingValue: string;
  newValue: string;
  source: string;
}

// Phase 5: Skill Compilation

export interface ActionSequence {
  actions: string[];
  count: number;
  sources: string[];
}

export interface SkillTemplate {
  name: string;
  triggers: string[];
  status: "draft" | "approved" | "rejected";
  parameters: SkillParameter[];
  steps: SkillStep[];
  source: string;
  createdAt: string;
}

export interface SkillParameter {
  name: string;
  type: string;
  source: string;
  optional: boolean;
}

export interface SkillStep {
  action: string;
  params: Record<string, string>;
}

// Phase 6: Working Memory

export interface WorkingMemory {
  goal: string;
  plan: string[];
  facts: Record<string, string>;
  recentObservations: string[];
  activeSkill: string | null;
  retrievedEpisodes: string[];
  retrievedFacts: Record<string, string>;
}
