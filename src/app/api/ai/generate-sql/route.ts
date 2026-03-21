import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a DuckDB SQL expert. Generate only valid DuckDB SQL queries based on the user's natural language request and the provided table schema. Output ONLY the SQL query — no explanations, no markdown fences, no comments. If the request is ambiguous, make reasonable assumptions.`;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      "ANTHROPIC_API_KEY not configured. Add it to .env.local to enable AI features.",
      { status: 503 }
    );
  }

  const { prompt, schema } = await request.json();
  if (!prompt || typeof prompt !== "string") {
    return new Response("Missing prompt", { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Table schema:\n${schema || "No tables loaded."}\n\nRequest: ${prompt}`,
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
