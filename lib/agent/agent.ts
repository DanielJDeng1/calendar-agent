import { AgentRequestPayload, AgentResponsePayload } from "../domain/types";
import { planUserRequestWithMeta, PlannerError } from "./planner";
import { executeAgentDecision } from "./executor";

export async function runAgent(input: AgentRequestPayload): Promise<AgentResponsePayload> {
  const nowIso = input.now ?? new Date().toISOString();
  const requestStarted = Date.now();
  try {
    const planned = await planUserRequestWithMeta({
      message: input.message,
      events: input.events,
      preferences: input.preferences,
      nowIso,
      conversation: input.conversation ?? [],
      activeDraft: input.activeDraft,
    });
    debug(planned.meta.traceId, "agent.decision", {
      kind: planned.decision.kind,
      summary: planned.decision.intentSummary,
      operations: planned.decision.kind === "calendar_mutation" ? planned.decision.operations.map((operation) => operation.type) : [],
      policy: planned.decision.kind === "calendar_mutation" ? planned.decision.conflictPolicy : undefined,
    });

    const response = executeAgentDecision(planned.decision, input, nowIso);
    debug(planned.meta.traceId, "agent.execution_result", {
      elapsedMs: Date.now() - requestStarted,
      hasDraft: Boolean(response.draft),
      additions: response.draft?.diff.additions.length ?? 0,
      modifications: response.draft?.diff.modifications.length ?? 0,
      removals: response.draft?.diff.removals.length ?? 0,
      autoApplyDraft: Boolean(response.autoApplyDraft),
      status: response.status ?? [],
      messagePreview: response.message.slice(0, 500),
    });
    return response;
  } catch (error) {
    const trace = error instanceof PlannerError ? traceFromDetail(error.detail) : undefined;
    debug(trace ?? "untracked", "agent.failure", {
      elapsedMs: Date.now() - requestStarted,
      code: error instanceof PlannerError ? error.code : "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
      detail: error instanceof PlannerError ? error.detail ?? "" : "",
    });
    return plannerFailure(error);
  }
}

function plannerFailure(error: unknown): AgentResponsePayload {
  if (!(error instanceof PlannerError)) {
    console.error("Planner failed", error);
    return { message: "Could not process request reliably. No changes made.", status: ["Planner error: UNKNOWN"] };
  }
  if (error.code === "NOT_CONFIGURED") return { message: `${error.message} No changes made.`, status: ["Planner error: NOT_CONFIGURED"] };
  if (error.code === "AUTH") return { message: "Authentication with the service failed. No changes made.", status: ["Planner error: AUTH"] };
  if (error.code === "RATE_LIMIT") return { message: "The service is temporarily rate-limited. No changes made.", status: ["Planner error: RATE_LIMIT"] };
  if (error.code === "TIMEOUT") return { message: "The service timed out. No changes made.", status: ["Planner error: TIMEOUT"] };
  if (error.code === "NETWORK") return { message: "Network connection failed. No changes made.", status: ["Planner error: NETWORK"] };
  if (error.code === "NO_CONTENT") return { message: "Received an empty response. No changes made.", status: ["Planner error: NO_CONTENT"] };
  if (error.code === "OUTPUT_LIMIT") return { message: "Response length limit reached. No changes made.", status: ["Planner error: OUTPUT_LIMIT"] };
  if (error.code === "PROVIDER") return { message: "Service failed to complete request. No changes made.", status: ["Planner error: PROVIDER"] };
  return { message: "Could not complete request. No changes made.", status: [`Planner error: ${error.code}`] };
}

function traceFromDetail(detail?: string): string | undefined {
  return detail?.match(/trace=([a-f0-9-]+)/i)?.[1];
}

function debug(traceId: string, stage: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production" && !/^(1|true|yes)$/i.test(process.env.PLANNER_DEBUG ?? "")) return;
  console.info(`[Debug] ${JSON.stringify({ traceId, stage, at: new Date().toISOString(), ...data })}`);
}