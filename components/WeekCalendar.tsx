"use client";

import { useMemo } from "react";
import { CalendarEvent, DraftState } from "@/lib/domain/types";
import { addDays, datePartInTimezone, DEFAULT_TZ, prettyDate, startOfWeek } from "@/lib/calendar/date";

const startHour = 6;
const endHour = 24;
const hourHeight = 64;

interface WeekCalendarProps {
  events: CalendarEvent[];
  draft?: DraftState;
  anchorDate: string;
  todayDate: string;
  selectedEventId?: string;
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot: (date: string, time: string) => void;
}

export function WeekCalendar({
  events,
  draft,
  anchorDate,
  todayDate,
  selectedEventId,
  onSelectEvent,
  onSelectSlot,
}: WeekCalendarProps) {
  const days = useMemo(() => {
    const monday = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, index) => {
      const full = addDays(monday, index);
      const value = new Date(`${full}T12:00:00Z`);
      return {
        full,
        name: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(value),
        date: new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(value),
      };
    });
  }, [anchorDate]);

  const proposed = draft?.diff.additions ?? [];
  const removedIds = new Set(draft?.diff.removals.map((event) => event.id) ?? []);
  const movedBeforeIds = new Set(draft?.diff.modifications.map((change) => change.before.id) ?? []);
  const movedAfter = draft?.diff.modifications.map((change) => change.after) ?? [];

  return (
    <section className="calendarShell" aria-label="Week calendar">
      <div className="calendarViewport">
        <div className="weekGrid">
          <div className="cornerCell" style={{ gridColumn: 1, gridRow: 1 }} />
          {days.map((day, index) => (
            <div
              key={day.full}
              className={`dayHeader ${day.full === todayDate ? "today" : ""}`}
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              <span className="dayName">{day.name}</span>
              <span className={`dayDate ${day.full === todayDate ? "todayNumber" : ""}`}>{day.date}</span>
            </div>
          ))}

          {Array.from({ length: endHour - startHour }, (_, index) => startHour + index).flatMap((hour, row) => [
            <div key={`time-${hour}`} className="timeCell" style={{ gridColumn: 1, gridRow: row + 2 }}>
              {formatHour(hour)}
            </div>,
            ...days.map((day, col) => (
              <button
                key={`slot-${day.full}-${hour}`}
                type="button"
                className={`hourCell ${day.full === todayDate ? "today" : ""}`}
                style={{ gridColumn: col + 2, gridRow: row + 2 }}
                onClick={() => onSelectSlot(day.full, `${String(hour).padStart(2, "0")}:00`)}
                aria-label={`Add event on ${prettyDate(day.full)} at ${formatHour(hour)}`}
                title="Click to add an event"
              />
            )),
          ])}

          <div className="eventLayer">
            {events.map((event) => (
              <EventBlock
                key={event.id}
                event={event}
                days={days.map((day) => day.full)}
                selected={selectedEventId === event.id}
                extraClass={removedIds.has(event.id) ? "removed" : movedBeforeIds.has(event.id) ? "movedBefore" : ""}
                onSelect={onSelectEvent}
              />
            ))}
            {proposed.map((event) => (
              <EventBlock
                key={`proposal-${event.id}`}
                event={event}
                days={days.map((day) => day.full)}
                selected={selectedEventId === event.id}
                extraClass="proposed"
                onSelect={onSelectEvent}
              />
            ))}
            {movedAfter.map((event) => (
              <EventBlock
                key={`moved-${event.id}`}
                event={event}
                days={days.map((day) => day.full)}
                selected={selectedEventId === event.id}
                extraClass="proposed"
                onSelect={onSelectEvent}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EventBlock({
  event,
  days,
  extraClass = "",
  selected,
  onSelect,
}: {
  event: CalendarEvent;
  days: string[];
  extraClass?: string;
  selected: boolean;
  onSelect: (event: CalendarEvent) => void;
}) {
  const date = datePartInTimezone(event.start);
  const col = days.indexOf(date);
  if (col < 0) return null;

  const startMinutes = localMinutes(event.start);
  const endMinutes = localMinutes(event.end);
  const top = ((startMinutes - startHour * 60) / 60) * hourHeight;
  const height = Math.max(28, ((endMinutes - startMinutes) / 60) * hourHeight - 3);
  const left = `calc(${col} * (100% / 7) + 4px)`;
  const width = "calc((100% / 7) - 8px)";

  if (endMinutes <= startHour * 60 || startMinutes >= endHour * 60) return null;

  return (
    <button
      type="button"
      className={`event ${event.category} ${extraClass} ${selected ? "selected" : ""}`}
      style={{ top: Math.max(0, top), height, left, width }}
      title={`${event.title}${event.location ? ` · ${event.location}` : ""} · ${formatTime(event.start)} to ${formatTime(event.end)}`}
      onClick={(click) => {
        click.stopPropagation();
        onSelect(event);
      }}
    >
      <span className="eventTitle">{event.title}</span>
      <span className="eventTime">{formatTime(event.start)}–{formatTime(event.end)}</span>
    </button>
  );
}

function localMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const value = hour % 12 || 12;
  return `${value} ${suffix}`;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}