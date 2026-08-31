<img src="extension/koda_logo.png" alt="Koda" width="80" height="80" style="border-radius:16px">

# Koda

**Verification and memory for coding-agent workflows.** Install once, verify the changes that matter, remember what keeps breaking.

![npm](https://img.shields.io/npm/v/koda-verify) ![npm downloads](https://img.shields.io/npm/dt/koda-verify) ![Open VSX downloads](https://img.shields.io/open-vsx/dt/koda-dev/koda) ![license](https://img.shields.io/badge/license-MIT-green)

> **1,000+ downloads on Open VSX** — Koda is already watching commits in editors around the world.

---

| | |
|---|---|
| **npm** | `npm install -g koda-verify` ([npmjs.com](https://www.npmjs.com/package/koda-verify)) |
| **IDE** | [Open VSX](https://open-vsx.org/extension/koda-dev/koda) — works in VS Code, Cursor, Windsurf, VSCodium |
| **MCP** | [Registry](https://mcp.modelcontextprotocol.io/servers/io.github.aabxtract/koda) |
| **Landing** | [aabxtract.github.io/koda](https://aabxtract.github.io/koda/) |

## Why Koda exists

Coding agents write features in minutes — but who verifies every commit? Full test suites are too slow to run per commit, so most verification happens late (or never). Koda closes that gap: **on every commit it verifies only what changed**, in seconds-to-minutes, and remembers what keeps breaking so your agent stops reintroducing old bugs.

Koda never writes code. It orchestrates verification, remembers patterns, and reports — to both the human and the agent.

## The three surfaces

| Surface | Responsibility | Activation |
|---|---|---|
| **Core + CLI** | Verification, reports, memory, git hooks, CI generation | `koda init`, `koda run` |
| **MCP server** | Agents call `koda_verify` / `koda_report` / `koda_memory` / `koda_setup_cicd` | MCP client configuration |
| **IDE extension** | Ambient status bar, report viewer, one-click enable, Git watching | User clicks Enable |

## How it works — the pipeline

```
git commit
   │
   ▼
pre-commit ── secret guard (blocks committed API keys / private keys)
   │
   ▼
post-commit ── koda run (background, never blocks you)
   │
   ▼
1. Read diff ──────────── classify files: api / page / component / lib / config / test
2. Impact analysis ────── agent-supplied (MCP) → Groq fallback → deterministic heuristics
3. Kane browser flows ─── headless, scoped to changed UI only (page/component changes)
4. Endpoint checks ────── GET / HEAD / OPTIONS only; regressions flagged (200 → 500)
5. Integration tests ──── Jest / Vitest / Mocha / node:test, matched to changed files
6. Report ─────────────── JSON (agent-readable) + Markdown (human-readable)
7. Memory ─────────────── recurring patterns, resolution history, time-to-fix
```

Most commits never launch a browser: API/config/test-only changes verify with endpoints + tests in **seconds**. Browser flows fire only when UI files change.

---

## Quick start

```bash
npm install -g koda-verify
cd your-project
koda init        # creates .koda/, installs git hooks, detects your app's port
koda doctor      # verifies: git, config, Kane CLI, target URL, directories
```

Then just keep committing — verification runs in the background on every commit.

### One-time browser setup (optional, per user)

Browser flows are powered by the [Kane CLI](https://www.npmjs.com/package/@testmuai/kane). The **IDE extension onboards it for you**: click *Enable* and Koda offers to install Kane and connect your account. Or do it manually:

```bash
npm install -g @testmuai/kane-cli
kane-cli login --oauth        # opens your browser — use (or create) YOUR OWN Kane account
```

### About Kane accounts — yours, not ours

Koda ships **zero credentials**. Every Koda user authenticates their **own** Kane account:

- The extension's OAuth flow opens the Kane login in *your* browser; new users register there
- Your session lives locally in `~/.testmuai/` on your machine — never synced, never proxied
- Browser-flow credits come from *your* Kane account, not the developer's
- In CI, each repo configures its own `KANE_USERNAME` / `KODA_ACCESS_KEY`-style secrets

**No Kane? No problem.** Koda runs in degraded mode: endpoint checks, integration tests, memory, and reports all work; browser flows are honestly marked `SKIPPED` — never faked.

---

## Target URLs — localhost, LAN, or hosted

Koda verifies whatever your app points at. The default is auto-detected at `koda init` (probes common dev ports: 3000, 5173, 8080, 8000, 4200, 5000…). Override it three ways:

```bash
koda target https://myapp.vercel.app      # permanent — hosted URL, https auto-detected
koda target 192.168.1.5:8080              # LAN IP, http auto-detected
koda run --target https://preview-123.example.com   # one-off run
KODA_TARGET=https://staging.example.com   # per-session / CI via env
```

Precedence: `--target` flag → `KODA_TARGET` env → `.koda/config.json` → auto-detected default.

## CLI reference

| Command | What it does |
|---|---|
| `koda init [--force]` | Create `.koda/`, install non-destructive git hooks, detect target |
| `koda run [--project <path>] [--commit <sha>] [--target <url>] [--max-flows <n>]` | Verify a commit now |
| `koda report` | Show the latest report |
| `koda memory` | Dump project memory (patterns, history, fixes) |
| `koda target <url>` | Validate, save, and health-check a new target URL |
| `koda cicd [--force]` | Generate a validated GitHub Actions workflow (refuses overwrite) |
| `koda doctor [--kane]` | Environment check; `--kane` empirically probes the Kane schema |
| `koda mcp` | Start the MCP server (stdio) |

## Agent integration (MCP)

```bash
claude mcp add koda -- npx koda-verify mcp
```

Works with any MCP client: Claude Code, Cursor, Codex, Gemini CLI, Windsurf, Zed. In a development checkout: `claude mcp add koda node /absolute/path/to/koda/mcp/server.js`.

### MCP tools

| Tool | Purpose |
|---|---|
| `koda_verify` | Run focused verification. The agent **supplies its own impact analysis** (`flows`, `endpoints`, `target`, `commit`, `max_flows`) — it already read your code, so no LLM cost and no guessing. Groq is only a fallback for non-MCP runs |
| `koda_report` | Latest full JSON report — verdicts, coverage, evidence paths |
| `koda_memory` | Project memory — recurring failures, fix confidence, time-to-fix |
| `koda_setup_cicd` | Generate a validated GitHub Actions workflow |

### The agent loop

```
agent edits code → commits → hook fires koda run → report written
→ agent calls koda_verify (its own flows) / koda_report via MCP
→ reads the verdict → fixes what failed → commits again
→ memory marks the failure RESOLVED (with time-to-fix recorded)
```

Reports record `analysis_source: 'agent'` when the agent supplied flows — verifiable proof the loop is agent-driven.

---

## Reports

Every run writes a timestamped pair to `.koda/reports/`:

```
.koda/reports/2026-08-30T14-35-28-909Z-9416b29.json   ← agent-readable
.koda/reports/2026-08-30T14-35-28-909Z-9416b29.md     ← human-readable
```

The JSON includes: commit metadata, `analysis_source` (`agent` / `llm-fallback` / `fallback`), risk level, per-check results with evidence file paths, memory context (similar failures, patterns, fix confidence), and `action_required` with priority and suggested focus. Markdown renders PASS / FAIL / SKIPPED distinctly with coverage status.

Raw Kane session events are preserved per-flow under `.koda/evidence/`.

## Memory — remembers what keeps breaking

- Every failed check gets a **stable key**; failures that recur 2+ times become **patterns**
- When a fix lands and the check passes, the failure is marked **resolved** with `time_to_fix_ms`
- Coverage-gap findings ("no tests cover `app/page.js`") resolve automatically once a passing test covers those files
- Skipped checks (app offline) never pollute memory
- Writes are atomic; corrupt memory files are quarantined, not deleted

## Safety guarantees

- **Non-destructive hooks** — existing pre-commit/post-commit/pre-push hooks are backed up before appending; Husky respected; idempotent via marker
- **Read-only HTTP by default** — only GET / HEAD / OPTIONS; mutating methods require explicit opt-in (`allow_mutating_methods: true`) plus agent-declared endpoints
- **Honest results** — if the app is down, checks are `SKIPPED`, never reported as failures; skipped checks never enter memory
- **No secrets shipped** — the package contains zero credentials; the pre-commit guard blocks accidentally committed keys

## CI/CD

```bash
koda cicd
```

Generates `.github/workflows/koda.yml` from a validated template: Node setup, `npm ci`, build-if-present, Kane CLI install + auth via GitHub secrets (`KANE_USERNAME`, `KANE_ACCESS_KEY`), app start, wait-on target, `koda run --commit ${{ github.sha }}`. Template-first — no LLM-generated YAML. Refuses to overwrite without `--force`.

---

## Configuration reference (`.koda/config.json`)

```json
{
  "kane": {
    "target": "http://localhost:3000",
    "headless": true,
    "max_steps": 30,
    "timeout_ms": 300000
  },
  "tests": {
    "browser_flows": true,
    "endpoint_tests": true,
    "integration_tests": true,
    "allow_mutating_methods": false,
    "expected_statuses": { "GET /api/health": [200] }
  },
  "notify": { "telegram": false, "discord": false }
}
```

## Environment variables

Optional — Koda works without any of these. Loaded from the project `.env`, falling back to `~/.koda/.env` (configure once, use everywhere):

```bash
GROQ_API_KEY=        # Groq fallback impact analysis (agent runs skip this entirely)
KODA_TARGET=         # override target URL (flag > env > config)
KODA_TEST_TOKEN=     # bearer token for authenticated endpoint checks
KODA_PROJECT=        # default project path for CLI/MCP
TELEGRAM_BOT_TOKEN=  # notifications
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
```

## Development

```bash
npm install
npm run check    # syntax-check all sources
npm test         # node:test suite
npm link         # local koda binary for development
```

See [koda-v3-build-guide.md](./koda-v3-build-guide.md) for the full implementation contract.

## License

MIT
