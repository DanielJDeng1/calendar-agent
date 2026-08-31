import { CalendarCommand, CalendarDiff, CalendarEvent, DraftState } from "../domain/types";

export function simulateCommands(
  commands: CalendarCommand[],
  baseEvents: CalendarEvent[],
  snapshotVersion: string,
  summary: string
): DraftState {
  const original = new Map(baseEvents.map((e) => [e.id, e]));
  let next = baseEvents.map((e) => ({ ...e }));

  for (const command of commands) {
    const op = command.operation;
    switch (op.type) {
      case "CREATE_EVENT": {
        const id = op.event.id ?? `draft-${command.commandId}`;
        next.push({ ...op.event, id, providerEventId: id, updatedAt: command.createdAt });
        break;
      }
      case "MOVE_EVENT":
        next = next.map((event) => event.id === op.eventId ? { ...event, start: op.newStart, end: op.newEnd, updatedAt: command.createdAt } : event);
        break;
      case "UPDATE_EVENT":
        next = next.map((event) => event.id === op.eventId ? { ...event, ...op.patch, updatedAt: command.createdAt } : event);
        break;
      case "DELETE_EVENT":
        next = next.filter((event) => event.id !== op.eventId);
        break;
    }
  }

  const finalById = new Map(next.map((e) => [e.id, e]));
  const additions = next.filter((e) => !original.has(e.id));
  const removals = baseEvents.filter((e) => !finalById.has(e.id));
  const modifications = next
    .filter((e) => original.has(e.id))
    .flatMap((after) => {
      const before = original.get(after.id)!;
      return JSON.stringify(before) !== JSON.stringify(after) ? [{ before, after }] : [];
    });

  const diff: CalendarDiff = { additions, removals, modifications };
  return {
    draftId: `draft-${crypto.randomUUID()}`,
    baseSnapshotVersion: snapshotVersion,
    version: 1,
    diff,
    commands,
    createdAt: new Date().toISOString(),
    summary,
  };
}

export function applyDiff(events: CalendarEvent[], diff: CalendarDiff): CalendarEvent[] {
  const removed = new Set(diff.removals.map((e) => e.id));
  const modified = new Map(diff.modifications.map((m) => [m.after.id, m.after]));
  const retained = events.filter((e) => !removed.has(e.id)).map((e) => modified.get(e.id) ?? e);
  return [...retained, ...diff.additions.map((e) => {
    const id = e.id.replace(/^draft-/, "evt-");
    return { ...e, id, providerEventId: e.providerEventId.replace(/^draft-/, "evt-") };
  })];
}
