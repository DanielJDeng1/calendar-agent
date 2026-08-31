import {
  AgentDecision,
  AgentRequestPayload,
  AgentResponsePayload,
  CalendarEvent,
  PreferenceRule,
} from "../domain/types";
import { buildCommandPlan } from "./command-builder";
import { applyPreferenceUpdate } from "../preferences/resolve";
import { validateCommands } from "../calendar/validate";
import { simulateCommands } from "../calendar/simulate";
import { datePartInTimezone, DEFAULT_TZ, prettyDate } from "../calendar/date";

export function executeAgentDecision(
  decision: AgentDecision,
  input: AgentRequestPayload,
  nowIso = input.now ?? new Date().toISOString(),
): AgentResponsePayload {
  if (decision.kind === "conversation" || decision.kind === "clarification") {
    return {
      message: decision.message,
      status: [decision.kind === "clarification" ? "Waiting for clarification" : "Conversation response"],
    };
  }

  if (decision.kind === "approval") {
    if (!input.activeDraft) {
      return { message: "No pending preview to apply.", status: ["No pending preview"] };
    }
    return {
      message: "Applying preview.",
      draft: input.activeDraft,
      autoApplyDraft: true,
      status: ["Approval received"],
    };
  }

  if (decision.kind === "calendar_query") {
    return { message: renderCalendarQuery(decision.query, input.events, nowIso), status: ["Calendar checked"] };
  }

  if (decision.kind === "preference_update") {
    if (!decision.preference.explicit) {
      return {
        message: "Using for this request only. Specify to save as a rule.",
        status: ["Preference not persisted"],
      };
    }
    const updatedPreferences = applyPreferenceUpdate(input.preferences, {
      category: decision.preference.category,
      rule: decision.preference.rule,
      explicit: true,
    });
    return {
      message: describePreference(decision.preference.rule),
      updatedPreferences,
      status: ["Preference updated"],
    };
  }

  const plan = buildCommandPlan({
    decision,
    events: input.events,
    preferences: input.preferences,
    snapshotVersion: input.snapshotVersion,
    nowIso,
  });

  if (!plan.commands.length) {
    return {
      message: plan.note ?? "Could not generate a preview.",
      status: ["No executable proposal"],
    };
  }

  const validation = validateCommands(plan.commands, input.events, input.preferences);
  if (!validation.ok) {
    return {
      message: humanizeValidationFailure(validation.errors),
      status: ["Validation failed"],
    };
  }

  const summary = plan.summary ?? `${plan.commands.length} proposed ${plan.commands.length === 1 ? "change" : "changes"}`;
  const draft = simulateCommands(plan.commands, input.events, input.snapshotVersion, summary);
  return {
    message: `${summary}.${plan.note ? ` ${plan.note}` : ""}`,
    draft,
    clearDraft: false,
    status: ["Preview ready"],
  };
}

function renderCalendarQuery(
  query: { targetDate?: string; dateRange?: { start: string; end: string } },
  events: CalendarEvent[],
  nowIso: string,
): string {
  const fallback = datePartInTimezone(nowIso);
  const range = query.dateRange ?? { start: query.targetDate ?? fallback, end: query.targetDate ?? fallback };
  const matching = events
    .filter((event) => {
      const date = datePartInTimezone(event.start);
      return date >= range.start && date <= range.end;
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  if (!matching.length) {
    return range.start === range.end
      ? `Nothing scheduled on ${prettyDate(range.start)}.`
      : `Nothing scheduled from ${prettyDate(range.start)} to ${prettyDate(range.end)}.`;
  }

  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of matching) {
    const date = datePartInTimezone(event.start);
    grouped.set(date, [...(grouped.get(date) ?? []), event]);
  }
  return [...grouped.entries()]
    .map(([date, dayEvents]) => `${prettyDate(date)}\n${dayEvents.map((event) => `• ${formatTime(event.start)}–${formatTime(event.end)} · ${event.title}`).join("\n")}`)
    .join("\n\n");
}

function describePreference(rule: PreferenceRule): string {
  if (rule.type === "NOT_BEFORE") return `Saved: Do not schedule${scopeText(rule.scope)} before ${formatClock(rule.time)}.`;
  if (rule.type === "NOT_AFTER") return `Saved: Do not schedule${scopeText(rule.scope)} after ${formatClock(rule.time)}.`;
  if (rule.type === "PREFER_DAYPART") return `Saved: Prefer ${rule.daypart}${scopeText(rule.scope)}.`;
  if (rule.type === "BUFFER_MINUTES") return `Saved: ${rule.minutes}-minute buffer between events.`;
  return `Saved preference: ${rule.text}`;
}

function humanizeValidationFailure(errors: string[]): string {
  const first = errors[0] ?? "Validation failed.";
  return `Proposed changes failed validation: ${first}`;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function formatClock(clock: string): string {
  const [hours, minutes] = clock.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function scopeText(scope?: string): string {
  return scope && scope !== "any" ? ` ${scope}` : "";
}