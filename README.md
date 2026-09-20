# Calendar Agent

A local-first Next.js calendar assistant. OpenRouter interprets natural-language requests into structured commands; TypeScript validates and simulates proposed changes before the user approves them. Calendar data is saved in the browser's local storage.

## Stack

- Next.js (App Router), React, TypeScript
- Zod request validation
- CSS for the interface
- OpenRouter API for natural-language planning

## Set up (Windows PowerShell)

Requires Node.js and npm. From the repository root:

```powershell
npm install
Copy-Item .env.example .env.local
```

Edit `.env.local` and set a real `OPENROUTER_API_KEY` and the model you intend to use. Do not commit this file or your key.

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Verification

Run checks that do not contact the language-model provider:

```powershell
npm run verify:local
npm run build
```

`verify:local` checks that package scripts reference existing files, type-checks the app and core modules, and runs deterministic calendar validation/simulation smoke tests. The repository has no checked-in dependency lockfile; `npm install` resolves dependency versions locally. Commit a generated lockfile after checking a clean installation if you need reproducible deployments.

The following diagnostics are available:

```powershell
npm run diagnose:config
npm run diagnose:provider
npm run diagnose:planner
```

The live acceptance harness uses a configured OpenRouter key and makes real provider requests. It is **not** part of `verify:local`:

```powershell
npm run acceptance:agent
npm run acceptance:agent:full
```

Set `PLANNER_DEBUG=true` in `.env.local` to print planner traces during development.

## Current limits

This is a local-first prototype, not a production multi-user calendar backend. The browser supplies calendar state to the API; its snapshot version is not independently checked against a server-owned database. The apply route also uses an in-memory set for best-effort duplicate suppression, which is lost on restart and is not shared between instances. Neither mechanism guarantees conflict-free concurrent edits or durable exactly-once execution. Those guarantees require authoritative persistent state and transactional apply/idempotency handling before a multi-user deployment. Tests verify selected core behaviors, not every possible model response.
