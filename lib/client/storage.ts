import { CalendarEvent, DraftState, Preference } from "../domain/types";
import type { ChatMessage } from "@/components/ChatPanel";

export type PersistedWorkspaceState = {
  schemaVersion: 3;
  events: CalendarEvent[];
  preferences: Preference[];
  messages: ChatMessage[];
  draft?: DraftState;
  snapshotVersion: string;
  view: "week" | "month";
  anchorDate: string;
  savedAt: string;
};

const STORAGE_KEY = "calendar-agent.workspace.v3";
const PRIOR_KEYS = ["calendar-agent.workspace.v2", "calendar-agent.workspace.v1"];
const LEGACY_SEEDED_EVENT_IDS = new Set(Array.from({ length: 11 }, (_, index) => `evt-${index + 1}`));
const LEGACY_SEEDED_PREFERENCE_IDS = new Set(["pref-1"]);

export function loadWorkspaceState(): PersistedWorkspaceState | undefined {
  if (typeof window === "undefined") return undefined;

  const current = readStoredState(STORAGE_KEY);
  if (current) return normalizeWorkspaceState(current);

  for (const key of PRIOR_KEYS) {
    const legacy = readStoredState(key);
    if (!legacy) continue;
    const migrated = normalizeWorkspaceState(legacy);
    if (!migrated) continue;
    saveWorkspaceState(migrated);
    for (const oldKey of PRIOR_KEYS) window.localStorage.removeItem(oldKey);
    return migrated;
  }
  return undefined;
}

export function saveWorkspaceState(state: PersistedWorkspaceState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not persist Calendar Agent local state", error);
  }
}

export function clearWorkspaceState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  for (const key of PRIOR_KEYS) window.localStorage.removeItem(key);
}

function readStoredState(key: string): Record<string, unknown> | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch (error) {
    console.warn(`Could not restore Calendar Agent local state from ${key}`, error);
    return undefined;
  }
}

function normalizeWorkspaceState(parsed: Record<string, unknown>): PersistedWorkspaceState | undefined {
  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) return undefined;
  if (!Array.isArray(parsed.events) || !Array.isArray(parsed.preferences) || !Array.isArray(parsed.messages)) return undefined;
  if (typeof parsed.snapshotVersion !== "string" || !parsed.snapshotVersion) return undefined;
  if (parsed.view !== "week" && parsed.view !== "month") return undefined;
  if (typeof parsed.anchorDate !== "string") return undefined;

  const events = (parsed.events as CalendarEvent[]).filter((event) => !LEGACY_SEEDED_EVENT_IDS.has(event.id));
  const preferences = (parsed.preferences as Preference[]).filter((preference) => !LEGACY_SEEDED_PREFERENCE_IDS.has(preference.id));

  return {
    schemaVersion: 3,
    events,
    preferences,
    messages: parsed.messages as ChatMessage[],
    draft: parsed.draft as DraftState | undefined,
    snapshotVersion: parsed.snapshotVersion,
    view: parsed.view,
    anchorDate: parsed.anchorDate,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
  };
}