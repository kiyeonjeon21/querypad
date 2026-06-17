import type { AiProvider } from "../lib/ai/providers";
import { DEFAULT_AI_PROVIDER, isAiProvider } from "../lib/ai/providers";

export interface AiCredentials {
  provider: AiProvider;
  apiKey: string;
}

const ENV_KEYS: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Resolve the AI provider + API key for the CLI from flags and environment.
 * Precedence: explicit `provider` arg → `QUERYPAD_AI_PROVIDER` → default (anthropic).
 * The key comes from the provider-specific env var.
 */
export function resolveAiCredentials(provider?: string): AiCredentials {
  const fromEnv = process.env.QUERYPAD_AI_PROVIDER;
  const selected = provider ?? fromEnv ?? DEFAULT_AI_PROVIDER;

  if (!isAiProvider(selected)) {
    throw new Error(
      `Unknown AI provider "${selected}". Use "anthropic" or "openai".`
    );
  }

  const envVar = ENV_KEYS[selected];
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${selected}. Set ${envVar} in your environment, ` +
        `e.g. \`${envVar}=sk-... querypad ask "..."\`.`
    );
  }

  return { provider: selected, apiKey };
}
