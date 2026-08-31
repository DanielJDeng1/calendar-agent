# Calendar Agent

A Next.js app that converts natural language into structured calendar updates. OpenRouter parses intent into JSON, while scheduling logic and conflict checks run locally in TypeScript.

## Tech Stack

* **Framework:** Next.js (App Router)
* **Language:** TypeScript
* **Validation:** Zod
* **Styling:** Tailwind CSS
* **LLM Provider:** OpenRouter API

## Quick Start

### 1. Install dependencies

```powershell
npm install

```

### 2. Configure environment

```powershell
Copy-Item .env.example .env.local

```

Set your OpenRouter credentials in `.env.local`:

```text
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openrouter/free
PLANNER_DEBUG=true

```

If you have active PowerShell overrides from a previous session, clear them before starting:

```powershell
Remove-Item Env:OPENROUTER_MODEL -ErrorAction SilentlyContinue
Remove-Item Env:OPENROUTER_FALLBACK_MODELS -ErrorAction SilentlyContinue
Remove-Item Env:OPENROUTER_TIMEOUT_MS -ErrorAction SilentlyContinue

```

### 3. Start the app

```powershell
npm run dev:clean

```

Open `http://localhost:3000` in your browser.

---

## Testing & Diagnostics

```powershell
# Unit tests & type checks
npm run verify:local

# Diagnostic suite
npm run diagnose:config
npm run diagnose:provider
npm run diagnose:planner

# Integration tests
npm run acceptance:agent

```

To output raw execution traces and model latency to stdout, keep `PLANNER_DEBUG=true` enabled in `.env.local`.