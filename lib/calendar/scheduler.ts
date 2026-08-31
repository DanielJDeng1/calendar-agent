import { CalendarEvent, Daypart, EventCategory, Preference } from "../domain/types";
import { addDays, addMinutes, datePartInTimezone, DEFAULT_TZ, localIso } from "./date";

export interface SlotRequest {
  events: CalendarEvent[];
  preferences: Preference[];
  durationMinutes: number;
  category: EventCategory;
  nowIso: string;
  targetDate?: string;
  targetTime?: string;
  preferredTime?: string;
  dateRange?: { start: string; end: string };
  daypart?: Daypart;
  earliestTime?: string;
  latestTime?: string;
  excludeEventId?: string;
  relativeToIso?: string;
  relativeTime?: "earlier" | "later";
  ignorePreferenceBuffer?: boolean;
  ignoreHardPreferences?: boolean;
}

export interface SlotCandidate {
  start: string;
  end: string;
  score: number;
  reasons: string[];
}

const DAYPART_WINDOWS: Record<Daypart, [number, number]> = {
  morning: [8 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60],
};

const DAYPART_ANCHORS: Record<Daypart, number> = {
  morning: 9 * 60,
  afternoon: 14 * 60,
  evening: 18 * 60 + 30,
};

export function findBestSlot(request: SlotRequest): SlotCandidate | undefined {
  const duration = Math.max(15, Math.min(request.durationMinutes, 8 * 60));
  const nowMs = new Date(request.nowIso).getTime();
  const range = normalizeRange(request);
  const explicitWindow = request.daypart ? DAYPART_WINDOWS[request.daypart] : undefined;
  const persistentDaypart = getPreferredDaypart(request.preferences, request.category);
  const buffer = request.ignorePreferenceBuffer ? 0 : getBufferMinutes(request.preferences);
  const [hardStart, hardEnd] = request.ignoreHardPreferences ? [undefined, undefined] : getHardBounds(request.preferences, request.category);
  const requestStart = clockToMinutesSafe(request.earliestTime);
  const requestEnd = clockToMinutesSafe(request.latestTime);
  const preferredMinute = clockToMinutesSafe(request.preferredTime);

  if (request.targetTime) {
    const requestedMinute = clockToMinutesSafe(request.targetTime);
    if (requestedMinute === undefined) return undefined;
    if (requestStart !== undefined && requestedMinute < requestStart) return undefined;
    if (requestEnd !== undefined && requestedMinute > requestEnd) return undefined;

    const dates = enumerateDates(range.start, range.end);
    for (const date of dates) {
      const start = localIso(date, request.targetTime);
      const end = addMinutes(start, duration);
      if (new Date(start).getTime() < nowMs - 60_000) continue;
      if (!passesRelativeConstraint(start, request)) continue;
      if (!withinHardBounds(start, hardStart, hardEnd)) continue;
      if (!hasConflict(start, end, request.events, request.excludeEventId, 0)) {
        return { start, end, score: 100, reasons: ["Matches the time you requested"] };
      }
    }
    return undefined;
  }

  const candidates: SlotCandidate[] = [];
  const dates = enumerateDates(range.start, range.end);
  for (const [dayIndex, date] of dates.entries()) {
    const preferredWindow = preferredMinute === undefined ? undefined : ([6 * 60, 24 * 60] as [number, number]);
    const [windowStart, windowEnd] = explicitWindow ?? preferredWindow ?? [8 * 60, 21 * 60];
    const earliestStart = Math.max(windowStart, hardStart ?? windowStart, requestStart ?? windowStart);
    const latestStart = Math.min(
      windowEnd - duration,
      hardEnd ?? Number.POSITIVE_INFINITY,
      requestEnd ?? Number.POSITIVE_INFINITY
    );

    if (latestStart < earliestStart) continue;

    for (let minute = ceilToQuarterHour(earliestStart); minute <= latestStart; minute += 15) {
      const start = localIso(date, minutesToClock(minute));
      const end = addMinutes(start, duration);
      const startMs = new Date(start).getTime();
      if (startMs < nowMs + 5 * 60_000) continue;
      if (!passesRelativeConstraint(start, request)) continue;
      if (hasConflict(start, end, request.events, request.excludeEventId, buffer)) continue;

      let score = 100 - dayIndex * 4;
      const reasons: string[] = [];

      if (preferredMinute !== undefined) {
        const preferredDistance = Math.abs(minute - preferredMinute);
        score += 24 - Math.min(24, preferredDistance / 10);
        if (preferredDistance <= 30) reasons.push("Stays close to the planned cadence");
      }

      if (request.daypart) {
        const anchorDistance = Math.abs(minute - DAYPART_ANCHORS[request.daypart]);
        score += 16 - Math.min(12, anchorDistance / 30);
        reasons.push(`Fits the requested ${request.daypart}`);
      } else if (persistentDaypart && inDaypart(minute, persistentDaypart)) {
        const anchorDistance = Math.abs(minute - DAYPART_ANCHORS[persistentDaypart]);
        score += 10 - Math.min(7, anchorDistance / 45);
        reasons.push(`Matches your ${persistentDaypart} preference`);
      }

      if (request.latestTime) {
        score += 2;
        reasons.push(`Starts no later than ${formatMinutes(requestEnd!)}`);
      }
      if (request.earliestTime) {
        score += 2;
        reasons.push(`Starts no earlier than ${formatMinutes(requestStart!)}`);
      }

      const adjacency = nearestEventDistance(start, end, request.events, request.excludeEventId);
      if (adjacency !== undefined && adjacency <= 30) {
        score += 4;
        reasons.push("Keeps the day relatively compact");
      }

      if (!request.daypart && minute >= 9 * 60 && minute <= 17 * 60) score += 2;
      candidates.push({ start, end, score, reasons });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.start.localeCompare(b.start))[0];
}

function normalizeRange(request: SlotRequest): { start: string; end: string } {
  if (request.targetDate) return { start: request.targetDate, end: request.targetDate };
  if (request.dateRange) return request.dateRange;
  const current = datePartInTimezone(request.nowIso);
  return { start: current, end: addDays(current, 7) };
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 62) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function minutesToClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function hasConflict(
  start: string,
  end: string,
  events: CalendarEvent[],
  excludeEventId: string | undefined,
  bufferMinutes: number
): boolean {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const bufferMs = bufferMinutes * 60_000;
  return events.some((event) => {
    if (event.id === excludeEventId || event.availability === "free") return false;
    const eventStart = new Date(event.start).getTime() - bufferMs;
    const eventEnd = new Date(event.end).getTime() + bufferMs;
    return startMs < eventEnd && eventStart < endMs;
  });
}

function getBufferMinutes(preferences: Preference[]): number {
  const preference = preferences
    .filter((item) => item.rule.type === "BUFFER_MINUTES")
    .sort((a, b) => b.priority - a.priority)[0];
  return preference?.rule.type === "BUFFER_MINUTES" ? preference.rule.minutes : 0;
}

function getPreferredDaypart(preferences: Preference[], category: EventCategory): Daypart | undefined {
  const preference = preferences
    .filter((item) => item.rule.type === "PREFER_DAYPART" && scopeMatches(item.rule.scope, category))
    .sort((a, b) => b.priority - a.priority)[0];
  return preference?.rule.type === "PREFER_DAYPART" ? preference.rule.daypart : undefined;
}

function getHardBounds(preferences: Preference[], category: EventCategory): [number | undefined, number | undefined] {
  let notBefore: number | undefined;
  let notAfter: number | undefined;
  for (const preference of [...preferences].sort((a, b) => b.priority - a.priority)) {
    if (preference.rule.type === "NOT_BEFORE" && scopeMatches(preference.rule.scope, category) && notBefore === undefined) {
      notBefore = clockToMinutesSafe(preference.rule.time);
    }
    if (preference.rule.type === "NOT_AFTER" && scopeMatches(preference.rule.scope, category) && notAfter === undefined) {
      notAfter = clockToMinutesSafe(preference.rule.time);
    }
  }
  return [notBefore, notAfter];
}

function scopeMatches(scope: "meeting" | "work" | "school" | "personal" | "any" | undefined, category: EventCategory): boolean {
  return (scope ?? "meeting") === "any" || (scope ?? "meeting") === category;
}

function clockToMinutesSafe(clock?: string): number | undefined {
  if (!clock) return undefined;
  const [hour, minute] = clock.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function withinHardBounds(start: string, hardStart?: number, hardEnd?: number): boolean {
  if (hardStart === undefined && hardEnd === undefined) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(start));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const startMinutes = hour * 60 + minute;
  if (hardStart !== undefined && startMinutes < hardStart) return false;
  if (hardEnd !== undefined && startMinutes > hardEnd) return false;
  return true;
}

function passesRelativeConstraint(start: string, request: SlotRequest): boolean {
  if (!request.relativeToIso || !request.relativeTime) return true;
  const startMs = new Date(start).getTime();
  const reference = new Date(request.relativeToIso).getTime();
  return request.relativeTime === "later" ? startMs > reference : startMs < reference;
}

function inDaypart(minute: number, daypart: Daypart): boolean {
  const [start, end] = DAYPART_WINDOWS[daypart];
  return minute >= start && minute < end;
}

function nearestEventDistance(start: string, end: string, events: CalendarEvent[], excludeEventId?: string): number | undefined {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  let best: number | undefined;
  for (const event of events) {
    if (event.id === excludeEventId || event.availability === "free") continue;
    const before = Math.abs(startMs - new Date(event.end).getTime()) / 60_000;
    const after = Math.abs(new Date(event.start).getTime() - endMs) / 60_000;
    const distance = Math.min(before, after);
    best = best === undefined ? distance : Math.min(best, distance);
  }
  return best;
}

function ceilToQuarterHour(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}