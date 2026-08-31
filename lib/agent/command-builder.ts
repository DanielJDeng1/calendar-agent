import {
  AgentDecision,
  CalendarCommand,
  CalendarEvent,
  Preference,
  SemanticOperation,
} from "../domain/types";
import { addDays, addMinutes, datePartInTimezone, DEFAULT_TZ, localIso, prettyDateTime } from "../calendar/date";
import { findBestSlot } from "../calendar/scheduler";

type MutationDecision = Extract<AgentDecision, { kind: "calendar_mutation" }>;

export interface CommandPlan {
  commands: CalendarCommand[];
  summary?: string;
  note?: string;
  plannedEvents?: Array<{ title: string; start: string; end: string; location?: string; description?: string }>;
}

export function buildCommandPlan(input: {
  decision: AgentDecision;
  events: CalendarEvent[];
  preferences: Preference[];
  snapshotVersion: string;
  nowIso: string;
}): CommandPlan {
  const { decision, events, preferences, snapshotVersion, nowIso } = input;
  const makeCommand = (operation: CalendarCommand["operation"]): CalendarCommand => ({
    commandId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    expectedSnapshotVersion: snapshotVersion,
    operation,
    createdAt: new Date().toISOString(),
  });

  if (decision.kind !== "calendar_mutation") return { commands: [] };

  let workingEvents = events.map((event) => ({ ...event }));
  const commands: CalendarCommand[] = [];
  const plannedEvents: NonNullable<CommandPlan["plannedEvents"]> = [];
  const notes: string[] = [];
  const movedForRoom: string[] = [];
  const removedForRoom: string[] = [];

  const operations = expandSeriesOperations(decision.operations);
  const creates = operations.filter((operation) => operation.type === "create_event");
  const coordinated = Boolean(decision.coordinated);

  if (coordinated && decision.conflictPolicy !== "preserve" && decision.coordinated?.targetDate && decision.coordinated.windowStart && decision.coordinated.windowEnd) {
    const planStart = localIso(decision.coordinated.targetDate, decision.coordinated.windowStart);
    const planEnd = localIso(decision.coordinated.targetDate, decision.coordinated.windowEnd);
    const blockers = intervalConflicts(planStart, planEnd, workingEvents);

    for (const blocker of blockers) {
      if (decision.conflictPolicy === "replace_owned" && canDeleteOwned(blocker)) {
        commands.push(makeCommand({ type: "DELETE_EVENT", eventId: blocker.id }));
        workingEvents = workingEvents.filter((event) => event.id !== blocker.id);
        removedForRoom.push(blocker.title);
        continue;
      }
      if (!canRelocate(blocker, decision.conflictPolicy)) continue;
      const relocation = relocateEvent(blocker, workingEvents, preferences, nowIso, decision.coordinated.targetDate);
      if (!relocation) continue;
      commands.push(makeCommand({ type: "MOVE_EVENT", eventId: blocker.id, newStart: relocation.start, newEnd: relocation.end }));
      workingEvents = workingEvents.map((event) => event.id === blocker.id ? { ...event, start: relocation.start, end: relocation.end } : event);
      movedForRoom.push(blocker.title);
    }
  }

  const planCursorByDate = new Map<string, number>();
  let planItemIndex = 0;
  const planId = coordinated ? crypto.randomUUID() : undefined;
  const unscheduled: string[] = [];

  for (const operation of operations) {
    if (operation.type === "create_event") {
      const operationDate = operation.targetDate ?? decision.coordinated?.targetDate;
      const cursorMinutes = operationDate
        ? planCursorByDate.get(operationDate) ?? clockMinutes(operation.windowStart ?? decision.coordinated?.windowStart ?? "08:00")
        : undefined;
      const result = buildCreateOperation({
        operation,
        decision,
        workingEvents,
        preferences,
        nowIso,
        coordinated,
        cursorMinutes,
        planId,
        planItemIndex,
      });

      if (!result.event) {
        if (coordinated) {
          unscheduled.push(operation.title ?? "Untitled event");
          continue;
        }
        return { commands: [], note: result.note ?? "Could not schedule event." };
      }

      let created = result.event;
      let conflicts = intervalConflicts(created.start, created.end, workingEvents);
      if (conflicts.length && decision.conflictPolicy !== "preserve") {
        for (const blocker of conflicts) {
          if (decision.conflictPolicy === "replace_owned" && canDeleteOwned(blocker)) {
            commands.push(makeCommand({ type: "DELETE_EVENT", eventId: blocker.id }));
            workingEvents = workingEvents.filter((event) => event.id !== blocker.id);
            removedForRoom.push(blocker.title);
            continue;
          }
          if (!canRelocate(blocker, decision.conflictPolicy)) continue;
          const relocation = relocateEvent(blocker, workingEvents, preferences, nowIso, datePartInTimezone(created.start));
          if (!relocation) continue;
          commands.push(makeCommand({ type: "MOVE_EVENT", eventId: blocker.id, newStart: relocation.start, newEnd: relocation.end }));
          workingEvents = workingEvents.map((event) => event.id === blocker.id ? { ...event, start: relocation.start, end: relocation.end } : event);
          movedForRoom.push(blocker.title);
        }
        conflicts = intervalConflicts(created.start, created.end, workingEvents);
      }

      if (conflicts.length) {
        if (coordinated) {
          unscheduled.push(operation.title ?? "Untitled event");
          continue;
        }
        return { commands: [], note: `Requested time for "${created.title}" conflicts with ${joinTitles(conflicts)}.` };
      }

      commands.push(makeCommand({ type: "CREATE_EVENT", event: created }));
      workingEvents.push(created);
      plannedEvents.push({ title: created.title, start: created.start, end: created.end, location: created.location, description: created.description });
      if (coordinated) {
        const createdDate = datePartInTimezone(created.start);
        planCursorByDate.set(createdDate, clockMinutes(clockFromIso(created.end)));
      }
      planItemIndex += 1;
      continue;
    }

    if (operation.type === "move_event") {
      const target = resolveTargetEvent(operation, workingEvents);
      if (!target) return { commands: [], note: `Could not find target event${operation.targetEventTitle ? ` ("${operation.targetEventTitle}")` : ""}.` };
      const move = buildMoveOperation(operation, target, workingEvents, preferences, nowIso);
      if (!move) return { commands: [], note: `Could not find a valid slot for "${target.title}".` };

      let conflicts = intervalConflicts(move.start, move.end, workingEvents, target.id);
      if (conflicts.length && decision.conflictPolicy !== "preserve") {
        for (const blocker of conflicts) {
          if (decision.conflictPolicy === "replace_owned" && canDeleteOwned(blocker)) {
            commands.push(makeCommand({ type: "DELETE_EVENT", eventId: blocker.id }));
            workingEvents = workingEvents.filter((event) => event.id !== blocker.id);
            removedForRoom.push(blocker.title);
            continue;
          }
          if (!canRelocate(blocker, decision.conflictPolicy)) continue;
          const relocation = relocateEvent(blocker, workingEvents, preferences, nowIso, datePartInTimezone(move.start));
          if (!relocation) continue;
          commands.push(makeCommand({ type: "MOVE_EVENT", eventId: blocker.id, newStart: relocation.start, newEnd: relocation.end }));
          workingEvents = workingEvents.map((event) => event.id === blocker.id ? { ...event, start: relocation.start, end: relocation.end } : event);
          movedForRoom.push(blocker.title);
        }
        conflicts = intervalConflicts(move.start, move.end, workingEvents, target.id);
      }
      if (conflicts.length) return { commands: [], note: `Moving "${target.title}" conflicts with ${joinTitles(conflicts)}.` };

      commands.push(makeCommand({ type: "MOVE_EVENT", eventId: target.id, newStart: move.start, newEnd: move.end }));
      workingEvents = workingEvents.map((event) => event.id === target.id ? { ...event, start: move.start, end: move.end } : event);
      plannedEvents.push({ title: target.title, start: move.start, end: move.end, location: target.location, description: target.description });
      continue;
    }

    if (operation.type === "delete_event") {
      const target = resolveTargetEvent(operation, workingEvents);
      if (!target) return { commands: [], note: `Could not find target event${operation.targetEventTitle ? ` ("${operation.targetEventTitle}")` : ""}.` };
      commands.push(makeCommand({ type: "DELETE_EVENT", eventId: target.id }));
      workingEvents = workingEvents.filter((event) => event.id !== target.id);
      continue;
    }

    if (operation.type === "update_event") {
      const target = resolveTargetEvent(operation, workingEvents);
      if (!target) return { commands: [], note: `Could not find target event${operation.targetEventTitle ? ` ("${operation.targetEventTitle}")` : ""}.` };
      const patch: Partial<CalendarEvent> = {};
      if (operation.title) patch.title = operation.title;
      if (operation.description !== undefined) patch.description = operation.description;
      if (operation.location !== undefined) patch.location = operation.location;
      if (operation.category) patch.category = operation.category;
      if (!Object.keys(patch).length) return { commands: [], note: `No changes specified for "${target.title}".` };
      commands.push(makeCommand({ type: "UPDATE_EVENT", eventId: target.id, patch }));
      workingEvents = workingEvents.map((event) => event.id === target.id ? { ...event, ...patch } : event);
      continue;
    }

    if (operation.type === "reorganize_day") {
      const targetDate = operation.targetDate ?? decision.coordinated?.targetDate;
      if (!targetDate) return { commands: [], note: "Reorganization date not specified." };
      const reorganized = buildReorganization(targetDate, operation, workingEvents, preferences, nowIso, makeCommand);
      commands.push(...reorganized.commands);
      workingEvents = applyCommandsToWorkingEvents(workingEvents, reorganized.commands);
      if (reorganized.note) notes.push(reorganized.note);
    }
  }

  if (!commands.length) return { commands: [], note: notes[0] ?? "No executable calendar changes generated." };

  if (coordinated) {
    const createdCount = plannedEvents.length;
    const minimumUseful = Math.min(2, creates.length);
    if (createdCount < minimumUseful) {
      return { commands: [], note: "Could not fit the plan into the requested time window." };
    }
    if (unscheduled.length) notes.push(`Could not schedule: ${unscheduled.join(", ")}.`);
  }

  const summary = summarize(decision, commands, plannedEvents.length, movedForRoom.length, removedForRoom.length);
  return {
    commands,
    summary,
    note: notes.length ? notes.join(" ") : undefined,
    plannedEvents,
  };
}

function expandSeriesOperations(operations: SemanticOperation[]): SemanticOperation[] {
  const expanded: SemanticOperation[] = [];
  for (const operation of operations) {
    if (operation.type !== "create_series") {
      expanded.push(operation);
      continue;
    }

    const range = operation.dateRange;
    if (!range || !operation.recurrence) continue;
    let date = range.start;
    let count = 0;
    while (date <= range.end && count < 31) {
      if (operation.recurrence === "daily" || isWeekday(date)) {
        expanded.push({
          ...operation,
          type: "create_event",
          targetDate: date,
          dateRange: undefined,
          recurrence: undefined,
        });
      }
      date = addDays(date, 1);
      count += 1;
    }
  }
  return expanded;
}

function isWeekday(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function buildCreateOperation(input: {
  operation: SemanticOperation;
  decision: MutationDecision;
  workingEvents: CalendarEvent[];
  preferences: Preference[];
  nowIso: string;
  coordinated: boolean;
  cursorMinutes?: number;
  planId?: string;
  planItemIndex: number;
}): { event?: CalendarEvent; note?: string } {
  const { operation, decision, workingEvents, preferences, nowIso, coordinated, cursorMinutes, planId, planItemIndex } = input;
  const title = operation.title?.trim();
  if (!title) return { note: "Missing event title." };
  const category = operation.category;
  if (!category) return { note: `Missing category for "${title}".` };
  const duration = operation.durationMinutes ?? (operation.exactStart && operation.exactEnd
    ? durationBetweenClocks(operation.exactStart, operation.exactEnd)
    : undefined);
  if (!duration || duration < 15) return { note: `Invalid duration for "${title}".` };
  const targetDate = operation.targetDate ?? decision.coordinated?.targetDate;

  let start: string | undefined;
  let end: string | undefined;

  if (operation.exactStart) {
    if (!targetDate) return { note: `Missing date for exact start time on "${title}".` };
    if (operation.exactEnd) {
      ({ start, end } = exactTimes(targetDate, operation.exactStart, operation.exactEnd));
    } else {
      start = localIso(targetDate, operation.exactStart);
      end = addMinutes(start, duration);
    }
  } else if (coordinated && targetDate) {
    const windowStart = operation.windowStart ?? decision.coordinated?.windowStart ?? "08:00";
    const windowEnd = operation.windowEnd ?? decision.coordinated?.windowEnd ?? "20:00";
    const placement = findCoordinatedPlacement({
      targetDate,
      duration,
      cursorMinutes: cursorMinutes ?? clockMinutes(windowStart),
      windowStart,
      windowEnd,
      preferredStart: operation.preferredStart,
      itemWindowStart: operation.windowStart,
      itemWindowEnd: operation.windowEnd,
      events: workingEvents,
    });
    if (!placement) return { note: `Could not fit "${title}" into the plan window.` };
    start = placement.start;
    end = placement.end;
  } else {
    const latestStart = operation.windowEnd ? subtractMinutesFromClock(operation.windowEnd, duration) : undefined;
    const slot = findBestSlot({
      events: workingEvents,
      preferences,
      durationMinutes: duration,
      category,
      nowIso,
      targetDate,
      dateRange: operation.dateRange,
      daypart: operation.daypart,
      earliestTime: operation.windowStart,
      latestTime: latestStart,
      preferredTime: operation.preferredStart,
    });
    if (!slot) return { note: `No available slot found for "${title}".` };
    start = slot.start;
    end = slot.end;
  }

  const event: CalendarEvent = {
    id: `draft-${crypto.randomUUID()}`,
    provider: "local",
    providerEventId: "pending",
    calendarId: "primary",
    title,
    description: operation.description,
    location: operation.location,
    start,
    end,
    timezone: DEFAULT_TZ,
    allDay: false,
    availability: "busy",
    attendees: [],
    permissions: { canRead: true, canUpdate: true, canDelete: true },
    updatedAt: new Date().toISOString(),
    category,
    flexible: operation.flexible ?? false,
    agentMetadata: coordinated ? {
      source: "calendar_agent",
      planId,
      planTitle: decision.coordinated?.title,
      planGoal: decision.coordinated?.goal,
      planItemIndex,
    } : undefined,
  };
  return { event };
}

function buildMoveOperation(
  operation: SemanticOperation,
  target: CalendarEvent,
  events: CalendarEvent[],
  preferences: Preference[],
  nowIso: string
): { start: string; end: string } | undefined {
  const existingDuration = Math.max(15, Math.round((new Date(target.end).getTime() - new Date(target.start).getTime()) / 60_000));
  const duration = Math.max(15, operation.durationMinutes ?? existingDuration);
  const currentDate = datePartInTimezone(target.start);
  const targetDate = operation.targetDate ?? currentDate;

  if (operation.exactStart && operation.exactEnd) return exactTimes(targetDate, operation.exactStart, operation.exactEnd);
  if (operation.exactStart) {
    const start = localIso(targetDate, operation.exactStart);
    return { start, end: addMinutes(start, duration) };
  }

  const hasSchedulingConstraint = Boolean(
    operation.windowStart || operation.windowEnd || operation.preferredStart || operation.daypart || operation.relativeTime || operation.dateRange,
  );

  if (operation.targetDate && !hasSchedulingConstraint) {
    const start = localIso(targetDate, clockFromIso(target.start));
    return { start, end: addMinutes(start, duration) };
  }

  if (operation.durationMinutes && !operation.targetDate && !hasSchedulingConstraint) {
    return { start: target.start, end: addMinutes(target.start, duration) };
  }

  const latestStart = operation.windowEnd ? subtractMinutesFromClock(operation.windowEnd, duration) : undefined;
  const slot = findBestSlot({
    events,
    preferences,
    durationMinutes: duration,
    category: target.category,
    nowIso,
    targetDate: operation.targetDate,
    dateRange: operation.dateRange,
    daypart: operation.daypart,
    earliestTime: operation.windowStart,
    latestTime: latestStart,
    preferredTime: operation.preferredStart,
    relativeToIso: target.start,
    relativeTime: operation.relativeTime,
    excludeEventId: target.id,
  });
  return slot ? { start: slot.start, end: slot.end } : undefined;
}

function buildReorganization(
  targetDate: string,
  operation: SemanticOperation,
  events: CalendarEvent[],
  preferences: Preference[],
  nowIso: string,
  makeCommand: (operation: CalendarCommand["operation"]) => CalendarCommand
): { commands: CalendarCommand[]; note?: string } {
  const movable = events
    .filter((event) => datePartInTimezone(event.start) === targetDate)
    .filter((event) => event.flexible && event.permissions.canUpdate && event.attendees.length === 0)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!movable.length) return { commands: [], note: "No flexible events found on that day to reorganize." };

  let working = events.map((event) => ({ ...event }));
  const commands: CalendarCommand[] = [];
  for (const event of movable) {
    const duration = Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000);
    const slot = findBestSlot({
      events: working,
      preferences,
      durationMinutes: duration,
      category: event.category,
      nowIso,
      targetDate,
      excludeEventId: event.id,
      daypart: operation.daypart,
      earliestTime: operation.windowStart,
      latestTime: operation.windowEnd ? subtractMinutesFromClock(operation.windowEnd, duration) : undefined,
      ignorePreferenceBuffer: operation.strategy === "compact",
    });
    if (!slot || slot.start === event.start) continue;
    commands.push(makeCommand({ type: "MOVE_EVENT", eventId: event.id, newStart: slot.start, newEnd: slot.end }));
    working = working.map((item) => item.id === event.id ? { ...item, start: slot.start, end: slot.end } : item);
  }
  return commands.length ? { commands } : { commands: [], note: "Flexible events are already optimized." };
}

function findCoordinatedPlacement(input: {
  targetDate: string;
  duration: number;
  cursorMinutes: number;
  windowStart: string;
  windowEnd: string;
  preferredStart?: string;
  itemWindowStart?: string;
  itemWindowEnd?: string;
  events: CalendarEvent[];
}): { start: string; end: string } | undefined {
  const overallStart = clockMinutes(input.windowStart);
  const overallEnd = clockMinutes(input.windowEnd);
  const itemStart = input.itemWindowStart ? clockMinutes(input.itemWindowStart) : overallStart;
  const itemEnd = input.itemWindowEnd ? clockMinutes(input.itemWindowEnd) : overallEnd;
  const earliest = Math.max(overallStart, itemStart, input.cursorMinutes);
  const latest = Math.min(overallEnd, itemEnd) - input.duration;
  if (latest < earliest) return undefined;

  const candidates: number[] = [];
  if (input.preferredStart) {
    const preferred = clockMinutes(input.preferredStart);
    if (preferred >= earliest && preferred <= latest) candidates.push(preferred);
  }
  for (let minute = ceilQuarter(earliest); minute <= latest; minute += 15) {
    if (!candidates.includes(minute)) candidates.push(minute);
  }

  for (const minute of candidates) {
    const start = localIso(input.targetDate, minutesToClock(minute));
    const end = addMinutes(start, input.duration);
    if (!intervalConflicts(start, end, input.events).length) return { start, end };
  }
  return undefined;
}

function relocateEvent(
  event: CalendarEvent,
  events: CalendarEvent[],
  preferences: Preference[],
  nowIso: string,
  avoidDate: string
): { start: string; end: string } | undefined {
  const duration = Math.max(15, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000));
  const slot = findBestSlot({
    events,
    preferences,
    durationMinutes: duration,
    category: event.category,
    nowIso,
    dateRange: { start: addDays(avoidDate, 1), end: addDays(avoidDate, 7) },
    excludeEventId: event.id,
  });
  return slot ? { start: slot.start, end: slot.end } : undefined;
}

function resolveTargetEvent(operation: SemanticOperation, events: CalendarEvent[]): CalendarEvent | undefined {
  if (operation.targetEventId) {
    const byId = events.find((event) => event.id === operation.targetEventId);
    if (byId) return byId;
  }
  if (!operation.targetEventTitle) return undefined;

  const target = normalize(operation.targetEventTitle);
  const exactMatches = events.filter((event) => normalize(event.title) === target);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return undefined;

  const candidates = events.map((event) => {
    const title = normalize(event.title);
    const targetWords = target.split(" ").filter((word) => word.length > 2);
    const titleWords = title.split(" ").filter((word) => word.length > 2);
    const overlap = targetWords.filter((word) => titleWords.includes(word)).length;
    const score = target.includes(title) || title.includes(target) ? 1 : overlap / Math.max(1, targetWords.length);
    return { event, score };
  }).filter((entry) => entry.score >= 0.6).sort((a, b) => b.score - a.score);

  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0].event;
  return candidates[0].score - candidates[1].score >= 0.25 ? candidates[0].event : undefined;
}

function intervalConflicts(start: string, end: string, events: CalendarEvent[], excludeId?: string): CalendarEvent[] {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return events.filter((event) => {
    if (event.id === excludeId || event.availability === "free") return false;
    return startMs < new Date(event.end).getTime() && new Date(event.start).getTime() < endMs;
  });
}

function canRelocate(event: CalendarEvent, policy: "preserve" | "move_flexible" | "move_owned" | "replace_owned"): boolean {
  if (policy === "preserve") return false;
  if (!event.permissions.canUpdate || event.availability === "out_of_office" || event.attendees.length > 0 || event.category === "meeting") return false;
  return policy === "move_owned" || policy === "replace_owned" || event.flexible === true;
}

function canDeleteOwned(event: CalendarEvent): boolean {
  return event.permissions.canDelete && event.attendees.length === 0 && event.category !== "meeting" && event.availability !== "out_of_office";
}

function exactTimes(targetDate: string, startClock: string, endClock: string): { start: string; end: string } {
  const start = localIso(targetDate, startClock);
  const endDate = clockMinutes(endClock) <= clockMinutes(startClock) ? addDays(targetDate, 1) : targetDate;
  return { start, end: localIso(endDate, endClock) };
}

function applyCommandsToWorkingEvents(events: CalendarEvent[], commands: CalendarCommand[]): CalendarEvent[] {
  let result = events.map((event) => ({ ...event }));
  for (const command of commands) {
    const operation = command.operation;
    if (operation.type === "MOVE_EVENT") result = result.map((event) => event.id === operation.eventId ? { ...event, start: operation.newStart, end: operation.newEnd } : event);
    if (operation.type === "DELETE_EVENT") result = result.filter((event) => event.id !== operation.eventId);
    if (operation.type === "UPDATE_EVENT") result = result.map((event) => event.id === operation.eventId ? { ...event, ...operation.patch } : event);
  }
  return result;
}

function summarize(decision: MutationDecision, commands: CalendarCommand[], createdCount: number, movedForRoomCount: number, removedForRoomCount: number): string {
  if (decision.coordinated) {
    const parts = [`${createdCount} planned ${createdCount === 1 ? "block" : "blocks"}`];
    if (movedForRoomCount) parts.push(`${movedForRoomCount} existing ${movedForRoomCount === 1 ? "event" : "events"} moved to make room`);
    if (removedForRoomCount) parts.push(`${removedForRoomCount} existing ${removedForRoomCount === 1 ? "event" : "events"} removed from the plan window`);
    return `${decision.coordinated.title}: ${parts.join(" · ")}`;
  }
  if (commands.length === 1) {
    const operation = commands[0].operation;
    if (operation.type === "CREATE_EVENT") return `Add "${operation.event.title}" at ${prettyDateTime(operation.event.start)}`;
    if (operation.type === "MOVE_EVENT") return `Move event to ${prettyDateTime(operation.newStart)}`;
    if (operation.type === "DELETE_EVENT") return "Remove event";
    if (operation.type === "UPDATE_EVENT") return "Update event";
  }
  return `${commands.length} proposed calendar changes`;
}

function durationBetweenClocks(start: string, end: string): number {
  const startMinutes = clockMinutes(start);
  let endMinutes = clockMinutes(end);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return endMinutes - startMinutes;
}

function joinTitles(events: CalendarEvent[]): string {
  const titles = events.slice(0, 3).map((event) => `"${event.title}"`);
  if (events.length > 3) titles.push(`${events.length - 3} more events`);
  return titles.join(", ");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clockMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToClock(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function subtractMinutesFromClock(clock: string, minutes: number): string {
  return minutesToClock(clockMinutes(clock) - minutes);
}

function ceilQuarter(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

function clockFromIso(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}