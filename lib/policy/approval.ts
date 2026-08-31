import { CalendarCommand } from "@/lib/domain/types";

export type ApprovalLevel = "NONE" | "SOFT" | "EXPLICIT";

export function requiredApproval(commands: CalendarCommand[]): ApprovalLevel {
  if (!commands.length) return "NONE";

  return "EXPLICIT";
}