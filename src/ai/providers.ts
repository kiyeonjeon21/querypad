export type AiProvider = "anthropic" | "openai";

export interface AiProviderConfig {
  id: AiProvider;
  label: string;
  modelLabel: string;
  model: string;
  keyPlaceholder: string;
  keyUrl: string;
}

export const DEFAULT_AI_PROVIDER: AiProvider = "anthropic";

export const AI_PROVIDER_CONFIGS: Record<AiProvider, AiProviderConfig> = {
  anthropic: {
    id: "anthropic",
    label: "Claude",
    modelLabel: "Sonnet 4.6",
    model: "claude-sonnet-4-6",
    keyPlaceholder: "Enter your Anthropic API key (sk-ant-...)",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    modelLabel: "GPT-5.5",
    model: "gpt-5.5",
    keyPlaceholder: "Enter your OpenAI API key (sk-...)",
    keyUrl: "https://platform.openai.com/api-keys",
  },
};

export const AI_PROVIDER_OPTIONS = Object.values(AI_PROVIDER_CONFIGS);

export function isAiProvider(value: string | null): value is AiProvider {
  return value === "anthropic" || value === "openai";
}

export function getAiProviderConfig(provider: AiProvider): AiProviderConfig {
  return AI_PROVIDER_CONFIGS[provider];
}
