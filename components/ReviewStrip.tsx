"use client";

import { DraftState } from "@/lib/domain/types";

export function ReviewStrip({
  draft,
  onApply,
  onDiscard,
  isApplying = false,
}: {
  draft: DraftState;
  onApply: () => void;
  onDiscard: () => void;
  isApplying?: boolean;
}) {
  const count = draft.diff.additions.length + draft.diff.removals.length + draft.diff.modifications.length;
  
  return (
    <div className="reviewStrip" role="region" aria-label="Proposed calendar changes">
      <div className="reviewSummary">
        <strong>{count} pending {count === 1 ? "change" : "changes"}</strong>
        <span className="reviewDetail">{draft.summary}</span>
      </div>
      <div className="reviewActions">
        <button className="textButton" type="button" onClick={onDiscard} disabled={isApplying}>Discard</button>
        <button className="primaryButton" type="button" onClick={onApply} disabled={isApplying}>
          {isApplying ? "Applying…" : "Apply changes"}
        </button>
      </div>
    </div>
  );
}