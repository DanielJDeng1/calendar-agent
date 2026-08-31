import {
  AgentDecision,
  CalendarEvent,
  ConversationTurn,
  DraftState,
  EventCategory,
  Preference,
  PreferenceRule,
  SemanticOperation,
} from "../domain/types";
import { addDays, prettyDate } from "../calendar/date";
import { getOpenRouterConfig } from "../config/openrouter";
import { PlannerError, requestStructuredOpenRouter, type OpenRouterMessage, type OpenRouterMeta } from "./openrouter";
import { plannerResponseFormat, plannerWireSchema, type PlannerWire, type PlannerWireOperation } from "./planner-contract";

export { PlannerError } from "./openrouter";

export interface PlannerRequestMeta extends OpenRouterMeta {
  schemaValid: boolean;
  semanticAttempts: number;
  traceId: string;
}

export type PlannerInput = {
  message: string;
  events: CalendarEvent[];
  preferences: Preference[];
  nowIso: string;
  conversation: ConversationTurn[];
  activeDraft?: DraftState;
};

export async function planUserRequest(input: PlannerInput): Promise<AgentDecision> {
  return (await planUserRequestWithMeta(input)).decision;
}

export async function planUserRequestWithMeta(input: PlannerInput): Promise<{ decision: AgentDecision; meta: PlannerRequestMeta }> {
  const config = getOpenRouterConfig();
  if (!config.apiKey) throw new PlannerError("NOT_CONFIGURED", "OPENROUTER_API_KEY is not configured.");

  const traceId = crypto.randomUUID();
  const baseMessages = buildMessages(input);
  debug(traceId, "planner.start", {
    model: config.model,
    fallbacks: config.fallbackModels,
    eventCount: input.events.length,
    conversationTurns: input.conversation.length,
    activeDraft: Boolean(input.activeDraft),
    promptChars: baseMessages.reduce((sum, message) => sum + message.content.length, 0),
  });

  let firstFailure = "";
  let firstContent = "";
  let firstMeta: OpenRouterMeta | undefined;

  for (let semanticAttempt = 1; semanticAttempt <= 2; semanticAttempt += 1) {
    const isRescue = semanticAttempt === 2;
    const messages = isRescue ? buildRescueMessages(input, firstFailure, firstContent) : baseMessages;
    const rescueModel = isRescue && config.fallbackModels.length ? config.fallbackModels[0] : config.model;
    const rescueFallbacks = isRescue && config.fallbackModels.length
      ? [config.model, ...config.fallbackModels.slice(1)]
      : config.fallbackModels;

    debug(traceId, isRescue ? "planner.rescue.request" : "planner.primary.request", {
      requestedModel: rescueModel,
      fallbackModels: rescueFallbacks,
      promptChars: messages.reduce((sum, message) => sum + message.content.length, 0),
      previousFailure: isRescue ? firstFailure : undefined,
    });

    let result;
    try {
      result = await requestStructuredOpenRouter({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: rescueModel,
        fallbackModels: rescueFallbacks,
        timeoutMs: config.timeoutMs,
        maxTokens: config.maxTokens,
        messages,
        responseFormat: plannerResponseFormat,
        traceId,
        requestLabel: isRescue ? "rescue" : "primary",
      });
    } catch (error) {
      if (semanticAttempt === 1 && error instanceof PlannerError && canSemanticRescueTransport(error)) {
        firstFailure = `${error.code}: ${error.detail ?? error.message}`;
        firstContent = "";
        debug(traceId, "planner.primary.transport_failed_rescuable", { code: error.code, detail: firstFailure });
        continue;
      }
      debug(traceId, "planner.transport_failed", {
        semanticAttempt,
        code: error instanceof PlannerError ? error.code : "UNKNOWN",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (!firstMeta) firstMeta = result.meta;
    const parsed = parsePlannerWireContent(result.content);
    if (!parsed.ok) {
      const failure = parsed.error;
      debug(traceId, "planner.schema_failed", {
        semanticAttempt,
        routedModel: result.meta.routedModel,
        provider: result.meta.routedProvider,
        finishReason: result.meta.finishReason,
        failure,
        rawChars: result.content.length,
        rawPreview: debugEnabled() ? result.content.slice(0, 2500) : undefined,
      });
      if (semanticAttempt === 1) {
        firstFailure = failure;
        firstContent = result.content.slice(0, 6000);
        continue;
      }
      throw new PlannerError(
        "BAD_RESPONSE",
        "The planner response failed schema validation.",
        `trace=${traceId}; routedModel=${result.meta.routedModel}; ${failure}`.slice(0, 1600),
      );
    }

    try {
      const decision = plannerWireToDecision(parsed.value, input, config.defaultTimezone);
      const meta: PlannerRequestMeta = {
        ...result.meta,
        schemaValid: true,
        semanticAttempts: semanticAttempt,
        traceId,
      };
      debug(traceId, "planner.success", {
        semanticAttempt,
        routedModel: result.meta.routedModel,
        provider: result.meta.routedProvider,
        latencyMs: result.meta.latencyMs,
        kind: decision.kind,
        operationTypes: decision.kind === "calendar_mutation" ? decision.operations.map((operation) => operation.type) : [],
        summary: decision.intentSummary,
      });
      return { decision, meta };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      debug(traceId, "planner.semantic_failed", {
        semanticAttempt,
        routedModel: result.meta.routedModel,
        failure,
        wire: debugEnabled() ? parsed.value : undefined,
      });
      if (semanticAttempt === 1) {
        firstFailure = failure;
        firstContent = result.content.slice(0, 6000);
        continue;
      }
      throw new PlannerError(
        "BAD_RESPONSE",
        "The planner payload could not be converted into an executable decision.",
        `trace=${traceId}; routedModel=${result.meta.routedModel}; ${failure}`.slice(0, 1600),
      );
    }
  }

  throw new PlannerError("BAD_RESPONSE", "Failed to resolve valid intent after retry attempts.", `trace=${traceId}; ${firstFailure || firstMeta?.routedModel || "unknown"}`);
}

function buildMessages(input: PlannerInput): OpenRouterMessage[] {
  const config = getOpenRouterConfig();
  const timezone = config.defaultTimezone;
  const currentDate = datePartInTimezone(input.nowIso, timezone);
  const dateContext = Array.from({ length: 16 }, (_, index) => {
    const date = addDays(currentDate, index);
    return { date, weekday: prettyDate(date, { weekday: "long" }) };
  });

  const system = `You are the semantic planner for a calendar assistant. Interpret natural language requests.

Return only the enforced structured response.

Rules:
- Infer intent using conversation history, existing events, active preview draft, and user preferences.
- All mutations generate previews. Use kind=approve only if the user explicitly confirms the current draft.
- For move/update/delete, set ref to the event ID if resolved; otherwise use a exact title reference. Never invent IDs.
- Omit start/end times if flexible scheduling is appropriate; do not ask for clarification unnecessarily.
- Date-only moves set date and leave start/end/duration null. Existing times are preserved downstream.
- Time-only moves set start and leave end/duration null unless explicitly changed.
- create_event: Single event. Requires title and date. If start/end are omitted, provide duration.
- create_series: Recurring event with finite end. Requires title, first date, repeat, count, and duration.
- create_day_plan: Structured itinerary/multi-activity plan. Single operation containing target date, overall window, and ordered items.
- Policy rules: policy=replace_owned only with explicit removal authorization. Use move_owned or move_flexible for authorized relocations. Default to policy=preserve.
- Intent mapping: update_event (metadata updates), move_event (rescheduling), delete_event (removal), reorganize_day (flexible slot optimization).
- query: Calendar reads only. Any creation or modification intent must use mutate.
- reply: General conversational turns. Use clarify only for blocking ambiguities.
- preference: Use when the user requests persistent rule storage.
- Format constraints: Dates are YYYY-MM-DD. Times are HH:mm (24h). Null unmapped fields. Do not append explanatory text outside schema.`;

  const payload = {
    timezone,
    now: input.nowIso,
    currentDate,
    upcomingDates: dateContext,
    request: input.message,
    conversation: input.conversation.slice(-6).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 700) })),
    preview: summarizeDraft(input.activeDraft),
    events: selectRelevantEvents(input.events, input.nowIso, timezone),
    preferences: input.preferences.slice(0, 12).map((preference) => ({ category: preference.category, rule: preference.rule })),
  };

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

function buildRescueMessages(input: PlannerInput, failure: string, previous: string): OpenRouterMessage[] {
  const config = getOpenRouterConfig();
  const timezone = config.defaultTimezone;
  const currentDate = datePartInTimezone(input.nowIso, timezone);
  const system = `You are the fallback planner. Fix validation issues and return a valid structured payload matching the schema.

Constraints:
- Calendar modifications must use kind=mutate.
- Multi-activity plans require create_day_plan with populated items.
- Recurrence requires create_series with explicit count.
- Date-only shifts omit time and duration parameters.
- Default to policy=preserve unless replacement is explicitly permitted.
- Enforce strict YYYY-MM-DD date and HH:mm time formatting.`;

  const payload = {
    timezone,
    now: input.nowIso,
    currentDate,
    request: input.message,
    failure: failure.slice(0, 1200),
    previousResponse: previous.slice(0, 2500),
    relevantEvents: selectRelevantEvents(input.events, input.nowIso, timezone).slice(0, 20),
    preview: summarizeDraft(input.activeDraft),
  };
  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

export function parsePlannerWireContent(content: string): { ok: true; value: PlannerWire } | { ok: false; error: string } {
  const candidates = [content.trim(), stripCodeFence(content), extractFirstJsonObject(content)].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  let lastParse = "response was not valid JSON";
  for (const candidate of candidates) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = plannerWireSchema.safeParse(raw);
    if (result.success) return { ok: true, value: result.data };
    lastParse = result.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join(" | ");
  }
  return { ok: false, error: lastParse };
}

export function plannerWireToDecision(
  value: PlannerWire,
  input: Pick<PlannerInput, "message" | "nowIso" | "activeDraft"> & { events?: CalendarEvent[] },
  timezone: string
): AgentDecision {
  const summary = clean(value.summary) || input.message.trim();

  if (value.kind === "reply") {
    const message = clean(value.message);
    if (!message) throw new Error("reply requires non-empty message");
    return { kind: "conversation", intentSummary: summary, message };
  }
  if (value.kind === "clarify") {
    const message = clean(value.message);
    if (!message) throw new Error("clarify requires a focused question");
    return { kind: "clarification", intentSummary: summary, message };
  }
  if (value.kind === "approve") {
    if (!input.activeDraft) throw new Error("approve requires a visible preview");
    return { kind: "approval", intentSummary: summary };
  }
  if (value.kind === "query") {
    const start = value.queryStart ?? datePartInTimezone(input.nowIso, timezone);
    const end = value.queryEnd ?? start;
    if (end < start) throw new Error("query end precedes start");
    return { kind: "calendar_query", intentSummary: summary, query: start === end ? { targetDate: start } : { dateRange: { start, end } } };
  }
  if (value.kind === "preference") {
    return {
      kind: "preference_update",
      intentSummary: summary,
      preference: {
        category: value.preferenceScope ?? "general",
        rule: preferenceRule(value, input.message),
        explicit: true,
        naturalLanguage: input.message.trim(),
      },
    };
  }

  if (!value.operations.length) throw new Error("mutate requires at least one operation");

  const semanticOperations: SemanticOperation[] = [];
  let coordinated: Extract<AgentDecision, { kind: "calendar_mutation" }>["coordinated"] | undefined;

  for (const wire of value.operations) {
    if (wire.type === "create_day_plan") {
      if (!wire.title || !wire.date || !wire.start || !wire.end) throw new Error("create_day_plan requires title, date, start, and end");
      if (wire.items.length < 3) throw new Error("create_day_plan requires at least three specific activities");
      coordinated = {
        title: wire.title.trim(),
        goal: summary,
        targetDate: wire.date,
        windowStart: wire.start,
        windowEnd: wire.end,
      };
      for (const item of wire.items) {
        semanticOperations.push({
          type: "create_event",
          title: item.title.trim(),
          description: clean(item.description) || undefined,
          location: clean(item.location) || undefined,
          category: (item.category as EventCategory | null) ?? "personal",
          flexible: true,
          targetDate: wire.date,
          windowStart: wire.start,
          windowEnd: wire.end,
          preferredStart: item.preferredStart ?? undefined,
          durationMinutes: item.duration,
        });
      }
      continue;
    }
    semanticOperations.push(wireOperationToSemantic(wire, input.events ?? []));
  }

  return {
    kind: "calendar_mutation",
    intentSummary: summary,
    operations: semanticOperations.map((operation) => normalizeSeriesForNow(operation, input.nowIso, timezone)),
    conflictPolicy: value.policy,
    coordinated,
  };
}

function wireOperationToSemantic(operation: PlannerWireOperation, events: CalendarEvent[]): SemanticOperation {
  const ref = clean(operation.ref);
  const existingById = ref ? events.find((event) => event.id === ref) : undefined;
  const targetEventId = existingById?.id;
  const targetEventTitle = ref && !existingById ? ref : undefined;
  const title = clean(operation.title) || undefined;
  const description = clean(operation.description) || undefined;
  const location = clean(operation.location) || undefined;
  const category = (operation.category as EventCategory | null) ?? undefined;
  const date = operation.date ?? undefined;
  const durationMinutes = operation.duration ?? undefined;
  const common = {
    targetEventId,
    targetEventTitle,
    title,
    description,
    location,
    category,
    targetDate: date,
    exactStart: operation.start ?? undefined,
    exactEnd: operation.end ?? undefined,
    windowStart: operation.windowStart ?? undefined,
    windowEnd: operation.windowEnd ?? undefined,
    durationMinutes,
    relativeTime: operation.relative ?? undefined,
  };

  if (operation.type === "create_event") {
    if (!title) throw new Error("create_event requires title");
    if (!date) throw new Error(`create_event '${title}' requires date`);
    if (operation.end && !operation.start) throw new Error(`create_event '${title}' has end without start`);
    if (!operation.start && !durationMinutes) throw new Error(`create_event '${title}' needs duration when time is flexible`);
    if (operation.start && !operation.end && !durationMinutes) throw new Error(`create_event '${title}' needs end or duration`);
    return { type: "create_event", ...common, category: category ?? "personal", flexible: !operation.start };
  }

  if (operation.type === "create_series") {
    if (!title || !date || !operation.repeat || !operation.count) throw new Error("create_series requires title, date, repeat, and count");
    if (!durationMinutes && !(operation.start && operation.end)) throw new Error(`create_series '${title}' requires duration or exact start/end`);
    const end = seriesEnd(date, operation.count, operation.repeat);
    return {
      type: "create_series",
      ...common,
      category: category ?? "personal",
      flexible: !operation.start,
      targetDate: undefined,
      dateRange: { start: date, end },
      recurrence: operation.repeat,
      count: operation.count,
    };
  }

  if (operation.type === "move_event") {
    if (!targetEventId && !targetEventTitle) throw new Error("move_event requires ref");
    if (operation.end && !operation.start) throw new Error("move_event has end without start");
    if (!date && !operation.start && !operation.windowStart && !operation.windowEnd && !operation.relative && !durationMinutes) throw new Error("move_event contains no requested change");
    return { type: "move_event", ...common };
  }

  if (operation.type === "update_event") {
    if (!targetEventId && !targetEventTitle) throw new Error("update_event requires ref");
    if (!title && !description && !location && !category) throw new Error("update_event contains no changed field");
    return { type: "update_event", targetEventId, targetEventTitle, title, description, location, category };
  }

  if (operation.type === "delete_event") {
    if (!targetEventId && !targetEventTitle) throw new Error("delete_event requires ref");
    return { type: "delete_event", targetEventId, targetEventTitle };
  }

  if (operation.type === "reorganize_day") {
    if (!date) throw new Error("reorganize_day requires date");
    return { type: "reorganize_day", targetDate: date, strategy: operation.strategy ?? "compact", windowStart: operation.windowStart ?? undefined, windowEnd: operation.windowEnd ?? undefined };
  }

  throw new Error("create_day_plan must be expanded before semantic conversion");
}

function normalizeSeriesForNow(operation: SemanticOperation, nowIso: string, timezone: string): SemanticOperation {
  if (operation.type !== "create_series" || !operation.dateRange || operation.recurrence !== "daily") return operation;
  const today = datePartInTimezone(nowIso, timezone);
  if (operation.dateRange.start !== today) return operation;
  const count = operation.count ?? dateSpanDays(operation.dateRange.start, operation.dateRange.end);
  const current = clockMinutes(clockFromIso(nowIso, timezone));
  const shouldShift = operation.exactStart
    ? clockMinutes(operation.exactStart) <= current + 5
    : Boolean(operation.durationMinutes && current + 5 + operation.durationMinutes > 21 * 60);
  if (!shouldShift) return operation;
  const start = addDays(operation.dateRange.start, 1);
  return { ...operation, dateRange: { start, end: seriesEnd(start, count, operation.recurrence) } };
}

function preferenceRule(value: PlannerWire, message: string): PreferenceRule {
  const scope = value.preferenceScope ?? undefined;
  const pref = value.preferenceType;
  const raw = value.preferenceValue.trim();
  if (pref === "not_before" || pref === "not_after") {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new Error(`${pref} preference requires HH:mm`);
    return pref === "not_before" ? { type: "NOT_BEFORE", time: raw, scope } : { type: "NOT_AFTER", time: raw, scope };
  }
  if (pref === "prefer_daypart") {
    if (!(raw === "morning" || raw === "afternoon" || raw === "evening")) throw new Error("prefer_daypart requires morning, afternoon, or evening");
    return { type: "PREFER_DAYPART", daypart: raw, scope };
  }
  if (pref === "buffer_minutes") {
    const minutes = Number(raw);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) throw new Error("buffer_minutes requires 0-180");
    return { type: "BUFFER_MINUTES", minutes };
  }
  if (pref === "freeform") return { type: "FREEFORM", text: raw || message.trim() };
  throw new Error("preference kind requires a preferenceType");
}

function selectRelevantEvents(events: CalendarEvent[], nowIso: string, timezone: string) {
  const currentDate = datePartInTimezone(nowIso, timezone);
  const low = addDays(currentDate, -7);
  const high = addDays(currentDate, 45);
  return events
    .filter((event) => {
      const date = datePartInTimezone(event.start, timezone);
      return date >= low && date <= high;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 30)
    .map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      category: event.category,
      location: event.location ?? "",
      flexible: Boolean(event.flexible),
      canUpdate: event.permissions.canUpdate,
      canDelete: event.permissions.canDelete,
    }));
}

function summarizeDraft(draft?: DraftState) {
  if (!draft) return null;
  return {
    summary: draft.summary,
    additions: draft.diff.additions.slice(0, 12).map(eventSummary),
    modifications: draft.diff.modifications.slice(0, 12).map(({ before, after }) => ({ before: eventSummary(before), after: eventSummary(after) })),
    removals: draft.diff.removals.slice(0, 12).map(eventSummary),
  };
}

function eventSummary(event: CalendarEvent) {
  return { id: event.id, title: event.title, start: event.start, end: event.end, location: event.location ?? "", category: event.category };
}

function seriesEnd(start: string, count: number, recurrence: "daily" | "weekdays"): string {
  if (recurrence === "daily") return addDays(start, count - 1);
  let date = start;
  let occurrences = isWeekday(date) ? 1 : 0;
  while (occurrences < count) {
    date = addDays(date, 1);
    if (isWeekday(date)) occurrences += 1;
  }
  return date;
}

function isWeekday(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function dateSpanDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
}

function datePartInTimezone(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function clockFromIso(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return `${parts.find((part) => part.type === "hour")?.value ?? "00"}:${parts.find((part) => part.type === "minute")?.value ?? "00"}`;
}

function clockMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? "";
}

function extractFirstJsonObject(content: string): string {
  const start = content.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return "";
}

function canSemanticRescueTransport(error: PlannerError): boolean {
  return error.code === "NO_CONTENT" || error.code === "OUTPUT_LIMIT" || error.code === "BAD_RESPONSE";
}

function debugEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PLANNER_DEBUG ?? "");
}

function debug(traceId: string, stage: string, data: Record<string, unknown>): void {
  if (!debugEnabled() && process.env.NODE_ENV === "production") return;
  const safe = JSON.stringify({ traceId, stage, at: new Date().toISOString(), ...data });
  console.info(`[CalendarAgentDebug] ${safe}`);
}