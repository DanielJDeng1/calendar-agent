import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/agent";
import { CALENDAR_AGENT_VERSION } from "@/lib/build-version";
import { agentRequestSchema } from "@/lib/domain/request-schemas";

export async function POST(request: Request) {
  try {
    const body = agentRequestSchema.parse(await request.json());
    const result = await runAgent(body);
    return NextResponse.json(result, { headers: { "X-Calendar-Agent-Version": CALENDAR_AGENT_VERSION } });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "I couldn't process that request safely.", error: "INVALID_REQUEST" },
      { status: 400, headers: { "X-Calendar-Agent-Version": CALENDAR_AGENT_VERSION } },
    );
  }
}
