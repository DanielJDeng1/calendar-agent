import { CalendarEvent } from "@/lib/domain/types";

export interface TimeRange {
  start: string;
  end: string;
}

export interface CalendarProvider {
  readonly type: "google" | "microsoft";
  getEvents(calendarIds: string[], range: TimeRange): Promise<CalendarEvent[]>;
  createEvent(event: Omit<CalendarEvent, "id" | "providerEventId" | "updatedAt">): Promise<CalendarEvent>;
  updateEvent(eventId: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} calendar provider is not configured in this local workspace.`);
  }
}
