import { loadEnvConfig } from "@next/env";

export function loadProjectEnv(): void {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}
