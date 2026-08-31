import { DEFAULT_TZ } from "../lib/calendar/date";
import { loadProjectEnv } from "./load-env";
loadProjectEnv();

const NOW = "2026-08-26T19:00:00-05:00";
const SNAPSHOT = "snapshot-acceptance";
const full = process.argv.includes("--full");

async function main() {
  const [{ runAgent }, { getOpenRouterConfig }, { localIso, datePartInTimezone }] = await Promise.all([
    import("../lib/agent/agent"),
    import("../lib/config/openrouter"),
    import("../lib/calendar/date"),
  ]);
  const config = getOpenRouterConfig();
  if (!config.apiKey) throw new Error("OPENROUTER_API_KEY is not loaded from .env.local/.env or the environment.");
  console.log(`Agent acceptance: ${config.model}${config.fallbackModels.length ? ` -> ${config.fallbackModels.join(" -> ")}` : ""}`);
  console.log("Runs the live semantic planner plus deterministic preview pipeline.");

  const agent = (message: string, events: any[] = [], activeDraft?: any, conversation: any[] = []) => runAgent({
    message, events, preferences: [], snapshotVersion: SNAPSHOT, now: NOW, conversation, activeDraft,
  });

  await runCase("single exact event", async () => {
    const response = await agent("Schedule Chemistry Study on September 1 from 8 to 9 AM.");
    const additions = requireDraft(response).diff.additions;
    expect(additions.length === 1, `expected 1 addition, got ${additions.length}`);
    expectClock(additions[0].start, "08:00");
    expectClock(additions[0].end, "09:00");
  });

  await runCase("seven-day gym series", async () => {
    const response = await agent("Please add 1 hour of gym every day for the week.");
    const additions = requireDraft(response).diff.additions;
    expect(additions.length === 7, `expected 7 gym additions, got ${additions.length}`);
    const dates = new Set(additions.map((event: any) => datePartInTimezone(event.start)));
    expect(dates.size === 7, `expected 7 distinct dates, got ${dates.size}`);
    for (const event of additions) expect(durationMinutes(event) === 60, `${event.title} was not 60 minutes`);
  });

  const chemistry = makeEvent(localIso, "chem-1", "Chemistry Study Session", "2026-08-27", "08:00", "09:00", "school");
  await runCase("date-only move preserves time", async () => {
    const response = await agent("move my chem study event to friday", [chemistry]);
    const changes = requireDraft(response).diff.modifications;
    expect(changes.length === 1, `expected 1 modification, got ${changes.length}`);
    expect(changes[0].before.id === "chem-1", `wrong event moved: ${changes[0].before.id}`);
    expect(datePartInTimezone(changes[0].after.start) === "2026-08-28", `wrong target date: ${datePartInTimezone(changes[0].after.start)}`);
    expectClock(changes[0].after.start, "08:00");
    expectClock(changes[0].after.end, "09:00");
  });

  await runCase("update existing event", async () => {
    const response = await agent("Rename my Chemistry Study Session to Chemistry Review and move it to the Library.", [chemistry]);
    const changes = requireDraft(response).diff.modifications;
    expect(changes.length === 1, `expected 1 modification, got ${changes.length}`);
    expect(changes[0].after.title === "Chemistry Review", `wrong title: ${changes[0].after.title}`);
    expect(/library/i.test(changes[0].after.location ?? ""), `wrong location: ${changes[0].after.location ?? "<empty>"}`);
  });

  const fridayGym = makeEvent(localIso, "gym-fri", "Friday Gym", "2026-08-28", "17:00", "18:00", "personal");
  const saturdayGym = makeEvent(localIso, "gym-sat", "Saturday Gym", "2026-08-29", "17:00", "18:00", "personal");
  await runCase("delete correct event", async () => {
    const response = await agent("Delete Friday Gym but leave Saturday Gym alone.", [fridayGym, saturdayGym]);
    const removals = requireDraft(response).diff.removals;
    expect(removals.length === 1 && removals[0].id === "gym-fri", `wrong deletion: ${removals.map((e: any) => e.id).join(",")}`);
  });

  await runCase("calendar query is read-only", async () => {
    const response = await agent("What do I have on August 27?", [chemistry]);
    expect(!response.draft, "query unexpectedly created a draft");
    expect(/chemistry/i.test(response.message), `query did not mention chemistry: ${response.message}`);
  });

  if (full) {
    await runCase("two independent creates", async () => {
      const response = await agent("Add Chemistry Study on September 1 from 8 to 9 AM and Physics Study on September 2 from 6 to 7 PM.");
      const additions = requireDraft(response).diff.additions;
      expect(additions.length === 2, `expected 2 additions, got ${additions.length}`);
    });

    let itinerary: any;
    await runCase("coordinated multi-event plan", async () => {
      itinerary = await agent("Plan Sunday September 6 from 10 AM to 4 PM with lunch, a museum visit, a bookstore stop, and coffee. Put them in a sensible order and show the preview.");
      const additions = requireDraft(itinerary).diff.additions;
      expect(additions.length >= 4, `expected at least 4 additions, got ${additions.length}`);
    });

    await runCase("approve exact visible preview", async () => {
      const draft = requireDraft(itinerary);
      const response = await agent("Yes, apply that exact preview.", [], draft, [
        { role: "user", content: "Plan Sunday with lunch, museum, bookstore, and coffee." },
        { role: "assistant", content: itinerary.message },
      ]);
      expect(response.autoApplyDraft === true, "approval did not set autoApplyDraft");
      expect(response.draft?.draftId === draft.draftId, "approval rebuilt the draft instead of applying the visible one");
    });

    await runCase("full-day specific plan with blocker replacement", async () => {
      const blocker = makeEvent(localIso, "sat-block", "Existing Saturday Event", "2026-08-29", "09:00", "10:00", "personal");
      const response = await agent("Plan a full day of Disney fun on Saturday, August 29 from 8 AM to 9 PM. Remove my events that are in the way. Make multiple specific calendar events, including Magic Kingdom, Space Mountain, Pirates of the Caribbean, Haunted Mansion, a meal stop, and other named attractions rather than one generic block.", [blocker]);
      const draft = requireDraft(response);
      expect(draft.diff.additions.length >= 5, `expected at least 5 specific additions, got ${draft.diff.additions.length}`);
      expect(draft.diff.removals.some((event: any) => event.id === "sat-block"), "explicit blocker replacement did not remove the owned conflict");
      const titles = draft.diff.additions.map((event: any) => String(event.title).toLowerCase()).join(" | ");
      expect(/magic kingdom|space mountain|pirates|haunted mansion/.test(titles), `plan lacked specific named activities: ${titles}`);
    });

    await runCase("ordinary conversation", async () => {
      const response = await agent("Hello. What kinds of calendar tasks can you help with?");
      expect(!response.draft && response.message.trim().length > 20, "ordinary conversation failed");
    });
  }

  console.log(`\nAgent acceptance PASSED (${full ? "full" : "core"} suite).`);
}

function makeEvent(localIso: (date: string, clock: string) => string, id: string, title: string, date: string, start: string, end: string, category: string) {
  return {
    id, provider: "local", providerEventId: id, calendarId: "acceptance", title,
    start: localIso(date, start), end: localIso(date, end), timezone: DEFAULT_TZ, allDay: false,
    availability: "busy", attendees: [], permissions: { canRead: true, canUpdate: true, canDelete: true }, updatedAt: NOW,
    category,
  };
}

function requireDraft(response: any) {
  if (!response.draft) throw new Error(`expected a draft, received: ${response.message}`);
  return response.draft;
}

function expectClock(iso: string, expected: string) {
  const actual = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  expect(actual === expected, `expected ${expected}, got ${actual}`);
}

function durationMinutes(event: any) {
  return Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000);
}

async function runCase(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error: any) => {
  console.error("\nAgent acceptance FAILED.");
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.code) console.error(`Code: ${error.code}`);
  if (error?.detail) console.error(`Detail: ${error.detail}`);
  process.exitCode = 1;
});