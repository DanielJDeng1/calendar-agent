import assert from "node:assert/strict";
import { applyDiff, simulateCommands } from "../lib/calendar/simulate";
import { validateCommands } from "../lib/calendar/validate";
import type { CalendarCommand, CalendarEvent } from "../lib/domain/types";

const existing: CalendarEvent = {
  id: "event-1",
  provider: "local",
  providerEventId: "event-1",
  calendarId: "primary",
  title: "Existing event",
  start: "2026-09-20T09:00:00.000Z",
  end: "2026-09-20T10:00:00.000Z",
  timezone: "America/Chicago",
  allDay: false,
  availability: "busy",
  attendees: [],
  permissions: { canRead: true, canUpdate: true, canDelete: true },
  updatedAt: "2026-09-19T12:00:00.000Z",
  category: "school",
};

const move: CalendarCommand = {
  commandId: "move-1",
  idempotencyKey: "test-move-1",
  expectedSnapshotVersion: "snapshot-test",
  createdAt: "2026-09-20T08:00:00.000Z",
  operation: {
    type: "MOVE_EVENT",
    eventId: existing.id,
    newStart: "2026-09-20T11:00:00.000Z",
    newEnd: "2026-09-20T12:00:00.000Z",
  },
};

assert.equal(validateCommands([move], [existing], []).ok, true, "Valid move should pass validation.");

const draft = simulateCommands([move], [existing], "snapshot-test", "Move event");
assert.equal(draft.diff.modifications.length, 1, "Move should create exactly one modification.");
assert.equal(draft.diff.modifications[0].after.start, move.operation.type === "MOVE_EVENT" ? move.operation.newStart : "");

const applied = applyDiff([existing], draft.diff);
assert.equal(applied.length, 1);
assert.equal(applied[0].start, "2026-09-20T11:00:00.000Z");

const conflicting = { ...existing, id: "event-2", providerEventId: "event-2", start: "2026-09-20T11:30:00.000Z", end: "2026-09-20T12:30:00.000Z" };
assert.equal(validateCommands([move], [existing, conflicting], []).ok, false, "Overlapping move should be rejected.");

const readOnly = { ...existing, permissions: { ...existing.permissions, canDelete: false } };
const deletion: CalendarCommand = {
  ...move,
  commandId: "delete-1",
  idempotencyKey: "test-delete-1",
  operation: { type: "DELETE_EVENT", eventId: existing.id },
};
assert.equal(validateCommands([deletion], [readOnly], []).ok, false, "Read-only event deletion should be rejected.");

console.log("Calendar core smoke tests passed: valid move, simulation, apply, conflict, and permissions.");
