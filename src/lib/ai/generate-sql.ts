const SYSTEM_PROMPT = `You are a DuckDB SQL expert. Generate only valid DuckDB SQL queries based on the user's natural language request and the provided table schema. Output ONLY the SQL query — no explanations, no markdown fences, no comments. If the request is ambiguous, make reasonable assumptions.`;

export async function* generateSql(
  apiKey: string,
  prompt: string,
  schema: string
): AsyncGenerator<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Table schema:\n${schema || "No tables loaded."}\n\nRequest: ${prompt}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid API key. Please check your key and try again.");
    }
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please wait a moment and try again.");
    }
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

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
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }
}
