import { loadProjectEnv } from "./load-env";
loadProjectEnv();

async function main() {
  const { getOpenRouterConfig } = await import("../lib/config/openrouter");
  const config = getOpenRouterConfig();
  if (!config.apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const response = await fetch(`${config.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenRouter /models failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text) as { data?: Array<Record<string, any>> };
  const models = Array.isArray(payload.data) ? payload.data : [];
  const configured = [config.model, ...config.fallbackModels];

  console.log("OpenRouter configured-model diagnostic");
  for (const id of configured) {
    const entry = models.find((model) => model.id === id);
    if (!entry) {
      console.log(`  ${id}: missing from /models catalog (alias/router endpoint may still resolve)`);
      continue;
    }
    const supported = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
    const price = entry.pricing ?? {};
    const structured = supported.includes("response_format") || supported.includes("structured_outputs");
    console.log(`  ${id}`);
    console.log(`    structured outputs: ${structured ? "YES" : "NO"}`);
    console.log(`    pricing (in/out): ${price.prompt ?? "?"} / ${price.completion ?? "?"}`);
    console.log(`    context limit: ${entry.context_length ?? "?"}`);
  }
}

main().catch((error) => {
  console.error(`Provider diagnostic FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});