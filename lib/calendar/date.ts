import { getOpenRouterConfig } from "../config/openrouter";

export const DEFAULT_TZ =
  process.env.DEFAULT_TIMEZONE ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  "America/Chicago";

export function parseClock(value: string): { hour: number; minute: number } | null {
  const normalized = value.trim().toLowerCase().replace(/\./g, "");
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];
  if (minute > 59 || hour > 24) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
  }
  if (hour > 23) return null;
  return { hour, minute };
}

export function localIso(date: string, clock: string, timeZone = DEFAULT_TZ): string {
  const parsed = parseClock(clock);
  if (!parsed) throw new Error(`Invalid time: ${clock}`);
  const [year, month, day] = date.split("-").map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, parsed.hour, parsed.minute, 0);
  let guess = desiredAsUtc;

  for (let index = 0; index < 2; index += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const renderedAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    guess += desiredAsUtc - renderedAsUtc;
  }

  return new Date(guess).toISOString();
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(first.getUTCDate()).padStart(2, "0")}`;
}

export function startOfWeek(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  const daysFromMonday = (value.getUTCDay() + 6) % 7;
  return addDays(date, -daysFromMonday);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function datePartInTimezone(iso: string, timeZone = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Retain alias for backward compatibility across existing calls
export const datePartInChicago = datePartInTimezone;

export function prettyDateTime(iso: string, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function prettyDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options ?? { weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}

export function formatClock(clock: string): string {
  const parsed = parseClock(clock);
  if (!parsed) return clock;
  const meridiem = parsed.hour >= 12 ? "PM" : "AM";
  const hour = parsed.hour % 12 || 12;
  return `${hour}:${String(parsed.minute).padStart(2, "0")} ${meridiem}`;
}