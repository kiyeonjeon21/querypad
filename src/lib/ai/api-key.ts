import {
  DEFAULT_AI_PROVIDER,
  type AiProvider,
  isAiProvider,
} from "./providers";

const PROVIDER_STORAGE_KEY = "querypad:ai:provider";
const LEGACY_ANTHROPIC_KEY = "querypad:anthropic-api-key";
const STORAGE_KEYS: Record<AiProvider, string> = {
  anthropic: "querypad:ai:anthropic-api-key",
  openai: "querypad:ai:openai-api-key",
};

export function getAiProvider(): AiProvider {
  if (typeof window === "undefined") return DEFAULT_AI_PROVIDER;
  const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
  return isAiProvider(stored) ? stored : DEFAULT_AI_PROVIDER;
}

export function setAiProvider(provider: AiProvider): void {
  localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
}

export function getApiKey(provider: AiProvider): string | null {
  if (typeof window === "undefined") return null;

  const key = localStorage.getItem(STORAGE_KEYS[provider]);
  if (key) return key;

  if (provider === "anthropic") {
    const legacyKey = localStorage.getItem(LEGACY_ANTHROPIC_KEY);
    if (legacyKey) {
      localStorage.setItem(STORAGE_KEYS.anthropic, legacyKey);
      localStorage.removeItem(LEGACY_ANTHROPIC_KEY);
      return legacyKey;
    }
  }

  return null;
}

export function setApiKey(provider: AiProvider, key: string): void {
  localStorage.setItem(STORAGE_KEYS[provider], key);
}

export function clearApiKey(provider: AiProvider): void {
  localStorage.removeItem(STORAGE_KEYS[provider]);
}
