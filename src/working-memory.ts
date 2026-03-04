import type {
  WorkingMemory,
  MemoryClawConfig,
  RetrievalResult,
} from "./types.ts";
import { retrieve } from "./retrieve.ts";

const DEFAULT_MAX_TOKENS = 2000;

const EMPTY_WORKING_MEMORY: WorkingMemory = {
  goal: "",
  plan: [],
  facts: {},
  recentObservations: [],
  activeSkill: null,
  retrievedEpisodes: [],
  retrievedFacts: {},
};

export function createWorkingMemory(goal: string): WorkingMemory {
  return { ...EMPTY_WORKING_MEMORY, goal };
}

export function updateWorkingMemory(
  memory: WorkingMemory,
  updates: Partial<WorkingMemory>,
): WorkingMemory {
  return { ...memory, ...updates };
}

export function addObservation(
  memory: WorkingMemory,
  observation: string,
  maxObservations: number = 5,
): WorkingMemory {
  const recentObservations = [
    ...memory.recentObservations,
    observation,
  ].slice(-maxObservations);
  return { ...memory, recentObservations };
}

export function addFact(
  memory: WorkingMemory,
  key: string,
  value: string,
): WorkingMemory {
  return {
    ...memory,
    facts: { ...memory.facts, [key]: value },
  };
}

export function clearWorkingMemory(): WorkingMemory {
  return { ...EMPTY_WORKING_MEMORY };
}

export async function hydrateWorkingMemory(
  memory: WorkingMemory,
  query: string,
  config: MemoryClawConfig,
): Promise<WorkingMemory> {
  const result = await retrieve(query, config);

  return {
    ...memory,
    retrievedEpisodes: result.episodes.map((e) => e.summary),
    retrievedFacts: result.facts,
  };
}

export function workingMemoryToPrompt(
  memory: WorkingMemory,
  maxTokenEstimate: number = DEFAULT_MAX_TOKENS,
): string {
  const sections: string[] = [];

  if (memory.goal) {
    sections.push(`**Current Goal:** ${memory.goal}`);
  }

  if (memory.plan.length > 0) {
    sections.push(
      `**Plan:** ${memory.plan.map((s, i) => `${i + 1}. ${s}`).join(" | ")}`,
    );
  }

  if (memory.activeSkill) {
    sections.push(`**Active Skill:** ${memory.activeSkill}`);
  }

  const factEntries = Object.entries(memory.facts);
  if (factEntries.length > 0) {
    sections.push(
      `**Known Facts:** ${factEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    );
  }

  if (memory.retrievedEpisodes.length > 0) {
    sections.push(
      `**Relevant Past Interactions:**\n${memory.retrievedEpisodes.map((e) => `- ${e}`).join("\n")}`,
    );
  }

  const retrievedFactEntries = Object.entries(memory.retrievedFacts);
  if (retrievedFactEntries.length > 0) {
    sections.push(
      `**Retrieved Facts:** ${retrievedFactEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    );
  }

  if (memory.recentObservations.length > 0) {
    sections.push(
      `**Recent Observations:** ${memory.recentObservations.join(" → ")}`,
    );
  }

  let prompt = sections.join("\n\n");

  // Rough token estimate: ~4 chars per token
  const estimatedTokens = prompt.length / 4;
  if (estimatedTokens > maxTokenEstimate) {
    // Trim observations first, then episodes
    const trimmedMemory = {
      ...memory,
      recentObservations: memory.recentObservations.slice(-2),
      retrievedEpisodes: memory.retrievedEpisodes.slice(0, 2),
    };
    return workingMemoryToPrompt(trimmedMemory, maxTokenEstimate);
  }

  return prompt;
}

export function onBeforeLLM(
  memory: WorkingMemory,
  systemPrompt: string,
): string {
  const memoryContext = workingMemoryToPrompt(memory);
  if (!memoryContext) return systemPrompt;

  return `${systemPrompt}\n\n---\n**[MemoryClaw Working Memory]**\n${memoryContext}`;
}
