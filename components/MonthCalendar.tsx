"use client";

import { useMemo } from "react";
import { CalendarEvent, DraftState } from "@/lib/domain/types";
import { addDays, datePartInTimezone, DEFAULT_TZ, startOfMonth, startOfWeek } from "@/lib/calendar/date";

interface MonthCalendarProps {
  events: CalendarEvent[];
  draft?: DraftState;
  anchorDate: string;
  todayDate: string;
  selectedEventId?: string;
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectDay: (date: string) => void;
}

interface RenderedEvent {
  event: CalendarEvent;
  state: "normal" | "removed" | "movedBefore" | "proposed";
}

export function MonthCalendar({
  events,
  draft,
  anchorDate,
  todayDate,
  selectedEventId,
  onSelectEvent,
  onSelectDay,
}: MonthCalendarProps) {
  const monthKey = anchorDate.slice(0, 7);
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(anchorDate));
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [anchorDate]);

  const renderedEvents = useMemo<RenderedEvent[]>(() => {
    const removedIds = new Set(draft?.diff.removals.map((event) => event.id) ?? []);
    const movedIds = new Set(draft?.diff.modifications.map((change) => change.before.id) ?? []);
    return [
      ...events.map((event) => ({
        event,
        state: removedIds.has(event.id) ? "removed" as const : movedIds.has(event.id) ? "movedBefore" as const : "normal" as const,
      })),
      ...(draft?.diff.additions.map((event) => ({ event, state: "proposed" as const })) ?? []),
      ...(draft?.diff.modifications.map((change) => ({ event: change.after, state: "proposed" as const })) ?? []),
    ];
  }, [events, draft]);

  return (
    <section className="monthShell" aria-label="Month calendar">
      <div className="monthWeekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day}>{day}</div>)}
      </div>
      <div className="monthGrid">
        {days.map((date) => {
          const dayEvents = renderedEvents
            .filter(({ event }) => datePartInTimezone(event.start) === date)
            .sort((a, b) => a.event.start.localeCompare(b.event.start));
          const outside = date.slice(0, 7) !== monthKey;
          const visible = dayEvents.slice(0, 3);
          return (
            <div
              key={date}
              className={`monthDay ${outside ? "outside" : ""} ${date === todayDate ? "today" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(date)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDay(date);
                }
              }}
              aria-label={`Open week containing ${date}`}
            >
              <div className="monthDayHeader">
                <span className={`monthDayNumber ${date === todayDate ? "todayNumber" : ""}`}>{Number(date.slice(8, 10))}</span>
              </div>
              <div className="monthEventList">
                {visible.map(({ event, state }, index) => (
                  <button
                    type="button"
                    key={`${state}-${event.id}-${index}`}
                    className={`monthEvent ${event.category} ${state} ${selectedEventId === event.id ? "selected" : ""}`}
                    onClick={(click) => {
                      click.stopPropagation();
                      onSelectEvent(event);
                    }}
                    title={`${formatTime(event.start)} · ${event.title}`}
                  >
                    <span className="monthEventTime">{formatTime(event.start)}</span>
                    <span className="monthEventTitle">{event.title}</span>
                  </button>
                ))}
                {dayEvents.length > 3 ? <span className="moreEvents">+{dayEvents.length - 3} more</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
