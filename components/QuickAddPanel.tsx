"use client";

import { FormEvent, useState } from "react";
import { formatClock, prettyDate } from "@/lib/calendar/date";

export function QuickAddPanel({
  date,
  time,
  onClose,
  onCreate,
}: {
  date: string;
  time: string;
  onClose: () => void;
  onCreate: (prompt: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(time);
  const [duration, setDuration] = useState(60);

  function submit(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    onCreate(`Schedule "${cleanTitle}" on ${date} at ${formatClock(startTime)} for ${duration} minutes.`);
  }

  return (
    <aside className="sidePanel" aria-label="Add to calendar">
      <div className="sidePanelHeader">
        <div>
          <div className="sidePanelLabel">New event</div>
          <h2>{prettyDate(date)}</h2>
        </div>
        <button className="iconButton" type="button" onClick={onClose} aria-label="Close quick add">×</button>
      </div>
      <form className="sidePanelBody quickAddForm" onSubmit={submit}>
        <label>
          <span>Title</span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title..." />
        </label>
        <div className="formRow">
          <label>
            <span>Start</span>
            <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label>
            <span>Duration</span>
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
          </label>
        </div>
        <p className="panelHelp">New events will be staged for preview before saving.</p>
        <div className="formActions">
          <button className="textButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={!title.trim()}>Add event</button>
        </div>
      </form>
    </aside>
  );
}