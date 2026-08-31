import { DEFAULT_TZ } from "../lib/calendar/date";
import { loadProjectEnv } from "./load-env";
loadProjectEnv();

const NOW = new Date().toISOString();
const full = process.argv.includes("--full");

async function main() {
  const [{ getOpenRouterConfig }, { planUserRequestWithMeta }, { localIso }] = await Promise.all([
    import("../lib/config/openrouter"),
    import("../lib/agent/planner"),
    import("../lib/calendar/date"),
  ]);
  const config = getOpenRouterConfig();
  if (!config.apiKey) throw new Error("OPENROUTER_API_KEY is not loaded from .env.local/.env or the environment.");

  console.log(`Planner diagnostic: ${config.model} via ${config.baseUrl}`);
  console.log(`Fallbacks: ${config.fallbackModels.length ? config.fallbackModels.join(", ") : "<none>"}`);
  console.log(`Timeout: ${config.timeoutMs} ms | Max tokens: ${config.maxTokens}`);

  const today = new Date();
  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  const addDays = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d;
  };

  const todayStr = formatDate(today);
  const tomorrowStr = formatDate(addDays(1));
  const weekEndStr = formatDate(addDays(6));

  const getNextDayOfWeek = (dayOfWeek: number) => {
    const d = new Date(today);
    const diff = (dayOfWeek + 7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  };

  const fridayStr = formatDate(getNextDayOfWeek(5));

  const chemistry = {
    id: "chem-1", provider: "local" as const, providerEventId: "chem-1", calendarId: "diag",
    title: "Chemistry Study Session", start: localIso(tomorrowStr, "08:00"), end: localIso(tomorrowStr, "09:00"),
    timezone: DEFAULT_TZ, allDay: false, availability: "busy" as const, attendees: [],
    permissions: { canRead: true, canUpdate: true, canDelete: true }, updatedAt: NOW, category: "school" as const,
  };

  const cases = [
    {
      name: "exact single event",
      message: `Schedule a chemistry study session on ${tomorrowStr} from 8:00 AM to 9:00 AM.`,
      events: [],
      assert(decision: any) {
        const op = decision.kind === "calendar_mutation" ? decision.operations[0] : undefined;
        return op?.type === "create_event" && op.targetDate === tomorrowStr && op.exactStart === "08:00";
      },
    },
    {
      name: "seven-day gym series",
      message: "Please add 1 hour of gym every day for the week.",
      events: [],
      assert(decision: any) {
        const op = decision.kind === "calendar_mutation" ? decision.operations[0] : undefined;
        return decision.operations?.length === 1 && op?.type === "create_series" && op.dateRange?.start === todayStr && op.dateRange?.end === weekEndStr && op.recurrence === "daily" && op.durationMinutes === 60;
      },
    },
    {
      name: "date-only move",
      message: "move my chem study event to friday",
      events: [chemistry],
      assert(decision: any) {
        const op = decision.kind === "calendar_mutation" ? decision.operations[0] : undefined;
        return op?.type === "move_event" && (op.targetEventId === "chem-1" || /chem/i.test(op.targetEventTitle ?? "")) && op.targetDate === fridayStr && op.exactStart === undefined && op.durationMinutes === undefined;
      },
    },
  ];

  if (full) {
    cases.push({
      name: "full-day specific itinerary",
      message: "Plan a full day of Disney fun on Saturday from 8 AM to 9 PM. Remove my events in the way and make multiple specific calendar events including Magic Kingdom, Space Mountain, Pirates of the Caribbean, Haunted Mansion, and a meal stop.",
      events: [],
      assert(decision: any) {
        if (decision.kind !== "calendar_mutation" || decision.conflictPolicy !== "replace_owned" || !decision.coordinated) return false;
        const creates = decision.operations.filter((op: any) => op.type === "create_event");
        return creates.length >= 5 && creates.some((op: any) => /space mountain|pirates|haunted mansion|magic kingdom/i.test(op.title ?? ""));
      },
    });
  }

  for (const test of cases) {
    const result = await planUserRequestWithMeta({ message: test.message, events: test.events, preferences: [], nowIso: NOW, conversation: [] });
    if (!test.assert(result.decision)) throw new Error(`${test.name}: semantic assertion failed. Decision=${JSON.stringify(result.decision)}`);
    console.log(`PASS  ${test.name} | trace=${result.meta.traceId} | routed=${result.meta.routedModel} | ${result.meta.latencyMs} ms | semanticAttempts=${result.meta.semanticAttempts}`);
  }
  console.log("\nPlanner diagnostic PASSED.");
}

main().catch((error: any) => {
  console.error("\nPlanner diagnostic FAILED.");
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.code) console.error(`Code: ${error.code}`);
  if (error?.detail) console.error(`Detail: ${error.detail}`);
  process.exitCode = 1;
});