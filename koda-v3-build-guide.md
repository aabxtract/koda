# Koda v3 — Build Guide

## Product promise

Koda is a verification and memory layer for coding-agent workflows. After it is enabled for a project, it examines each commit, identifies checks relevant to the changed files, runs safe verification, and produces an agent-readable JSON report plus a human-readable Markdown report.

The promise is deliberately narrow and testable:

- Koda verifies relevant changes; it does not claim to test the entire application.
- Koda never sends logs to MCP stdout, never silently overwrites existing hooks, and never performs mutating HTTP requests unless explicitly enabled.
- If the app is unavailable, browser and endpoint checks are reported as `skipped`, not fake failures.
- Koda remembers recurring failures and later marks them resolved when the same check passes.
- Agents can provide their own impact analysis through MCP. Groq is a fallback for hook and manual CLI runs.

The project has three surfaces and one engine:

| Surface | Responsibility | Activation |
|---|---|---|
| Core + CLI | Verification, reports, memory, hooks, CI | `koda init`, `koda run` |
| MCP server | Agent access to verification, reports, memory | MCP client configuration |
| IDE extension | Status bar, report viewing, opt-in Git watching | User clicks Enable |

The extension is an optional wrapper. It does not duplicate verification logic and does not install hooks without consent.

---

## 1. Requirements and pre-flight

Required:

- Node.js 18 or newer
- npm
- Git
- Kane CLI and a valid Kane account

Optional:

- `GROQ_API_KEY` for fallback impact analysis
- Telegram or Discord credentials for notifications
- `KODA_TEST_TOKEN` for authenticated read-only endpoint checks

Python is not required by Koda v3 and should not appear in the pre-flight checklist.

```bash
node --version
npm --version
git --version
kane-cli --version
npm install -g @testmuai/kane-cli
kane-cli login
```

For local development, copy `.env.example` to `.env`. Koda loads project variables first, then falls back to `%USERPROFILE%/.koda/.env` on Windows or `$HOME/.koda/.env` on POSIX systems. Never require users to duplicate Koda credentials into every application repository.

`.env.example`:

```dotenv
GROQ_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
KODA_TEST_TOKEN=
```

---

## 2. Repository layout

```text
koda/
├── bin/koda.js
├── cli/index.js
├── cli/installer/hooks.js
├── core/
│   ├── index.js
│   ├── root.js
│   ├── errors.js
│   ├── diff.js
│   ├── analyze.js
│   ├── detect-agent.js
│   ├── target.js
│   ├── kane-runner.js
│   ├── endpoint-tester.js
│   ├── integration-tester.js
│   ├── keys.js
│   ├── memory.js
│   ├── reporter.js
│   ├── cicd-generator.js
│   └── doctor.js
├── mcp/server.js
├── plugins/env-scan.js
├── plugins/notify.js
├── extension/
│   ├── package.json
│   └── extension.js
├── templates/koda.yml
├── package.json
├── README.md
├── LICENSE
└── .env.example
```

The project root is never assumed to be the process working directory. Every core function receives or resolves a project root through `core/root.js`.

---

## 3. Package setup

Use exact dependency versions. Do not rely on transitive `zod` from the MCP SDK.

```json
{
  "name": "koda",
  "version": "0.3.0",
  "type": "module",
  "bin": { "koda": "./bin/koda.js" },
  "scripts": {
    "test": "node --test",
    "mcp": "node mcp/server.js",
    "check": "node --check cli/index.js && node --check core/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.0.4",
    "axios": "1.7.9",
    "chalk": "5.4.1",
    "commander": "12.1.0",
    "dotenv": "16.4.7",
    "groq-sdk": "0.9.1",
    "js-yaml": "4.1.0",
    "ora": "8.1.1",
    "simple-git": "3.27.0",
    "zod": "3.24.1"
  }
}
```

Pin the lockfile and commit it. Before using an MCP SDK upgrade, run the MCP smoke test; the guide uses the SDK’s current `registerTool` API rather than the legacy `server.tool` overload.

---

## 4. Project configuration

`koda init` creates `.koda/config.json`:

```json
{
  "schema": 1,
  "version": "0.3.0",
  "project": "checkout-app",
  "kane": {
    "target": "http://localhost:3000",
    "headless": true,
    "max_steps": 30,
    "timeout_ms": 120000
  },
  "tests": {
    "browser_flows": true,
    "endpoint_tests": true,
    "integration_tests": true,
    "allow_mutating_methods": false,
    "expected_statuses": {}
  },
  "cicd": {
    "notify_on_push": true
  },
  "notify": {
    "telegram": false,
    "discord": false
  }
}
```

`expected_statuses` lets a project describe legitimate responses:

```json
{ "GET /api/health": [200], "GET /api/orders": [200, 401] }
```

Mutating methods remain skipped unless `allow_mutating_methods` is explicitly set to `true`. Even then, the endpoint must be supplied by the agent or configured by the project; Koda never invents a DELETE request from a route name.

---

## 5. Root resolution and initialization

`core/root.js`:

```js
import fs from 'node:fs'
import path from 'node:path'

export function resolveRoot(explicit) {
  let dir = path.resolve(explicit || process.env.KODA_PROJECT || process.cwd())
  while (true) {
    if (fs.existsSync(path.join(dir, '.koda'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Koda is not initialized here. Run `koda init` first.')
}
```

Initialization must be idempotent and non-destructive:

1. Resolve the absolute Git directory with `git rev-parse --absolute-git-dir`.
2. Create `.koda/reports`, `.koda/memory`, and `.koda/evidence`.
3. Detect an app target from existing config or `package.json`; default to port 3000 only when no better signal exists.
4. Install hooks using append-or-backup behavior.
5. Write `.koda/config.json` only if it does not exist, unless the user passes `--force`.
6. Add only Koda’s generated paths to `.gitignore`.

Never overwrite Husky, lefthook, or a user-authored hook. If `.husky/` exists, install into `.husky/post-commit` and `.husky/pre-commit`; otherwise use `.git/hooks`.

`installHookFile`:

```js
import fs from 'node:fs'

export function installHookFile(hookPath, body) {
  const marker = '# Koda'
  if (fs.existsSync(hookPath)) {
    const current = fs.readFileSync(hookPath, 'utf8')
    if (current.includes(marker)) return 'already-installed'
    fs.copyFileSync(hookPath, `${hookPath}.koda-backup`)
    fs.appendFileSync(hookPath, `\n${marker}\n${body}\n`)
    return 'appended'
  }
  fs.writeFileSync(hookPath, `#!/bin/sh\n${marker}\n${body}\n`)
  fs.chmodSync(hookPath, 0o755)
  return 'created'
}
```

`fs.chmodSync` is harmless on Windows. Do not shell out to `chmod`, and quote every path passed to a shell.

---

## 6. Hooks and lifecycle

The pre-commit hook runs the secret guard synchronously. It must never contain complex regex quoting. Koda writes patterns to `.koda/secret-patterns.txt` and uses `grep -f`.

```sh
#!/bin/sh
if [ "${KODA_SKIP_GUARD:-0}" = "1" ]; then exit 0; fi
if git diff --cached --diff-filter=ACM -- . ':(exclude)*.lock' ':(exclude)*-lock.json' |
  grep -qE -f .koda/secret-patterns.txt; then
  echo "Koda: possible secret detected; commit blocked. Use --no-verify only when intentional."
  exit 1
fi
exit 0
```

The post-commit hook resolves the new commit before launching the background run and writes output to `.koda/koda.log`:

```sh
#!/bin/sh
ROOT="$(git rev-parse --show-toplevel)"
SHA="$(git rev-parse HEAD)"
node "$(npm root -g)/koda/bin/koda.js" run --project "$ROOT" --commit "$SHA" >> "$ROOT/.koda/koda.log" 2>&1 &
```

Do not use `disown`; it is unavailable in many shells and makes the demo timing unpredictable. The extension can watch reports directly, while terminal users can run `tail -f .koda/koda.log`.

A pre-push hook may print a non-blocking reminder when CI is not configured:

```sh
if [ "${KODA_NOTIFY_ON_PUSH:-1}" = "1" ] && [ ! -f .github/workflows/koda.yml ]; then
  echo "Koda: no CI verification workflow found. Run koda cicd to create one."
fi
exit 0
```

This is a reminder, not an interactive prompt or a push blocker.

---

## 7. CLI commands

The CLI must expose every documented command:

```text
koda init [--force]
koda run [--project <path>] [--commit <sha>]
koda report
koda memory
koda cicd
koda doctor [--kane]
koda mcp
```

`koda mcp` launches `node mcp/server.js`; it is not merely an npm script.

All user-facing CLI logs go to stdout. The core accepts a logger so the MCP entry point can redirect operational logs to stderr:

```js
export function makeLogger(stream = process.stdout) {
  return (...args) => stream.write(args.join(' ') + '\n')
}
```

---

## 8. Diff reading and classification

Use `git diff-tree --root -m --name-status` so the first commit works:

```js
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)

export async function readDiff(root, commit = 'HEAD') {
  const { stdout: names } = await execFileAsync('git',
    ['diff-tree', '--root', '-m', '--name-only', '-r', commit], { cwd: root })
  const { stdout: raw } = await execFileAsync('git',
    ['show', '--format=', '--no-ext-diff', commit], { cwd: root })
  const filePaths = [...new Set(names.split(/\r?\n/).filter(Boolean))]
  const files = filePaths.map(file => ({ path: file, type: classifyFile(file) }))
  return { commit, file_paths: filePaths, files_changed: files, raw, ...summarize(files) }
}
```

Classification must check API routes before pages and use path segments:

```js
export function classifyFile(file) {
  const p = file.replaceAll('\\', '/').toLowerCase()
  if (/(^|\/)api(\/|$)/.test(p) || /(^|\/)route\.(ts|tsx|js|jsx)$/.test(p)) return 'api'
  if (/(^|\/)(pages|app)(\/|$)/.test(p) && /page\.|route\./.test(p)) return 'page'
  if (/(^|\/)components(\/|$)/.test(p)) return 'component'
  if (/(^|\/)(lib|utils|helpers)(\/|$)/.test(p)) return 'lib'
  if (/config\.|\.env|package\.json|next\.config/.test(p)) return 'config'
  if (/\.test\.|\.spec\.|__tests__/.test(p)) return 'test'
  return 'other'
}
```

---

## 9. Impact analysis: agent first, Groq fallback

The agent already has repository context. MCP verification accepts optional impact analysis:

```json
{
  "flows": [
    {
      "flow": "Complete checkout with a card",
      "likely_files": ["app/checkout/page.tsx", "app/api/payment/route.ts"]
    }
  ],
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/payment/status",
      "description": "Read payment status",
      "sample_body": null
    }
  ]
}
```

`analyzeImpact(diff, supplied)` returns `analysis_source: 'agent'` when supplied data is present, otherwise calls Groq with temperature 0 and JSON response format. The report records `agent`, `analysis_source`, and reasoning. Agent detection is best-effort only:

```js
export function detectAgent(root) {
  const signs = [
    ['claude-code', 'CLAUDECODE', '.claude'],
    ['cursor', 'CURSOR_TRACE_ID', '.cursor'],
    ['codex', 'CODEX_SANDBOX', '.codex'],
    ['gemini-cli', 'GEMINI_CLI', '.gemini']
  ]
  for (const [name, env, marker] of signs) {
    if (process.env[env] || exists(path.join(root, marker))) return name
  }
  return 'unknown'
}
```

If the model fails, return an explicit fallback with `analysis_source: 'fallback'`; never crash the whole run because analysis was unavailable.

---

## 10. Target detection and health checks

At init, infer the target from existing config and package scripts:

```js
export function guessTarget(root, config, packageJson) {
  if (config?.kane?.target) return config.kane.target
  const scripts = Object.values(packageJson?.scripts || {}).join(' ')
  const port = scripts.match(/(?:--port|-p)[= ](\d{2,5})/)?.[1]
    || scripts.match(/PORT=(\d{2,5})/)?.[1]
    || (packageJson?.dependencies?.vite ? '5173' : '3000')
  return `http://localhost:${port}`
}
```

Before browser or endpoint checks, make a three-second request. If it fails, mark those checks `skipped` with verdict `App not running at <target>`. Include `action_required.skipped` and `coverage_complete: false` in the report. Skips must never enter failure memory or pattern counts.

Koda does not start the user’s development server. The CLI may offer `koda doctor` guidance, but silently starting processes would create port, environment, and cleanup problems.

---

## 11. Kane runner

Use `readline.createInterface` to assemble NDJSON correctly across stdout chunks. Drain stderr and handle spawn errors. On Windows, invoke `kane-cli.cmd`; on POSIX, invoke `kane-cli`.

```js
const command = process.platform === 'win32' ? 'kane-cli.cmd' : 'kane-cli'
const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const rl = readline.createInterface({ input: child.stdout })
const events = []
rl.on('line', line => { try { events.push(JSON.parse(line)) } catch {} })
let stderr = ''
child.stderr.on('data', chunk => { stderr += chunk.toString() })
child.once('error', err => finish({ status: 'failed', verdict: err.message }))
```

Normalize Kane event variants (`type/event/kind`, `remark/message/error`) and degrade safely when no `run_end` event exists. Clear the timeout in the close handler. Evidence filenames must be sanitized and include a hash to avoid collisions:

```js
const slug = flow.flow.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,  forty)
const evidenceFile = path.join(evidenceDir, `${slug}-${sha256(flow.flow).slice(0, 8)}.json`)
```

Use `max_flows` in MCP (default 2) and report when the request is capped: `Verified 2 of 5 flows (max_flows=2)`.

---

## 12. Endpoint verification

Only `GET`, `HEAD`, and `OPTIONS` run by default. Mutating methods require `tests.allow_mutating_methods: true` and an explicit agent/project declaration. Attach `KODA_TEST_TOKEN` only when configured.

Expected status codes come from config, defaulting to a conservative rule: responses below 500 pass only if the route is known or has an expected status; unknown routes returning 404 are reported as `failed` or `unverified`, not silently passed.

Record the previous report’s status and flag regressions such as `200 → 500`. Never send an empty-body DELETE, POST, or PATCH to a live database merely because an LLM suggested the method.

---

## 13. Scoped integration tests

Detect Jest, Vitest, or Mocha from dependencies. Map changed source files to nearby `.test.*`, `.spec.*`, and `__tests__` files. Run only matched files and capture stdout and stderr.

If no tests match, return a coverage-gap result:

```json
{
  "name": "Test coverage",
  "status": "failed",
  "verdict": "No tests cover 2 changed file(s)",
  "affected_files": ["src/payment.ts"]
}
```

This is a useful finding, not a claim that the entire suite passed.

Use the correct runner syntax:

- Jest: `npx --no-install jest --passWithNoTests <files>`
- Vitest: `npx --no-install vitest run --passWithNoTests <files>`
- Mocha: `npx --no-install mocha <files>`

Parse the exit code and summary from both output streams. Do not inspect only `stdout`.

---

## 14. Stable memory and resolution

Use a factory, not a shallow copy:

```js
export function defaultMemory() {
  return { schema: 1, failures: [], patterns: [], total_fixes: 0, updated_at: null }
}
```

Every result gets a stable key:

```js
export function checkKey(result) {
  if (result.endpoint) return `endpoint:${result.endpoint}`
  if (result.name) return `test:${result.name}`
  return `flow:${normalizeWords(result.flow).slice(0, 8).sort().join('-')}`
}
```

Normalize wording and use token overlap for fuzzy flow matching. On each run:

1. Add newly failed checks with `key`, `commit`, `timestamp`, `verdict`, and `affected_files`.
2. Ignore skipped checks.
3. Match passing checks against unresolved failures.
4. Mark matches as resolved, store `resolved_at`, `resolved_in_commit`, and `time_to_fix_ms`.
5. Increment `total_fixes`.
6. Create a pattern after the agreed threshold of two occurrences and keep the comment aligned with the code.

Write memory atomically:

```js
const tmp = `${memoryPath}.${process.pid}.tmp`
fs.writeFileSync(tmp, JSON.stringify(memory, null, 2))
fs.renameSync(tmp, memoryPath)
```

If a corrupt memory file is found, preserve it as `.corrupt-<timestamp>.json`, recreate default memory, and report the recovery.

---

## 15. Reports

Reports are named with an ISO timestamp and commit prefix, for example:

```text
.koda/reports/2026-08-24T14-32-10-123Z-abc1234.json
.koda/reports/2026-08-24T14-32-10-123Z-abc1234.md
```

The report schema is:

```json
{
  "meta": {
    "commit": "abc1234",
    "timestamp": "2026-08-24T14:32:10.123Z",
    "project": "checkout-app",
    "agent": "codex",
    "analysis_source": "agent",
    "koda_version": "0.3.0"
  },
  "diff_summary": { "files_changed": [], "risk_level": "medium" },
  "verification": {
    "browser_flows": [],
    "endpoint_tests": [],
    "integration_tests": []
  },
  "memory_context": { "similar_failures": [], "patterns": [], "fix_confidence": "low" },
  "action_required": {
    "priority": "none",
    "failures": 0,
    "passed": 0,
    "skipped": 0,
    "coverage_complete": true,
    "suggested_focus": []
  }
}
```

Suggested focus comes from `likely_files` supplied by the agent. If absent, use endpoint path-segment overlap with changed files. Never match the first word of an English flow such as “Verify” or “Submit”.

Markdown must show PASS, FAIL, and SKIPPED distinctly, include coverage status, recurring patterns, similar failures, and average time to fix where available.

`koda report` selects the newest timestamp-prefixed report, not the alphabetically greatest commit hash.

---

## 16. MCP server

MCP is stdio-only: protocol responses go to stdout; all diagnostics go to stderr. Use the pinned SDK’s current registration API and the direct `zod` dependency.

Tools:

- `koda_verify`: optional `project`, `commit`, `flows`, `endpoints`, and `max_flows`; runs verification and returns a compact summary.
- `koda_report`: optional `project`; returns the newest full JSON report.
- `koda_memory`: optional `project`; returns project memory.
- `koda_setup_cicd`: optional `project`; generates validated CI configuration without overwriting an existing file.
- `koda_status`: optional `project`, `run_id`; useful later if asynchronous runs are introduced.

The MCP tool must pass agent-supplied flows into `runLoop`, rather than merely accepting them and ignoring them. If a run is capped, say so in the response.

Project resolution must walk upward from an explicit tool argument, `KODA_PROJECT`, or the process directory until `.koda` is found.

---

## 17. CI/CD generation

CI is template-first. Do not let an LLM emit arbitrary YAML. Generate a known template, fill a small validated set of slots, parse with `js-yaml`, and refuse to overwrite an existing `.github/workflows/koda.yml` unless `--force` is supplied.

The template must:

1. Check out the repository.
2. Set up Node.
3. Run `npm ci`.
4. Run the project build command when one exists.
5. Install Kane CLI.
6. Authenticate using GitHub secrets.
7. Start the app and wait for the configured target.
8. Run the locally installed Koda CLI with `npx --no-install koda run`.

Use `new URL(config.kane.target).port` for the port. Do not use `split(':').pop()`, which mishandles normal URLs. Validate the final YAML before writing.

---

## 18. IDE extension

The extension is optional and works as an ambient UI layer.

On workspace open:

- Show `$(shield) Koda — click to enable` when the workspace is a Git repository but Koda is not enabled.
- Do not run `npx koda init` automatically.
- Do not write hooks automatically.

After the user clicks Enable:

1. Create `.koda/` through the local CLI or a documented initialization function.
2. Subscribe to VS Code’s Git API and watch HEAD changes.
3. Run `koda run --project <root> --commit <sha>` for new commits.
4. Watch `.koda/reports/*.json` and update the status bar.
5. Catch up if HEAD differs from the last verified SHA in memory.

Status examples:

```text
$(check) Koda 4
$(error) Koda 2
$(circle-slash) Koda — app not running
$(sync~spin) Koda — verifying
```

Commands:

- `koda.enable`
- `koda.report` (opens rendered Markdown)
- `koda.memory`

Resolve the local CLI with `require.resolve` or the extension’s configured path. Do not use `npx koda` during development because it may fetch an unpublished package. Package the extension as `.vsix` for VS Code Marketplace and OpenVSX distribution. JetBrains and Zed integrations are out of scope; MCP covers their agents.

---

## 19. `koda doctor`

`koda doctor` checks:

- Git repository and absolute Git directory
- `.koda/config.json`
- Writable reports, memory, and evidence directories
- Kane CLI presence and authentication
- Groq key when fallback analysis is enabled
- Target URL health
- Hook installation state
- MCP configuration

`koda doctor --kane` runs one trivial Kane flow and prints the event keys observed. This empirically verifies the installed Kane schema instead of assuming field names.

Exit non-zero only for required failures. Clearly label optional integrations as warnings.

---

## 20. Testing strategy

Before the demo, test these cases:

- Fresh repository with its first commit
- Repository opened from a nested subdirectory
- Windows and POSIX hook paths
- Existing pre-commit/post-commit hooks and `.husky/`
- Secret guard with API keys, private keys, lockfiles, and `--no-verify`
- MCP call with no stdout pollution
- App running and app offline
- Kane output split across chunks, malformed lines, timeout, and spawn error
- Safe GET endpoint, unknown 404, expected 401, and blocked DELETE
- No matching integration tests
- A failing check followed by a passing check
- Corrupt memory recovery
- Multiple reports sorted by timestamp
- Extension enable, decline, report watcher, and catch-up verification
- Existing CI file refusing overwrite

Use fixtures and a local HTTP server; never run destructive endpoint tests against a production or personal database.

---

## 21. Demonstration script

Prepare the app and dev server before recording. Do not script exact failure counts unless the fixture guarantees them.

```text
0:00  Open the checkout fixture and show the dev server is running.
0:10  Click “Enable Koda” in the IDE status bar, or run `koda init` in a terminal.
0:25  Commit a deliberately broken payment change.
0:35  Show the Koda status bar changing to “verifying”.
0:50  Open the timestamped Markdown report: one browser failure, one endpoint regression.
1:10  Ask the coding agent to call `koda_report` and `koda_memory` through MCP.
1:30  The agent supplies affected flows and fixes the code.
1:45  Commit the fix; show the previous failure marked resolved.
2:00  Run `koda memory`; show the recurring pattern and time-to-fix history.
2:15  Run `koda doctor`; show the environment is healthy.
2:30  Run `koda cicd`; show validated template-first workflow generation.
2:45  Show the MCP configuration and explain that the same engine works with other agents.
```

The demo should visibly include the offline-app `SKIPPED` state in rehearsal, even if the final story uses a live app.

---

## 22. Release checklist

- [ ] All code examples are UTF-8 and render correctly.
- [ ] `npm ci` and `npm test` pass.
- [ ] CLI commands in the guide exist and are registered.
- [ ] Package name is reserved or changed to a scoped name.
- [ ] README, LICENSE, and `.env.example` are present.
- [ ] npm package contains `bin/koda.js`, core, MCP, and templates.
- [ ] `npx --no-install koda init` works after local installation.
- [ ] MCP registers with Claude Code, Cursor, Codex, and another MCP client.
- [ ] At least one real Kane run is captured.
- [ ] Extension is packaged for VS Code Marketplace and OpenVSX.
- [ ] Existing hooks and CI files are preserved.
- [ ] No production database is used for mutating tests.

Koda’s final pitch:

> Install once, verify the changes that matter, and remember what keeps breaking — for every coding agent.

