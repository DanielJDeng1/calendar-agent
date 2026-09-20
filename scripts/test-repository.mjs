import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

assert.ok(manifest.dependencies?.zod, "Zod is imported by the API routes but is missing from dependencies.");

let checked = 0;
for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
  for (const match of command.matchAll(/\b(?:node|tsx)\s+(scripts\/[\w./-]+\.(?:ts|mjs|js))\b/g)) {
    const scriptPath = match[1];
    assert.ok(existsSync(resolve(root, scriptPath)), `npm script ${scriptName} references missing file ${scriptPath}`);
    checked += 1;
  }
}

assert.ok(checked > 0, "No script file references were checked.");
console.log(`Repository consistency: checked ${checked} script file references and Zod dependency.`);
