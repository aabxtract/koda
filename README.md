<img src="extension/koda_logo.png" alt="Koda" width="80" height="80" style="border-radius:16px">

# Koda

**Verification and memory for coding-agent workflows.** Install once, verify the changes that matter, remember what keeps breaking.

---

| | |
|---|---|
| **npm** | `npm install -g koda-verify` ([npmjs.com](https://www.npmjs.com/package/koda-verify)) |
| **IDE** | [Open VSX](https://open-vsx.org/extension/koda-dev/koda) |
| **MCP** | [Registry](https://mcp.modelcontextprotocol.io/servers/io.github.aabxtract/koda) |
| **Landing** | [koda-verify.dev](https://aabxtract.github.io/koda/) |

---

## What it does

Koda sits between your coding agent and your CI. On every commit (or via MCP):

1. **Reads the git diff** — classifies files into api / page / component / config / test
2. **Picks focused checks** — agent-supplied via MCP, or Groq fallback, or deterministic heuristics
3. **Runs Kane browser flows** — headless, scoped to changed UI only
4. **Checks endpoints** — GET / HEAD / OPTIONS by default; regressions flagged (200 → 500)
5. **Runs scoped integration tests** — Jest / Vitest / Mocha, matched to changed files
6. **Reports** — JSON for agents, Markdown for humans
7. **Remembers** — recurring patterns, resolution history, time-to-fix

## Quick start

```bash
npm install -g koda-verify
cd your-project
koda init
koda doctor
```

For local development, clone the repository and use `npm install` followed by `npm link`.

Koda keeps existing hooks, backs them up before appending, and defaults HTTP verification to read-only methods. If the app is not running, browser and endpoint checks are marked `SKIPPED`.

## Agent integration (MCP)

```bash
claude mcp add koda -- npx -y koda-verify mcp
```

In a development checkout this also works as `claude mcp add koda node /absolute/path/to/koda/mcp/server.js`.

The MCP server exposes `koda_verify`, `koda_report`, `koda_memory`, and `koda_setup_cicd`. Agent-supplied flows are preferred; Groq is a fallback when no impact analysis is supplied.

## Environment variables

Optional — Koda works without any of these:

```bash
# ~/.koda/.env  (global)  or  project/.env  (per-project)
GROQ_API_KEY=        # better impact analysis (Groq fallback)
KODA_TEST_TOKEN=     # bearer token for authenticated endpoint checks
TELEGRAM_BOT_TOKEN=  # notifications
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
```

## Kane CLI (browser verification)

Koda uses [Kane](https://www.npmjs.com/package/@testmuai/kane) as its browser verification engine. Kane must be installed and authenticated for browser flow checks:

```bash
npm install -g @testmuai/kane
kane-cli login
```

Without Kane, browser flows degrade gracefully — endpoint checks, integration tests, memory, and reports all still work.

## Development

```bash
npm run check
npm test
```

See [koda-v3-build-guide.md](./koda-v3-build-guide.md) for the full implementation contract.

## License

MIT
