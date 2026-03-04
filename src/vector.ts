import type { Episode, LlmConfig } from "./types.ts";

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[] }[];
}

async function getEmbedding(
  text: string,
  llmConfig: LlmConfig,
): Promise<number[] | null> {
  try {
    if (llmConfig.provider === "ollama") {
      const response = await fetch(`${llmConfig.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llmConfig.embeddingModel,
          prompt: text,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as OllamaEmbeddingResponse;
      return data.embedding;
    }

    // OpenAI-compatible endpoint
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (llmConfig.apiKey) {
      headers["Authorization"] = `Bearer ${llmConfig.apiKey}`;
    }

    const response = await fetch(`${llmConfig.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llmConfig.embeddingModel,
        input: text,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as OpenAIEmbeddingResponse;
    return data.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export async function vectorSearch(
  query: string,
  episodes: Episode[],
  llmConfig: LlmConfig,
  maxResults: number,
): Promise<Episode[]> {
  const queryEmbedding = await getEmbedding(query, llmConfig);
  if (!queryEmbedding) {
    console.warn(
      `[memoryclaw] Vector fallback unavailable — ${llmConfig.provider} at ${llmConfig.baseUrl} not reachable`,
    );
    return [];
  }

  const scored: { episode: Episode; score: number }[] = [];

  for (const episode of episodes) {
    const text = `${episode.summary} ${episode.tags.join(" ")}`;
    const embedding = await getEmbedding(text, llmConfig);
    if (!embedding) continue;

    scored.push({
      episode,
      score: cosineSimilarity(queryEmbedding, embedding),
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.episode);
}
