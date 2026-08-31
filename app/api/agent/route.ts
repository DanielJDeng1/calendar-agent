import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent/agent";
import { CALENDAR_AGENT_VERSION } from "@/lib/build-version";

const requestSchema = z.object({
  message: z.string().min(1).max(4000),
  events: z.array(z.any()),
  preferences: z.array(z.any()),
  snapshotVersion: z.string().min(1),
  now: z.string().optional(),
  conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(60).optional(),
  activeDraft: z.any().optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
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
