import { NextResponse } from "next/server";
import { CALENDAR_AGENT_VERSION } from "@/lib/build-version";

export async function GET() {
  return NextResponse.json({ version: CALENDAR_AGENT_VERSION });
}
