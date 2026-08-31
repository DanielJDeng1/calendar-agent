"use client";

import { Preference } from "@/lib/domain/types";
import { describePreference } from "@/lib/preferences/resolve";

export function PreferencesPanel({ preferences, onClose, onReset }: { preferences: Preference[]; onClose: () => void; onReset: () => void }) {
  return (
    <aside className="preferencePanel" aria-label="Scheduling preferences">
      <div className="preferenceHeader">
        <h2>Preferences</h2>
        <button className="iconButton" type="button" onClick={onClose} aria-label="Close preferences">×</button>
      </div>
      <div className="preferenceBody">
        <p className="smallMeta">Persistent rules are visible here and saved with this browser workspace. The normal way to change them is through conversation.</p>
        {preferences.length ? preferences.map((p) => (
          <div className="preferenceItem" key={p.id}>
            <div className="preferenceItemTitle">{p.category.replaceAll("_", " ")}</div>
            <div className="preferenceItemRule">{describePreference(p.rule)}</div>
            <div className="preferenceMeta">{p.source} · priority {p.priority} · confidence {Math.round(p.confidence * 100)}%</div>
          </div>
        )) : <div className="emptyState">No persistent preferences yet.</div>}
        <div className="notice">Direct instructions such as “don’t schedule meetings before 10 AM” are saved immediately. Ambiguous sentiments should be confirmed before becoming persistent rules.</div>
        <div className="sidePanelSection">
          <h3>Local workspace</h3>
          <p className="panelHelp">Calendar events, chat history, preferences, and the active preview are stored in this browser.</p>
          <button className="dangerButton" type="button" onClick={onReset}>Reset local workspace</button>
        </div>
      </div>
    </aside>
  );
}
