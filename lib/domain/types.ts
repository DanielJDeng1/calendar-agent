export type EventCategory = "work" | "personal" | "school" | "meeting";

export interface CalendarEvent {
  id: string;
  provider: "local" | "google" | "microsoft";
  providerEventId: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timezone: string;
  allDay: boolean;
  availability: "free" | "tentative" | "busy" | "out_of_office";
  attendees: Array<{ email: string; displayName?: string }>;
  permissions: { canRead: boolean; canUpdate: boolean; canDelete: boolean };
  updatedAt: string;
  category: EventCategory;
  flexible?: boolean;
  agentMetadata?: {
    source: "calendar_agent";
    planId?: string;
    planTitle?: string;
    planGoal?: string;
    planItemIndex?: number;
  };
}

export type PreferenceScope = EventCategory | "any";
export type PreferenceRule =
  | { type: "NOT_BEFORE"; time: string; scope?: PreferenceScope }
  | { type: "NOT_AFTER"; time: string; scope?: PreferenceScope }
  | { type: "PREFER_DAYPART"; daypart: "morning" | "afternoon" | "evening"; scope?: PreferenceScope }
  | { type: "BUFFER_MINUTES"; minutes: number }
  | { type: "FREEFORM"; text: string };

export interface Preference {
  id: string;
  category: string;
  rule: PreferenceRule;
  priority: number;
  confidence: number;
  source: "explicit" | "inferred" | "behavioral";
  createdAt: string;
}

export type CalendarOperation =
  | { type: "CREATE_EVENT"; event: Omit<CalendarEvent, "id" | "providerEventId" | "updatedAt"> & { id?: string } }
  | { type: "MOVE_EVENT"; eventId: string; newStart: string; newEnd: string }
  | { type: "UPDATE_EVENT"; eventId: string; patch: Partial<CalendarEvent> }
  | { type: "DELETE_EVENT"; eventId: string };

export interface CalendarCommand {
  commandId: string;
  idempotencyKey: string;
  expectedSnapshotVersion: string;
  operation: CalendarOperation;
  createdAt: string;
}

export interface CalendarDiff {
  additions: CalendarEvent[];
  removals: CalendarEvent[];
  modifications: Array<{ before: CalendarEvent; after: CalendarEvent }>;
}

export interface DraftState {
  draftId: string;
  baseSnapshotVersion: string;
  version: number;
  diff: CalendarDiff;
  commands: CalendarCommand[];
  createdAt: string;
  summary: string;
}

export type Daypart = "morning" | "afternoon" | "evening";
export type ConflictPolicy = "preserve" | "move_flexible" | "move_owned" | "replace_owned";

export type SemanticOperation = {
  type: "create_event" | "create_series" | "create_day_plan" | "move_event" | "update_event" | "delete_event" | "reorganize_day";
  targetEventId?: string;
  targetEventTitle?: string;
  title?: string;
  description?: string;
  location?: string;
  category?: EventCategory;
  flexible?: boolean;
  targetDate?: string;
  dateRange?: { start: string; end: string };
  exactStart?: string;
  exactEnd?: string;
  windowStart?: string;
  windowEnd?: string;
  preferredStart?: string;
  durationMinutes?: number;
  daypart?: Daypart;
  recurrence?: "daily" | "weekdays";
  count?: number;
  planItems?: Array<{
    title: string;
    durationMinutes: number;
    location?: string;
    description?: string;
    category?: EventCategory;
    preferredStart?: string;
  }>;
  relativeTime?: "earlier" | "later";
  strategy?: "compact" | "make_room" | "spread_out";
};

export type AgentDecision =
  | {
      kind: "calendar_mutation";
      intentSummary: string;
      operations: SemanticOperation[];
      conflictPolicy: ConflictPolicy;
      coordinated?: {
        title: string;
        goal: string;
        targetDate?: string;
        windowStart?: string;
        windowEnd?: string;
      };
    }
  | {
      kind: "calendar_query";
      intentSummary: string;
      query: { targetDate?: string; dateRange?: { start: string; end: string } };
    }
  | {
      kind: "preference_update";
      intentSummary: string;
      preference: { category: string; rule: PreferenceRule; explicit: boolean; naturalLanguage: string };
    }
  | { kind: "conversation"; intentSummary: string; message: string }
  | { kind: "clarification"; intentSummary: string; message: string }
  | { kind: "approval"; intentSummary: string };

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentRequestPayload {
  message: string;
  events: CalendarEvent[];
  preferences: Preference[];
  snapshotVersion: string;
  now?: string;
  conversation?: ConversationTurn[];
  activeDraft?: DraftState;
}

export interface AgentResponsePayload {
  message: string;
  draft?: DraftState;
  updatedPreferences?: Preference[];
  preferenceSuggestion?: { text: string; suggestedMessage: string };
  clearDraft?: boolean;
  status?: string[];
  autoApplyDraft?: boolean;
}