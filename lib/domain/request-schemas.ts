import { z } from "zod";

const category = z.enum(["work", "personal", "school", "meeting"]);
const scope = z.enum(["work", "personal", "school", "meeting", "any"]);

export const calendarEventSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["local", "google", "microsoft"]),
  providerEventId: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  timezone: z.string().min(1),
  allDay: z.boolean(),
  availability: z.enum(["free", "tentative", "busy", "out_of_office"]),
  attendees: z.array(z.object({ email: z.string(), displayName: z.string().optional() })),
  permissions: z.object({ canRead: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean() }),
  updatedAt: z.string(),
  category,
  flexible: z.boolean().optional(),
  agentMetadata: z.object({
    source: z.literal("calendar_agent"),
    planId: z.string().optional(),
    planTitle: z.string().optional(),
    planGoal: z.string().optional(),
    planItemIndex: z.number().int().optional(),
  }).optional(),
});

const preferenceRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NOT_BEFORE"), time: z.string(), scope: scope.optional() }),
  z.object({ type: z.literal("NOT_AFTER"), time: z.string(), scope: scope.optional() }),
  z.object({ type: z.literal("PREFER_DAYPART"), daypart: z.enum(["morning", "afternoon", "evening"]), scope: scope.optional() }),
  z.object({ type: z.literal("BUFFER_MINUTES"), minutes: z.number().finite() }),
  z.object({ type: z.literal("FREEFORM"), text: z.string() }),
]);

export const preferenceSchema = z.object({
  id: z.string().min(1),
  category: z.string(),
  rule: preferenceRuleSchema,
  priority: z.number().finite(),
  confidence: z.number().finite(),
  source: z.enum(["explicit", "inferred", "behavioral"]),
  createdAt: z.string(),
});

const createEventSchema = calendarEventSchema.omit({
  id: true,
  providerEventId: true,
  updatedAt: true,
}).extend({ id: z.string().min(1).optional() });

const calendarOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_EVENT"), event: createEventSchema }),
  z.object({ type: z.literal("MOVE_EVENT"), eventId: z.string().min(1), newStart: z.string().min(1), newEnd: z.string().min(1) }),
  z.object({ type: z.literal("UPDATE_EVENT"), eventId: z.string().min(1), patch: calendarEventSchema.partial() }),
  z.object({ type: z.literal("DELETE_EVENT"), eventId: z.string().min(1) }),
]);

const calendarCommandSchema = z.object({
  commandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  expectedSnapshotVersion: z.string().min(1),
  operation: calendarOperationSchema,
  createdAt: z.string().min(1),
});

const calendarDiffSchema = z.object({
  additions: z.array(calendarEventSchema),
  removals: z.array(calendarEventSchema),
  modifications: z.array(z.object({ before: calendarEventSchema, after: calendarEventSchema })),
});

export const draftSchema = z.object({
  draftId: z.string().min(1),
  baseSnapshotVersion: z.string().min(1),
  version: z.number().int(),
  diff: calendarDiffSchema,
  commands: z.array(calendarCommandSchema).min(1),
  createdAt: z.string().min(1),
  summary: z.string(),
});

export const agentRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  events: z.array(calendarEventSchema),
  preferences: z.array(preferenceSchema),
  snapshotVersion: z.string().min(1),
  now: z.string().optional(),
  conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(60).optional(),
  activeDraft: draftSchema.optional(),
});

export const applyRequestSchema = z.object({
  events: z.array(calendarEventSchema),
  preferences: z.array(preferenceSchema),
  snapshotVersion: z.string().min(1),
  draft: draftSchema,
});
