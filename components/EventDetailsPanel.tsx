"use client";

import { CalendarEvent } from "@/lib/domain/types";
import { prettyDateTime } from "@/lib/calendar/date";

export function EventDetailsPanel({
  event,
  onClose,
  onAsk,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onAsk: (prompt: string, sendImmediately?: boolean) => void;
}) {
  const durationMinutes = Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000);

  return (
    <aside className="sidePanel" aria-label={`Details for ${event.title}`}>
      <div className="sidePanelHeader">
        <div>
          <div className="sidePanelLabel">Event</div>
          <h2>{event.title}</h2>
        </div>
        <button className="iconButton" type="button" onClick={onClose} aria-label="Close event details">×</button>
      </div>
      <div className="sidePanelBody">
        {event.description ? <p className="eventDescription">{event.description}</p> : null}

        <dl className="detailList">
          {event.location ? <div><dt>Location</dt><dd>{event.location}</dd></div> : null}
          <div><dt>Starts</dt><dd>{prettyDateTime(event.start)}</dd></div>
          <div><dt>Ends</dt><dd>{prettyDateTime(event.end)}</dd></div>
          <div><dt>Duration</dt><dd>{formatDuration(durationMinutes)}</dd></div>
          <div><dt>Type</dt><dd>{capitalize(event.category)} · {event.flexible ? "Flexible" : "Fixed"}</dd></div>
          {event.attendees.length ? (
            <div><dt>Attendees</dt><dd>{event.attendees.map((attendee) => attendee.displayName ?? attendee.email).join(", ")}</dd></div>
          ) : null}
        </dl>

        <div className="sidePanelSection">
          <h3>Actions</h3>
          <div className="panelActionStack">
            <button
              className="textButton wideButton"
              type="button"
              onClick={() => onAsk(`Move "${event.title}" to a better open time this week. Keep the duration the same.`, true)}
            >
              Find a better time
            </button>
            <button
              className="textButton wideButton"
              type="button"
              onClick={() => onAsk(`Move "${event.title}" to `)}
            >
              Move with instructions
            </button>
            <button
              className="dangerButton wideButton"
              type="button"
              onClick={() => onAsk(`Remove "${event.title}" from my calendar.`, true)}
            >
              Remove event
            </button>
          </div>
          <p className="panelHelp">Changes are staged in preview before being applied.</p>
        </div>
      </div>
    </aside>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}