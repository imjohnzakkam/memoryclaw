import type { LlmConfig } from "./types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  message: { content: string };
}

interface OpenAIChatResponse {
  choices: { message: { content: string } }[];
}

export async function chatCompletion(
  messages: ChatMessage[],
  llmConfig: LlmConfig,
): Promise<string | null> {
  try {
    if (llmConfig.provider === "ollama") {
      const response = await fetch(`${llmConfig.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llmConfig.model,
          messages,
          stream: false,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as OllamaChatResponse;
      return data.message.content;
    }

    // OpenAI-compatible endpoint
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (llmConfig.apiKey) {
      headers["Authorization"] = `Bearer ${llmConfig.apiKey}`;
    }

    const trimmedBase = llmConfig.baseUrl.replace(/\/+$/, "");
    const endpoint = /\/v1$/i.test(trimmedBase)
      ? `${trimmedBase}/chat/completions`
      : `${trimmedBase}/v1/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as OpenAIChatResponse;
    return data.choices[0]?.message.content ?? null;
  } catch {
    return null;
  }
}
