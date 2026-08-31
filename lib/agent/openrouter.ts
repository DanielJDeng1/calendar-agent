export type PlannerErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER"
  | "NO_CONTENT"
  | "OUTPUT_LIMIT"
  | "BAD_RESPONSE";

export class PlannerError extends Error {
  constructor(
    public readonly code: PlannerErrorCode,
    message: string,
    public readonly detail?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

export type OpenRouterMessage = { role: "system" | "user" | "assistant"; content: string };

export interface OpenRouterMeta {
  requestedModel: string;
  routedModel: string;
  routedProvider: string;
  requestId: string;
  finishReason: string;
  latencyMs: number;
  attempts: number;
  routingSummary: string;
}

export interface StructuredOpenRouterResult {
  payload: Record<string, any>;
  content: string;
  meta: OpenRouterMeta;
}

export async function requestStructuredOpenRouter(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModels: string[];
  timeoutMs: number;
  maxTokens: number;
  messages: OpenRouterMessage[];
  responseFormat: unknown;
  traceId?: string;
  requestLabel?: string;
}): Promise<StructuredOpenRouterResult> {
  const maxAttempts = 2;
  const traceId = input.traceId ?? crypto.randomUUID();
  const requestLabel = input.requestLabel ?? "planner";
  const modelFields = input.fallbackModels.length
    ? { models: [input.model, ...input.fallbackModels] }
    : { model: input.model };

  let lastError: PlannerError | undefined;
  let relaxParameterRequirement = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const started = Date.now();
    let phase: "request" | "response_body" | "decode" = "request";
    let response: Response | undefined;
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      debug(traceId, "transport.request", {
        requestLabel,
        attempt,
        maxAttempts,
        model: input.model,
        fallbackModels: input.fallbackModels,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
        messageChars: input.messages.reduce((sum, message) => sum + message.content.length, 0),
      });

      response = await fetch(`${input.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
          "X-Title": process.env.OPENROUTER_APP_NAME ?? "Calendar Agent",
          "X-OpenRouter-Metadata": "enabled",
        },
        body: JSON.stringify({
          ...modelFields,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: 0,
          response_format: input.responseFormat,
          provider: { allow_fallbacks: true, require_parameters: !relaxParameterRequirement, sort: "latency" },
        }),
        signal: controller.signal,
      });

      phase = "response_body";
      const rawText = await response.text();
      phase = "decode";
      const payload = parseJsonRecord(rawText);
      const meta = buildMeta(input.model, payload, response, Date.now() - started, attempt);
      const embeddedError = readError(payload);

      if (!response.ok || embeddedError) {
        const failure = classifyError(response.status, payload, embeddedError, rawText);
        lastError = failure;
        logAttempt(input.model, attempt, maxAttempts, meta.latencyMs, failure, meta, traceId, requestLabel);

        if (attempt < maxAttempts && isParameterRoutingFailure(failure)) {
          relaxParameterRequirement = true;
          debug(traceId, "transport.relax_parameter_requirement", { requestLabel, attempt, detail: failure.detail ?? failure.message });
          await delay(200);
          continue;
        }

        if (attempt < maxAttempts && shouldRetry(failure, response.headers.get("retry-after"))) {
          await delay(retryDelayMs(response.headers.get("retry-after"), attempt));
          continue;
        }
        throw failure;
      }

      if (!payload) {
        const failure = new PlannerError(
          "PROVIDER",
          "OpenRouter returned a non-JSON response.",
          `HTTP ${response.status}; body=${rawText.slice(0, 500) || "<empty>"}`,
          response.status,
        );
        lastError = failure;
        logAttempt(input.model, attempt, maxAttempts, meta.latencyMs, failure, meta, traceId, requestLabel);

        if (attempt < maxAttempts && response.status >= 500) {
          await delay(500);
          continue;
        }
        throw failure;
      }

      const message = payload?.choices?.[0]?.message;
      const content = (extractContent(message?.content) || extractContent(message?.parsed) || extractToolArguments(message?.tool_calls)).trim();

      if (!content) {
        const outputLimited = /^(length|max_tokens)$/i.test(meta.finishReason);
        const failure = new PlannerError(
          outputLimited ? "OUTPUT_LIMIT" : "NO_CONTENT",
          outputLimited ? "Output budget exhausted before completion." : "No planner content returned.",
          transportDetail(meta, payload),
          response.status,
        );
        lastError = failure;
        logAttempt(input.model, attempt, maxAttempts, meta.latencyMs, failure, meta, traceId, requestLabel);
        throw failure;
      }

      debug(traceId, "transport.success", {
        requestLabel,
        attempt,
        routedModel: meta.routedModel,
        provider: meta.routedProvider,
        requestId: meta.requestId,
        finishReason: meta.finishReason,
        latencyMs: meta.latencyMs,
        contentChars: content.length,
        routing: meta.routingSummary,
      });

      return { payload, content, meta };
    } catch (error) {
      if (error instanceof PlannerError) {
        lastError = error;
        if (attempt < maxAttempts && shouldRetry(error, response?.headers.get("retry-after") ?? null)) {
          await delay(retryDelayMs(response?.headers.get("retry-after") ?? null, attempt));
          continue;
        }
        throw error;
      }

      const elapsed = Date.now() - started;
      const failure = isAbortError(error)
        ? new PlannerError(
            "TIMEOUT",
            `OpenRouter request timed out after ${Math.round(input.timeoutMs / 1000)}s.`,
            `phase=${phase}; attempt=${attempt}/${maxAttempts}; elapsedMs=${elapsed}`,
          )
        : new PlannerError(
            "NETWORK",
            "Could not complete the request to OpenRouter.",
            `phase=${phase}; attempt=${attempt}/${maxAttempts}; ${error instanceof Error ? error.message : String(error)}`,
          );

      lastError = failure;
      logAttempt(input.model, attempt, maxAttempts, elapsed, failure, undefined, traceId, requestLabel);

      if (attempt < maxAttempts && shouldRetry(failure, response?.headers.get("retry-after") ?? null)) {
        await delay(retryDelayMs(response?.headers.get("retry-after") ?? null, attempt));
        continue;
      }
      throw failure;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new PlannerError("PROVIDER", "OpenRouter failed to provide a valid response.");
}

function buildMeta(
  requestedModel: string,
  payload: Record<string, any> | undefined,
  response: Response,
  latencyMs: number,
  attempt: number,
): OpenRouterMeta {
  const choice = payload?.choices?.[0];
  const routing = payload?.openrouter_metadata;
  const selected = Array.isArray(routing?.endpoints?.available)
    ? routing.endpoints.available.find((entry: any) => entry?.selected === true)
    : undefined;

  return {
    requestedModel,
    routedModel: text(payload?.model) || text(selected?.model) || "unknown",
    routedProvider: text(payload?.provider) || text(selected?.provider) || "unknown",
    requestId: text(payload?.id) || response.headers.get("x-generation-id") || response.headers.get("x-request-id") || "unknown",
    finishReason: text(choice?.finish_reason) || (choice?.error ? "error" : "unknown"),
    latencyMs,
    attempts: attempt,
    routingSummary: summarizeRouting(routing),
  };
}

function readError(payload: Record<string, any> | undefined): any | undefined {
  if (!payload) return undefined;
  if (payload.error && typeof payload.error === "object") return payload.error;
  return payload?.choices?.find?.((choice: any) => choice?.error)?.error;
}

function classifyError(status: number, payload: Record<string, any> | undefined, error: any, rawText: string): PlannerError {
  const code = Number(error?.code ?? (status >= 400 ? status : 0));
  const errorType = text(error?.metadata?.error_type) || text(payload?.error_type);
  const message = text(error?.message) || text(payload?.message) || rawText.slice(0, 800) || `HTTP ${status}`;
  const providerCode = text(error?.metadata?.provider_code);
  const detail = [errorType && `error_type=${errorType}`, providerCode && `provider_code=${providerCode}`, message].filter(Boolean).join("; ").slice(0, 1500);
  const effectiveStatus = code || status;

  if (effectiveStatus === 401 || errorType === "authentication") {
    return new PlannerError("AUTH", "OpenRouter rejected the API credentials.", detail, effectiveStatus);
  }
  if (effectiveStatus === 429 || errorType === "rate_limit_exceeded") {
    return new PlannerError("RATE_LIMIT", "OpenRouter rate-limited the request.", detail, effectiveStatus);
  }
  if (effectiveStatus === 408 || effectiveStatus === 504 || errorType === "timeout") {
    return new PlannerError("TIMEOUT", "The routed planner timed out.", detail, effectiveStatus);
  }
  return new PlannerError("PROVIDER", "OpenRouter request failed.", detail, effectiveStatus);
}

function isParameterRoutingFailure(error: PlannerError): boolean {
  return error.code === "PROVIDER" && /no endpoints found.*requested parameters|cannot handle the requested parameters/i.test(error.detail ?? error.message);
}

function shouldRetry(error: PlannerError, retryAfter: string | null): boolean {
  if (error.code === "NETWORK" || error.code === "TIMEOUT") return true;
  if (error.code === "NO_CONTENT" || error.code === "OUTPUT_LIMIT") return false;
  if (error.code === "RATE_LIMIT") {
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) && seconds >= 0 && seconds <= 3;
  }
  if (error.code !== "PROVIDER") return false;
  return /error_type=(provider_unavailable|provider_overloaded|server|unmapped)/i.test(error.detail ?? "")
    || Boolean(error.status && [500, 502, 503, 504, 529].includes(error.status));
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 3) return Math.max(250, Math.round(seconds * 1000));
  return 350 + attempt * 250;
}

function transportDetail(meta: OpenRouterMeta, payload: Record<string, any>): string {
  const usage = payload?.usage && typeof payload.usage === "object"
    ? `; usagePrompt=${payload.usage.prompt_tokens ?? "?"}; usageCompletion=${payload.usage.completion_tokens ?? "?"}`
    : "";
  return `routedModel=${meta.routedModel}; provider=${meta.routedProvider}; finish=${meta.finishReason}; requestId=${meta.requestId}; attempts=${meta.attempts}${meta.routingSummary ? `; routing=${meta.routingSummary}` : ""}${usage}`.slice(0, 1800);
}

function summarizeRouting(value: any): string {
  if (!value || typeof value !== "object") return "";
  const parts: string[] = [];
  if (typeof value.strategy === "string") parts.push(`strategy=${value.strategy}`);
  if (typeof value.summary === "string") parts.push(value.summary);
  if (typeof value.attempt === "number") parts.push(`routerAttempt=${value.attempt}`);
  if (Array.isArray(value.attempts)) {
    const attempts = value.attempts.slice(0, 6).map((entry: any) => `${text(entry?.provider) || "?"}/${text(entry?.model) || "?"}:${entry?.status ?? "?"}`);
    if (attempts.length) parts.push(`endpoints=[${attempts.join(", ")}]`);
  }
  return parts.join("; ").slice(0, 1400);
}

function logAttempt(
  requestedModel: string,
  attempt: number,
  maxAttempts: number,
  latencyMs: number,
  error: PlannerError,
  meta?: OpenRouterMeta,
  traceId = "unknown",
  requestLabel = "planner",
): void {
  if (process.env.NODE_ENV === "production" && !debugEnabled()) return;
  console.warn(`[CalendarAgentDebug] ${JSON.stringify({
    traceId,
    stage: "transport.failure",
    at: new Date().toISOString(),
    requestLabel,
    attempt,
    maxAttempts,
    requestedModel,
    routedModel: meta?.routedModel ?? "unknown",
    provider: meta?.routedProvider ?? "unknown",
    requestId: meta?.requestId ?? "unknown",
    finishReason: meta?.finishReason ?? "unknown",
    latencyMs,
    error: error.code,
    detail: (error.detail ?? error.message).slice(0, 1400),
    routing: meta?.routingSummary ?? "",
  })}`);
}

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    try { return JSON.stringify(content); } catch { return ""; }
  }
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && "text" in part) {
      return typeof (part as { text?: unknown }).text === "string" ? String((part as { text?: unknown }).text) : "";
    }
    return "";
  }).join("");
}

function extractToolArguments(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls)) return "";
  for (const call of toolCalls) {
    const args = call && typeof call === "object" ? (call as any)?.function?.arguments : undefined;
    if (typeof args === "string" && args.trim()) return args;
    if (args && typeof args === "object") {
      try { return JSON.stringify(args); } catch { /* continue */ }
    }
  }
  return "";
}

function parseJsonRecord(value: string): Record<string, any> | undefined {
  if (!value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
}

function debugEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PLANNER_DEBUG ?? "");
}

function debug(traceId: string, stage: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production" && !debugEnabled()) return;
  console.info(`[CalendarAgentDebug] ${JSON.stringify({ traceId, stage, at: new Date().toISOString(), ...data })}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}