import { NextResponse } from "next/server";
import { validateCommands } from "@/lib/calendar/validate";
import { simulateCommands, applyDiff } from "@/lib/calendar/simulate";
import { requiredApproval } from "@/lib/policy/approval";
import { applyRequestSchema } from "@/lib/domain/request-schemas";

// Best-effort duplicate suppression for a single process, NOT durable idempotency.
// Multi-instance operation requires an authoritative persistent store and a transaction.
const executedKeys = new Set<string>();

export async function POST(request: Request) {
  try {
    const { events, preferences, snapshotVersion, draft } = applyRequestSchema.parse(await request.json());
    if (draft.baseSnapshotVersion !== snapshotVersion || draft.commands.some((command) => command.expectedSnapshotVersion !== snapshotVersion)) {
      return NextResponse.json(
        { ok: false, code: "STALE_CALENDAR", message: "The calendar changed after this draft was created." },
        { status: 409 }
      );
    }

    if (requiredApproval(draft.commands) !== "EXPLICIT") {
      return NextResponse.json({ ok: false, code: "POLICY_ERROR", message: "Unexpected approval policy state." }, { status: 400 });
    }

    const validation = validateCommands(draft.commands, events, preferences);
    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, code: "VALIDATION_FAILED", message: validation.errors.join(" ") },
        { status: 409 }
      );
    }

    // Regenerate the diff from canonical commands instead of trusting the client-supplied diff.
    const revalidatedDraft = simulateCommands(draft.commands, events, snapshotVersion, draft.summary);
    const duplicate = draft.commands.every((command) => executedKeys.has(command.idempotencyKey));
    if (duplicate) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        events,
        snapshotVersion,
        message: "This command set was already applied.",
      });
    }

    const nextEvents = applyDiff(events, revalidatedDraft.diff);
    draft.commands.forEach((command) => executedKeys.add(command.idempotencyKey));

    return NextResponse.json({
      ok: true,
      duplicate: false,
      events: nextEvents,
      snapshotVersion: `snapshot-${crypto.randomUUID()}`,
      message: "The approved draft passed revalidation and was applied.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "The draft could not be applied safely." }, { status: 400 });
  }
}
