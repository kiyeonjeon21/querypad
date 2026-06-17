import type { AiProvider } from "./providers";
import { getAiProviderConfig } from "./providers";

export interface CompleteOptions {
  provider: AiProvider;
  apiKey: string;
  /** System prompt / instructions. */
  system: string;
  /** User input (already-assembled prompt). */
  input: string;
  /** Max output tokens (default 1024). */
  maxTokens?: number;
}

function httpError(status: number, body: string): Error {
  if (status === 401) {
    return new Error("Invalid API key. Please check your key and try again.");
  }
  if (status === 429) {
    return new Error("Rate limit exceeded. Please wait a moment and try again.");
  }
  return new Error(body || `HTTP ${status}`);
}

async function* streamAnthropic({
  apiKey,
  system,
  input,
  maxTokens = 1024,
}: CompleteOptions): AsyncGenerator<string> {
  const config = getAiProviderConfig("anthropic");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: [{ role: "user", content: input }],
    }),
  });

  if (!response.ok) throw httpError(response.status, await response.text());

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;

      try {
        const event = JSON.parse(data);
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          yield event.delta.text;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }
}

async function* streamOpenAi({
  apiKey,
  system,
  input,
  maxTokens = 1024,
}: CompleteOptions): AsyncGenerator<string> {
  const config = getAiProviderConfig("openai");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      instructions: system,
      input,
      max_output_tokens: maxTokens,
      reasoning: { effort: "low" },
      stream: true,
      store: false,
      text: {
        format: { type: "text" },
        verbosity: "low",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status !== 401 && response.status !== 429) {
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        if (parsed.error?.message) throw new Error(parsed.error.message);
      } catch {
        // fall through to generic error below
      }
    }
    throw httpError(response.status, body);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventText of events) {
      const dataLine = eventText.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;

      const data = dataLine.slice(6);
      if (data === "[DONE]") return;

      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      if (event.type === "response.output_text.delta") {
        yield event.delta;
      }
      if (event.type === "response.failed") {
        throw new Error(event.response?.error?.message || "OpenAI response failed.");
      }
    }
  }
}

/** Provider-routed streaming completion. Yields text deltas as they arrive. */
export async function* streamComplete(options: CompleteOptions): AsyncGenerator<string> {
  if (options.provider === "openai") {
    yield* streamOpenAi(options);
    return;
  }
  yield* streamAnthropic(options);
}

/** Convenience: collect a streamed completion into a single string. */
export async function complete(options: CompleteOptions): Promise<string> {
  let out = "";
  for await (const chunk of streamComplete(options)) out += chunk;
  return out;
}
