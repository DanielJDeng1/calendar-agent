export const plannerKinds = ["mutate", "query", "reply", "clarify", "approve", "preference"] as const;
export const operationKinds = ["create_event", "create_series", "create_day_plan", "move_event", "update_event", "delete_event", "reorganize_day"] as const;

export type PlannerKind = typeof plannerKinds[number];
export type PlannerOperationKind = typeof operationKinds[number];
export type PlannerCategory = "work" | "personal" | "school" | "meeting";

export interface PlannerWireItem {
  title: string;
  duration: number;
  location: string | null;
  description: string | null;
  category: PlannerCategory | null;
  preferredStart: string | null;
}

export interface PlannerWireOperation {
  type: PlannerOperationKind;
  ref: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  category: PlannerCategory | null;
  date: string | null;
  start: string | null;
  end: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  duration: number | null;
  count: number | null;
  repeat: "daily" | "weekdays" | null;
  relative: "earlier" | "later" | null;
  strategy: "compact" | "make_room" | "spread_out" | null;
  items: PlannerWireItem[];
}

export interface PlannerWire {
  kind: PlannerKind;
  summary: string;
  message: string;
  policy: "preserve" | "move_flexible" | "move_owned" | "replace_owned";
  queryStart: string | null;
  queryEnd: string | null;
  preferenceType: "none" | "not_before" | "not_after" | "prefer_daypart" | "buffer_minutes" | "freeform";
  preferenceScope: "work" | "personal" | "school" | "meeting" | "any" | null;
  preferenceValue: string;
  operations: PlannerWireOperation[];
}

type Issue = { path: Array<string | number>; message: string };
type SafeParseResult<T> = { success: true; data: T } | { success: false; error: { issues: Issue[] } };

export const plannerWireSchema = {
  parse(value: unknown): PlannerWire {
    const result = validatePlannerWire(value);
    if (!result.success) {
      const message = result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join(" | ");
      throw new Error(message);
    }
    return result.data;
  },
  safeParse(value: unknown): SafeParseResult<PlannerWire> {
    return validatePlannerWire(value);
  },
};

function validatePlannerWire(value: unknown): SafeParseResult<PlannerWire> {
  const issues: Issue[] = [];
  if (!isRecord(value)) return fail([{ path: [], message: "Expected object" }]);

  exactKeys(value, ["kind", "summary", "message", "policy", "queryStart", "queryEnd", "preferenceType", "preferenceScope", "preferenceValue", "operations"], [], issues);
  enumValue(value.kind, plannerKinds, ["kind"], issues);
  stringValue(value.summary, ["summary"], issues, { min: 1, max: 240 });
  stringValue(value.message, ["message"], issues, { max: 1200 });
  enumValue(value.policy, ["preserve", "move_flexible", "move_owned", "replace_owned"] as const, ["policy"], issues);
  nullableDate(value.queryStart, ["queryStart"], issues);
  nullableDate(value.queryEnd, ["queryEnd"], issues);
  enumValue(value.preferenceType, ["none", "not_before", "not_after", "prefer_daypart", "buffer_minutes", "freeform"] as const, ["preferenceType"], issues);
  nullableEnum(value.preferenceScope, ["work", "personal", "school", "meeting", "any"] as const, ["preferenceScope"], issues);
  stringValue(value.preferenceValue, ["preferenceValue"], issues, { max: 500 });

  if (!Array.isArray(value.operations)) issues.push({ path: ["operations"], message: "Expected array" });
  else {
    if (value.operations.length > 8) issues.push({ path: ["operations"], message: "Maximum 8 operations" });
    value.operations.forEach((operation, index) => validateOperation(operation, ["operations", index], issues));
  }

  return issues.length ? fail(issues) : { success: true, data: value as unknown as PlannerWire };
}

function validateOperation(value: unknown, path: Array<string | number>, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected object" });
    return;
  }
  const keys = ["type", "ref", "title", "description", "location", "category", "date", "start", "end", "windowStart", "windowEnd", "duration", "count", "repeat", "relative", "strategy", "items"];
  exactKeys(value, keys, path, issues);
  enumValue(value.type, operationKinds, [...path, "type"], issues);
  nullableString(value.ref, [...path, "ref"], issues);
  nullableString(value.title, [...path, "title"], issues);
  nullableString(value.description, [...path, "description"], issues);
  nullableString(value.location, [...path, "location"], issues);
  nullableEnum(value.category, ["work", "personal", "school", "meeting"] as const, [...path, "category"], issues);
  nullableDate(value.date, [...path, "date"], issues);
  nullableClock(value.start, [...path, "start"], issues);
  nullableClock(value.end, [...path, "end"], issues);
  nullableClock(value.windowStart, [...path, "windowStart"], issues);
  nullableClock(value.windowEnd, [...path, "windowEnd"], issues);
  nullableInteger(value.duration, 1, 720, [...path, "duration"], issues);
  nullableInteger(value.count, 1, 31, [...path, "count"], issues);
  nullableEnum(value.repeat, ["daily", "weekdays"] as const, [...path, "repeat"], issues);
  nullableEnum(value.relative, ["earlier", "later"] as const, [...path, "relative"], issues);
  nullableEnum(value.strategy, ["compact", "make_room", "spread_out"] as const, [...path, "strategy"], issues);
  if (!Array.isArray(value.items)) issues.push({ path: [...path, "items"], message: "Expected array" });
  else {
    if (value.items.length > 16) issues.push({ path: [...path, "items"], message: "Maximum 16 items" });
    value.items.forEach((item, index) => validateItem(item, [...path, "items", index], issues));
  }
}

function validateItem(value: unknown, path: Array<string | number>, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected object" });
    return;
  }
  exactKeys(value, ["title", "duration", "location", "description", "category", "preferredStart"], path, issues);
  stringValue(value.title, [...path, "title"], issues, { min: 1, max: 180 });
  integerValue(value.duration, 15, 360, [...path, "duration"], issues);
  nullableString(value.location, [...path, "location"], issues);
  nullableString(value.description, [...path, "description"], issues);
  nullableEnum(value.category, ["work", "personal", "school", "meeting"] as const, [...path, "category"], issues);
  nullableClock(value.preferredStart, [...path, "preferredStart"], issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: Array<string | number>, issues: Issue[]): void {
  const actual = Object.keys(value);
  for (const key of expected) if (!(key in value)) issues.push({ path: [...path, key], message: "Required" });
  for (const key of actual) if (!expected.includes(key)) issues.push({ path: [...path, key], message: "Unexpected property" });
}

function stringValue(value: unknown, path: Array<string | number>, issues: Issue[], limits: { min?: number; max?: number } = {}): void {
  if (typeof value !== "string") return void issues.push({ path, message: "Expected string" });
  if (limits.min !== undefined && value.length < limits.min) issues.push({ path, message: `Minimum length ${limits.min}` });
  if (limits.max !== undefined && value.length > limits.max) issues.push({ path, message: `Maximum length ${limits.max}` });
}

function nullableString(value: unknown, path: Array<string | number>, issues: Issue[]): void {
  if (value !== null && typeof value !== "string") issues.push({ path, message: "Expected string or null" });
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, path: Array<string | number>, issues: Issue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) issues.push({ path, message: `Expected one of: ${allowed.join(", ")}` });
}

function nullableEnum<T extends readonly string[]>(value: unknown, allowed: T, path: Array<string | number>, issues: Issue[]): void {
  if (value !== null) enumValue(value, allowed, path, issues);
}

function nullableDate(value: unknown, path: Array<string | number>, issues: Issue[]): void {
  if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) issues.push({ path, message: "Expected YYYY-MM-DD or null" });
}

function nullableClock(value: unknown, path: Array<string | number>, issues: Issue[]): void {
  if (value !== null && (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) issues.push({ path, message: "Expected HH:mm or null" });
}

function integerValue(value: unknown, min: number, max: number, path: Array<string | number>, issues: Issue[]): void {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) issues.push({ path, message: `Expected integer ${min}-${max}` });
}

function nullableInteger(value: unknown, min: number, max: number, path: Array<string | number>, issues: Issue[]): void {
  if (value !== null) integerValue(value, min, max, path, issues);
}

function fail(issues: Issue[]): SafeParseResult<never> {
  return { success: false, error: { issues } };
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const nullableStringSchema = (description: string) => nullable({ type: "string", description });
const dateField = (description: string) => nullable({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description });
const clockField = (description: string) => nullable({ type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", description });
const enumField = (values: readonly string[], description: string, allowNull = false) => allowNull
  ? nullable({ type: "string", enum: [...values], description })
  : { type: "string", enum: [...values], description };

const itemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 180, description: "Activity title." },
    duration: { type: "integer", minimum: 15, maximum: 360, description: "Duration in minutes." },
    location: nullableStringSchema("Location or venue."),
    description: nullableStringSchema("Additional details."),
    category: enumField(["work", "personal", "school", "meeting"], "Category.", true),
    preferredStart: clockField("Target start time."),
  },
  required: ["title", "duration", "location", "description", "category", "preferredStart"],
} as const;

const operationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: enumField(operationKinds, "Operation type."),
    ref: nullableStringSchema("Target event ID or search string."),
    title: nullableStringSchema("Event or plan title."),
    description: nullableStringSchema("Event description."),
    location: nullableStringSchema("Event location."),
    category: enumField(["work", "personal", "school", "meeting"], "Event category.", true),
    date: dateField("Target date."),
    start: clockField("Start time."),
    end: clockField("End time."),
    windowStart: clockField("Earliest bound."),
    windowEnd: clockField("Latest bound."),
    duration: nullable({ type: "integer", minimum: 1, maximum: 720, description: "Duration in minutes." }),
    count: nullable({ type: "integer", minimum: 1, maximum: 31, description: "Recurrence count for create_series." }),
    repeat: enumField(["daily", "weekdays"], "Recurrence frequency.", true),
    relative: enumField(["earlier", "later"], "Shift direction."),
    strategy: enumField(["compact", "make_room", "spread_out"], "Layout strategy."),
    items: { type: "array", maxItems: 16, items: itemJsonSchema, description: "Sub-tasks for create_day_plan." },
  },
  required: ["type", "ref", "title", "description", "location", "category", "date", "start", "end", "windowStart", "windowEnd", "duration", "count", "repeat", "relative", "strategy", "items"],
} as const;

export const plannerResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "calendar_intent_v3",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: enumField(plannerKinds, "Turn intent."),
        summary: { type: "string", minLength: 1, maxLength: 240, description: "Brief change summary." },
        message: { type: "string", maxLength: 1200, description: "Response text for reply/clarify intents." },
        policy: enumField(["preserve", "move_flexible", "move_owned", "replace_owned"], "Conflict resolution policy."),
        queryStart: dateField("Query window start."),
        queryEnd: dateField("Query window end."),
        preferenceType: enumField(["none", "not_before", "not_after", "prefer_daypart", "buffer_minutes", "freeform"], "Preference rule type."),
        preferenceScope: enumField(["work", "personal", "school", "meeting", "any"], "Preference category scope.", true),
        preferenceValue: { type: "string", maxLength: 500, description: "Value payload for preference intent." },
        operations: { type: "array", maxItems: 8, items: operationJsonSchema },
      },
      required: ["kind", "summary", "message", "policy", "queryStart", "queryEnd", "preferenceType", "preferenceScope", "preferenceValue", "operations"],
    },
  },
} as const;