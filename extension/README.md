# Koda

**Verification and memory for coding-agent workflows — right in your status bar.**

Koda watches your commits, runs focused checks on what actually changed, and remembers what keeps breaking. Works with Claude Code, Cursor, Codex, Gemini — any agent that speaks MCP or plain CLI.

---

## What it does

After you enable Koda for a workspace:

- Reads each **git diff**, classifies files (page / api / component / config / test)
- Runs **browser flows** through [Kane](https://testmu.ai/kane) (headless) on the affected UI only
- Runs **safe endpoint checks** (GET/HEAD/OPTIONS) on changed API routes
- Runs **scoped integration tests** (Jest / Vitest / Mocha) matched to changed files
- Produces a **JSON report** for agents and a **Markdown report** for you
- Remembers recurring failures in a per-project **memory** file and marks them resolved when a fix lands

Koda never writes code. It orchestrates verification, remembers patterns, and reports. If your app server isn't running, checks are marked **SKIPPED**, never faked as failures.

## Status bar

Koda lives in the bottom-left of your editor:

| Status | Meaning |
|---|---|
| `$(shield) Koda — click to enable` | Workspace not yet enabled |
| `$(sync~spin) Koda — verifying` | A run is in progress |
| `$(check) Koda 3` | 3 checks passed |
| `$(error) Koda 1` | 1 failing check |
| `$(circle-slash) Koda — app not running` | Verification skipped (server offline) |

Click it to open the latest report, enable Koda, or re-check setup.

## Commands

- **Koda: Enable for this project** (`koda.enable`)
- **Koda: Open latest report** (`koda.report`)
- **Koda: Open project memory** (`koda.memory`)

Nothing installs, initializes, or hooks **until you click Enable**.

## Requirements

- Node.js 18+
- Git
- The [`koda-verify`](https://www.npmjs.com/package/koda-verify) CLI (`npm install -g koda-verify`) — install once, optionally configure `GROQ_API_KEY` in `~/.koda/.env` for better impact analysis
- [Kane CLI](https://www.npmjs.com/package/@testmuai/kane) for browser flow verification (the extension onboards it when you enable)

## How it works under the hood in one command

```bash
claude mcp add koda -- npx -y koda-verify mcp
```

Agents calling Koda's MCP server (`koda_verify`, `koda_report`, `koda_memory`, `koda_setup_cicd`) supply their own impact analysis — so there's no per-call LLM cost for the most common path.

## Repository

Issues, source, and the CI template: [github.com/aabxtract/koda](https://github.com/aabxtract/koda)

**MIT © Koda contributors**
