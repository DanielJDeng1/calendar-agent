"use client";

import { useEffect, useMemo, useState } from "react";
import { ChatPanel, ChatMessage, ComposerPrompt } from "@/components/ChatPanel";
import { WeekCalendar } from "@/components/WeekCalendar";
import { MonthCalendar } from "@/components/MonthCalendar";
import { ReviewStrip } from "@/components/ReviewStrip";
import { PreferencesPanel } from "@/components/PreferencesPanel";
import { EventDetailsPanel } from "@/components/EventDetailsPanel";
import { QuickAddPanel } from "@/components/QuickAddPanel";
import { AgentResponsePayload, CalendarEvent, DraftState, Preference } from "@/lib/domain/types";
import { addDays, addMonths, datePartInTimezone, DEFAULT_TZ, prettyDate, startOfWeek } from "@/lib/calendar/date";
import { clearWorkspaceState, loadWorkspaceState, saveWorkspaceState } from "@/lib/client/storage";


type CalendarView = "week" | "month";

async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown content type";
    throw new Error(`The server returned HTTP ${response.status} as ${contentType} instead of JSON.`);
  }
}

export function CalendarWorkspace() {
  const initialNow = useMemo(() => new Date().toISOString(), []);
  const todayDate = useMemo(() => datePartInTimezone(initialNow), [initialNow]);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [draft, setDraft] = useState<DraftState | undefined>();
  const [snapshotVersion, setSnapshotVersion] = useState("snapshot-initial-1");
  const [isThinking, setIsThinking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>();
  const [quickAdd, setQuickAdd] = useState<{ date: string; time: string } | undefined>();
  const [composerPrompt, setComposerPrompt] = useState<ComposerPrompt | undefined>();
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(todayDate);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Tell me what you need. I can schedule, update, clear events, and build itineraries. Changes remain staged until you confirm.",
      createdAt: initialNow,
      suggestions: [
        "Schedule a one-hour focus session Monday afternoon",
        "Plan several errands efficiently this weekend",
        "Make tomorrow less fragmented",
      ],
    },
  ]);

  useEffect(() => {
    const restored = loadWorkspaceState();
    if (restored) {
      setEvents(restored.events);
      setPreferences(restored.preferences);
      setMessages(restored.messages.length ? restored.messages : messages);
      setDraft(restored.draft);
      setSnapshotVersion(restored.snapshotVersion);
      setView(restored.view);
      setAnchorDate(restored.anchorDate);
    }
    setIsHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    saveWorkspaceState({
      schemaVersion: 3,
      events,
      preferences,
      messages: messages.slice(-100),
      draft,
      snapshotVersion,
      view,
      anchorDate,
      savedAt: new Date().toISOString(),
    });
  }, [isHydrated, events, preferences, messages, draft, snapshotVersion, view, anchorDate]);

  const calendarLabel = useMemo(() => {
    if (view === "month") {
      return prettyDate(`${anchorDate.slice(0, 7)}-01`, { month: "long", year: "numeric" });
    }
    const monday = startOfWeek(anchorDate);
    const sunday = addDays(monday, 6);
    const start = new Date(`${monday}T12:00:00Z`);
    const end = new Date(`${sunday}T12:00:00Z`);
    const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
    const startLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(start);
    const endLabel = new Intl.DateTimeFormat("en-US", sameMonth ? { day: "numeric", year: "numeric" } : { month: "long", day: "numeric", year: "numeric" }).format(end);
    return `${startLabel}–${endLabel}`;
  }, [anchorDate, view]);

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || isThinking) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text: clean, createdAt: new Date().toISOString() };
    const conversation = messages
      .slice(-12)
      .map((message) => ({ role: message.role, content: message.text }));

    setMessages((current) => [...current, userMessage]);
    setIsThinking(true);
    setQuickAdd(undefined);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          events,
          preferences,
          snapshotVersion,
          now: new Date().toISOString(),
          conversation,
          activeDraft: draft,
        }),
      });

      const data = await readApiJson<AgentResponsePayload>(response);
      if (!response.ok) throw new Error(data.message || "Request failed");

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: data.message,
        createdAt: new Date().toISOString(),
        suggestions: data.preferenceSuggestion ? [data.preferenceSuggestion.suggestedMessage] : undefined,
      };

      setMessages((current) => [...current, assistantMessage]);
      if (data.updatedPreferences) setPreferences(data.updatedPreferences);
      if (data.clearDraft) setDraft(undefined);
      if (data.draft) {
        setDraft(data.draft);
        focusDraft(data.draft);
        if (data.autoApplyDraft) {
          await applyDraftObject(data.draft);
        }
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: error instanceof Error ? `I couldn't complete that planning request. ${error.message}` : "I couldn't complete that planning request. Your calendar was not changed.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  async function applyDraft() {
    if (!draft || isApplying) return;
    await applyDraftObject(draft);
  }

  async function applyDraftObject(targetDraft: DraftState) {
    if (isApplying) return;
    setIsApplying(true);
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events, preferences, snapshotVersion, draft: targetDraft }),
      });
      const result = await readApiJson<{ ok: boolean; message?: string; code?: string; events: CalendarEvent[]; snapshotVersion: string; duplicate?: boolean }>(response);
      
      if (!response.ok || !result.ok) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: result.message ?? "That draft failed final revalidation, so nothing was changed.",
            createdAt: new Date().toISOString(),
          },
        ]);
        if (result.code === "STALE_CALENDAR") setDraft(undefined);
        return;
      }

      setEvents(result.events);
      setSnapshotVersion(result.snapshotVersion);
      setSelectedEvent(undefined);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.duplicate ? "That exact change had already been applied, so I did not duplicate it." : "Applied. The calendar was revalidated immediately before the change was committed.",
          createdAt: new Date().toISOString(),
        },
      ]);
      setDraft(undefined);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Final revalidation could not complete, so the calendar was left unchanged.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsApplying(false);
    }
  }

  function focusDraft(nextDraft: DraftState) {
    const focus = nextDraft.diff.additions[0]?.start ?? nextDraft.diff.modifications[0]?.after.start ?? nextDraft.diff.removals[0]?.start;
    if (focus) setAnchorDate(datePartInTimezone(focus));
  }

  function movePeriod(direction: -1 | 1) {
    setSelectedEvent(undefined);
    setQuickAdd(undefined);
    setAnchorDate((current) => (view === "week" ? addDays(current, direction * 7) : addMonths(current, direction)));
  }

  function goToday() {
    setAnchorDate(todayDate);
    setSelectedEvent(undefined);
    setQuickAdd(undefined);
  }

  function selectEvent(event: CalendarEvent) {
    setSelectedEvent(event);
    setPreferencesOpen(false);
    setQuickAdd(undefined);
  }

  function askFromPanel(prompt: string, sendImmediately = false) {
    setSelectedEvent(undefined);
    if (sendImmediately) {
      void sendMessage(prompt);
      return;
    }
    setComposerPrompt({ id: crypto.randomUUID(), text: prompt });
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">C</span>
          <span>Calendar Workspace</span>
        </div>

        <div className="calendarToolbar">
          <div className="periodControls">
            <button className="iconButton" type="button" aria-label={view === "week" ? "Previous week" : "Previous month"} onClick={() => movePeriod(-1)}>‹</button>
            <button className="textButton" type="button" onClick={goToday}>Today</button>
            <button className="iconButton" type="button" aria-label={view === "week" ? "Next week" : "Next month"} onClick={() => movePeriod(1)}>›</button>
          </div>
          <div className="calendarTitle">{calendarLabel}</div>
          <div className="viewSwitch" aria-label="Calendar view">
            <button type="button" className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Week</button>
            <button type="button" className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Month</button>
          </div>
        </div>

        <div className="headerActions">
          <span className="timezoneLabel">{isHydrated ? "Saved locally · " : "Loading · "}{DEFAULT_TZ}</span>
          <button
            className="textButton"
            type="button"
            onClick={() => {
              setPreferencesOpen(true);
              setSelectedEvent(undefined);
              setQuickAdd(undefined);
            }}
          >
            Preferences ({preferences.length})
          </button>
        </div>
      </header>

      <section className="mainSplit">
        <ChatPanel messages={messages} onSend={sendMessage} isThinking={isThinking || !isHydrated} composerPrompt={composerPrompt} />
        {view === "week" ? (
          <WeekCalendar
            events={events}
            draft={draft}
            anchorDate={anchorDate}
            todayDate={todayDate}
            selectedEventId={selectedEvent?.id}
            onSelectEvent={selectEvent}
            onSelectSlot={(date, time) => {
              setQuickAdd({ date, time });
              setSelectedEvent(undefined);
              setPreferencesOpen(false);
            }}
          />
        ) : (
          <MonthCalendar
            events={events}
            draft={draft}
            anchorDate={anchorDate}
            todayDate={todayDate}
            selectedEventId={selectedEvent?.id}
            onSelectEvent={selectEvent}
            onSelectDay={(date) => {
              setAnchorDate(date);
              setView("week");
            }}
          />
        )}
      </section>

      {draft && (
        <ReviewStrip
          draft={draft}
          isApplying={isApplying}
          onApply={applyDraft}
          onDiscard={() => {
            setDraft(undefined);
            setSelectedEvent(undefined);
          }}
        />
      )}

      {preferencesOpen && (
        <PreferencesPanel
          preferences={preferences}
          onClose={() => setPreferencesOpen(false)}
          onReset={() => {
            if (!window.confirm("Reset locally saved calendar events, chat history, preferences, and drafts?")) return;
            clearWorkspaceState();
            window.location.reload();
          }}
        />
      )}

      {selectedEvent && (
        <EventDetailsPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(undefined)}
          onAsk={askFromPanel}
        />
      )}

      {quickAdd && (
        <QuickAddPanel
          date={quickAdd.date}
          time={quickAdd.time}
          onClose={() => setQuickAdd(undefined)}
          onCreate={(prompt) => {
            setQuickAdd(undefined);
            void sendMessage(prompt);
          }}
        />
      )}
    </main>
  );
}