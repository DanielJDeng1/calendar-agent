import { CalendarCommand, CalendarEvent, Preference } from "../domain/types";
import { DEFAULT_TZ } from "./date";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateCommands(
  commands: CalendarCommand[],
  events: CalendarEvent[],
  preferences: Preference[]
): ValidationResult {
  const errors: string[] = [];
  const byId = new Map(events.map((event) => [event.id, event]));

  for (const command of commands) {
    const operation = command.operation;
    if (operation.type === "MOVE_EVENT" || operation.type === "UPDATE_EVENT" || operation.type === "DELETE_EVENT") {
      const event = byId.get(operation.eventId);
      if (!event) {
        errors.push(`The event ${operation.eventId} no longer exists.`);
        continue;
      }
      if (operation.type === "DELETE_EVENT" && !event.permissions.canDelete) errors.push(`${event.title} cannot be deleted.`);
      if ((operation.type === "MOVE_EVENT" || operation.type === "UPDATE_EVENT") && !event.permissions.canUpdate) errors.push(`${event.title} is read-only.`);
    }
  }

  const simulated = shallowApply(commands, events);
  const touchedIds = touchedEventIds(commands);
  for (let i = 0; i < simulated.length; i += 1) {
    for (let j = i + 1; j < simulated.length; j += 1) {
      const a = simulated[i];
      const b = simulated[j];
      if (a.availability === "free" || b.availability === "free") continue;
      if (new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end)) {
        if (touchedIds.has(a.id) || touchedIds.has(b.id)) errors.push(`Conflict: ${a.title} overlaps ${b.title}.`);
      }
    }
  }

  for (const command of commands) {
    const operation = command.operation;
    const event = operation.type === "CREATE_EVENT"
      ? simulated.find((item) => item.id === (operation.event.id ?? `draft-${command.commandId}`))
      : operation.type === "MOVE_EVENT" || operation.type === "UPDATE_EVENT"
        ? simulated.find((item) => item.id === operation.eventId)
        : undefined;
    if (!event) continue;

    for (const preference of preferences) {
      if (preference.rule.type === "NOT_BEFORE" && scopeMatches(preference.rule.scope, event.category)) {
        const eventMinutes = localStartMinutes(event.start);
        const [hour, minute] = preference.rule.time.split(":").map(Number);
        if (eventMinutes < hour * 60 + minute) errors.push(`Hard preference violation: ${scopeLabel(preference.rule.scope)} should not start before ${preference.rule.time}.`);
      }
      if (preference.rule.type === "NOT_AFTER" && scopeMatches(preference.rule.scope, event.category)) {
        const eventMinutes = localStartMinutes(event.start);
        const [hour, minute] = preference.rule.time.split(":").map(Number);
        if (eventMinutes > hour * 60 + minute) errors.push(`Hard preference violation: ${scopeLabel(preference.rule.scope)} should not start after ${preference.rule.time}.`);
      }
    }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function touchedEventIds(commands: CalendarCommand[]): Set<string> {
  const ids = new Set<string>();
  for (const command of commands) {
    const operation = command.operation;
    if ("eventId" in operation) ids.add(operation.eventId);
    if (operation.type === "CREATE_EVENT") ids.add(operation.event.id ?? `draft-${command.commandId}`);
  }
  return ids;
}

function shallowApply(commands: CalendarCommand[], events: CalendarEvent[]): CalendarEvent[] {
  let result = events.map((event) => ({ ...event }));
  for (const command of commands) {
    const operation = command.operation;
    if (operation.type === "DELETE_EVENT") result = result.filter((event) => event.id !== operation.eventId);
    if (operation.type === "MOVE_EVENT") result = result.map((event) => event.id === operation.eventId ? { ...event, start: operation.newStart, end: operation.newEnd } : event);
    if (operation.type === "UPDATE_EVENT") result = result.map((event) => event.id === operation.eventId ? { ...event, ...operation.patch } : event);
    if (operation.type === "CREATE_EVENT") {
      const id = operation.event.id ?? `draft-${command.commandId}`;
      result.push({ ...operation.event, id, providerEventId: id, updatedAt: command.createdAt });
    }
  }
  return result;
}

function scopeLabel(scope: "meeting" | "work" | "school" | "personal" | "any" | undefined): string {
  switch (scope) {
    case "work": return "Work blocks";
    case "school": return "School blocks";
    case "personal": return "Personal events";
    case "any": return "Events";
    case "meeting":
    default: return "Meetings";
  }
}

function scopeMatches(scope: "meeting" | "work" | "school" | "personal" | "any" | undefined, category: CalendarEvent["category"]): boolean {
  return (scope ?? "meeting") === "any" || (scope ?? "meeting") === category;
}

function localStartMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
