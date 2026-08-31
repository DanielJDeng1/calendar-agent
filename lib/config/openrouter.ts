export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  fallbackModels: string[];
  baseUrl: string;
  timeoutMs: number;
  maxTokens: number;
  defaultTimezone: string;
}

export function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  const model = (process.env.OPENROUTER_MODEL ?? "openrouter/free").trim();
  const fallbackModels = (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, all) => value && value !== model && all.indexOf(value) === index);

  const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const defaultTimezone = (process.env.DEFAULT_TIMEZONE ?? fallbackTz).trim();

  return {
    apiKey,
    model: model || "openrouter/free",
    fallbackModels,
    baseUrl: (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    timeoutMs: clampNumber(process.env.OPENROUTER_TIMEOUT_MS, 30000, 5000, 90000),
    maxTokens: clampNumber(process.env.OPENROUTER_MAX_TOKENS, 4000, 1000, 8000),
    defaultTimezone: defaultTimezone || fallbackTz,
  };
}

export function describeOpenRouterConfig(config = getOpenRouterConfig()) {
  return {
    apiKeyConfigured: Boolean(config.apiKey),
    model: config.model,
    fallbackModels: config.fallbackModels,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    defaultTimezone: config.defaultTimezone,
  };
}

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}