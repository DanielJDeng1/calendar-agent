import { Preference, PreferenceRule } from "../domain/types";

export function applyPreferenceUpdate(
  preferences: Preference[],
  input: { category: string; rule: PreferenceRule; explicit: boolean }
): Preference[] {
  const key = ruleKey(input.rule);
  const remaining = preferences.filter((preference) => ruleKey(preference.rule) !== key);
  const next: Preference = {
    id: `pref-${crypto.randomUUID()}`,
    category: input.category,
    rule: input.rule,
    priority: input.explicit ? 90 : 45,
    confidence: input.explicit ? 1 : 0.65,
    source: input.explicit ? "explicit" : "inferred",
    createdAt: new Date().toISOString(),
  };
  return [...remaining, next];
}

export function ruleKey(rule: PreferenceRule): string {
  const scope = "scope" in rule ? rule.scope ?? "meeting" : "calendar";
  switch (rule.type) {
    case "NOT_BEFORE": return `${scope}:not-before`;
    case "NOT_AFTER": return `${scope}:not-after`;
    case "PREFER_DAYPART": return `${scope}:daypart`;
    case "BUFFER_MINUTES": return "calendar:buffer";
    case "FREEFORM": return `freeform:${rule.text.toLowerCase()}`;
  }
}

export function describePreference(rule: PreferenceRule): string {
  switch (rule.type) {
    case "NOT_BEFORE": return `Do not schedule ${scopeLabel(rule.scope)} before ${formatClock(rule.time)}.`;
    case "NOT_AFTER": return `Do not schedule ${scopeLabel(rule.scope)} after ${formatClock(rule.time)}.`;
    case "PREFER_DAYPART": return `Prefer ${rule.daypart} times for ${scopeLabel(rule.scope)}.`;
    case "BUFFER_MINUTES": return `Keep ${rule.minutes} minutes of buffer when practical.`;
    case "FREEFORM": return rule.text;
  }
}

function scopeLabel(scope: "meeting" | "work" | "school" | "personal" | "any" | undefined): string {
  switch (scope) {
    case "work": return "work blocks";
    case "school": return "school blocks";
    case "personal": return "personal events";
    case "any": return "events";
    case "meeting":
    default: return "meetings";
  }
}

function formatClock(clock: string): string {
  const [hourValue, minute] = clock.split(":").map(Number);
  const ap = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${ap}`;
}