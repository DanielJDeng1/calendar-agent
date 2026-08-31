import { loadProjectEnv } from "./load-env";
loadProjectEnv();

async function main() {
  const { describeOpenRouterConfig } = await import("../lib/config/openrouter");
  const config = describeOpenRouterConfig();
  console.log("Calendar Agent configuration");
  console.log(`  API key:   ${config.apiKeyConfigured ? "configured" : "MISSING"}`);
  console.log(`  model:     ${config.model}`);
  console.log(`  fallbacks: ${config.fallbackModels.length ? config.fallbackModels.join(", ") : "<none>"}`);
  console.log(`  base URL:  ${config.baseUrl}`);
  console.log(`  timeout:   ${config.timeoutMs} ms`);
  console.log(`  maxTokens: ${config.maxTokens}`);
  if (!config.apiKeyConfigured) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
