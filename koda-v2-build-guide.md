# Koda v2 — Build Guide
### Kane CLI Hackathon | Aug 19–30 2026

> The verification and memory layer for every coding agent.  
> Works with Claude Code, Cursor, Codex, Gemini, Antigravity — any agent.  
> Installs once. Runs silently. Every commit is verified.

---

## 0. Pre-flight Checklist

```bash
node --version          # 18+
python --version        # 3.11+
git --version           # any recent
kane-cli --version      # must be installed
```

Install Kane CLI:
```bash
npm install -g @testmuai/kane-cli
kane-cli login
```

**Environment variables needed:**
```
GROQ_API_KEY=
TELEGRAM_BOT_TOKEN=       # optional — koda-notify
TELEGRAM_CHAT_ID=         # optional — koda-notify
DISCORD_WEBHOOK_URL=      # optional — koda-notify
```

---

## 1. What Koda Does

On every commit, Koda:

1. Reads the git diff — what files changed
2. Queries the active coding agent — what could break
3. Runs Kane on affected flows only — not the whole suite
4. Runs endpoint + integration tests for changed routes
5. Produces a JSON report for the agent + MD report for the developer
6. Updates per-project memory — patterns, history, fix confidence
7. On deploy — asks to set up CI/CD, queries agent for context, generates config

Koda never writes code. It orchestrates, verifies, remembers, and reports.

---

## 2. Project Structure

```
koda/
├── cli/
│   ├── index.js              # koda init entry point
│   └── installer/
│       ├── hook.js           # git hook installer
│       └── hook.sh           # the actual pre-commit/post-commit hook
├── core/
│   ├── diff.js               # git diff reader + file classifier
│   ├── agent-query.js        # queries active coding agent for context
│   ├── kane-runner.js        # Kane CLI subprocess + NDJSON parser
│   ├── endpoint-tester.js    # HTTP endpoint tests for changed routes
│   ├── integration-tester.js # integration test runner
│   ├── reporter.js           # generates JSON + MD reports
│   ├── memory.js             # per-project memory read/write
│   └── cicd-generator.js     # CI/CD config builder
├── mcp/
│   ├── server.js             # MCP server — exposes Koda tools to agents
│   └── tools/
│       ├── verify.js         # koda_verify tool
│       ├── report.js         # koda_report tool
│       └── memory.js         # koda_memory tool
├── extension/
│   ├── package.json          # VS Code extension manifest
│   ├── extension.js          # auto-installs hook on project open
│   └── README.md             # extension docs
├── plugins/
│   ├── notify.js             # Telegram + Discord notifications
│   └── env-scan.js           # secret scanning before commit
├── package.json
└── .koda/                    # created per project on koda init
    ├── config.json           # project config
    ├── reports/              # JSON + MD reports per commit
    ├── memory/
    │   └── koda.memory.json  # persistent project memory
    └── evidence/             # Kane evidence packs
```

---

## 3. Initialize the Project

```bash
mkdir koda && cd koda
git init
npm init -y
mkdir -p cli/installer core mcp/tools extension plugins
```

**package.json:**
```json
{
  "name": "koda",
  "version": "0.2.0",
  "description": "Verification and memory layer for every coding agent.",
  "bin": {
    "koda": "./cli/index.js"
  },
  "type": "module",
  "scripts": {
    "dev": "node cli/index.js init",
    "mcp": "node mcp/server.js"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "ora": "^8.0.1",
    "groq-sdk": "^0.9.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "simple-git": "^3.25.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.5",
    "marked": "^12.0.0"
  }
}
```

Install:
```bash
npm install
```

---

## 4. koda init — CLI Entry Point

**cli/index.js:**
```javascript
#!/usr/bin/env node
import { program } from 'commander'
import chalk from 'chalk'
import { installHook } from './installer/hook.js'
import { runLoop } from '../core/index.js'

console.log(chalk.bold.cyan('\n  koda') + chalk.dim(' — verify everything, forget nothing\n'))

program
  .name('koda')
  .description('Verification and memory layer for every coding agent.')
  .version('0.2.0')

program
  .command('init')
  .description('Initialize Koda in this project')
  .action(async () => {
    await installHook()
  })

program
  .command('run')
  .description('Run verification manually')
  .option('--commit <hash>', 'Specific commit to verify')
  .action(async (opts) => {
    await runLoop({ commit: opts.commit || 'HEAD' })
  })

program
  .command('report')
  .description('Show last report')
  .action(async () => {
    const { showLastReport } = await import('../core/reporter.js')
    await showLastReport()
  })

program
  .command('memory')
  .description('Show project memory')
  .action(async () => {
    const { showMemory } = await import('../core/memory.js')
    await showMemory()
  })

program
  .command('cicd')
  .description('Generate CI/CD config')
  .action(async () => {
    const { generateCICD } = await import('../core/cicd-generator.js')
    await generateCICD()
  })

program.parse(process.argv)
```

---

## 5. Git Hook Installer

**cli/installer/hook.js:**
```javascript
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { execSync } from 'child_process'

export async function installHook() {
  const spinner = ora('Installing Koda into this project...').start()

  // Check if inside a git repo
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' })
  } catch {
    spinner.fail('Not a git repository. Run git init first.')
    process.exit(1)
  }

  const gitDir = execSync('git rev-parse --git-dir').toString().trim()
  const hookPath = path.join(gitDir, 'hooks', 'post-commit')
  const hooksDir = path.join(gitDir, 'hooks')

  // Create hooks dir if missing
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true })

  // Write post-commit hook
  const hookContent = `#!/bin/bash
# Koda verification hook
# Runs after every commit

KODA_PATH="$(npm root -g)/koda/cli/index.js"

if [ -f "$KODA_PATH" ]; then
  node "$KODA_PATH" run --commit HEAD &
  disown
fi
`
  fs.writeFileSync(hookPath, hookContent)
  execSync(`chmod +x ${hookPath}`)

  // Create .koda directory structure
  const kodaDir = path.join(process.cwd(), '.koda')
  fs.mkdirSync(path.join(kodaDir, 'reports'), { recursive: true })
  fs.mkdirSync(path.join(kodaDir, 'memory'), { recursive: true })
  fs.mkdirSync(path.join(kodaDir, 'evidence'), { recursive: true })

  // Write default config
  const config = {
    version: '0.2.0',
    project: path.basename(process.cwd()),
    agent: 'auto',  // auto-detected from running processes
    kane: {
      target: 'http://localhost:3000',
      headless: true,
      max_steps: 30
    },
    tests: {
      browser_flows: true,
      endpoint_tests: true,
      integration_tests: true
    },
    notify: {
      telegram: false,
      discord: false
    }
  }

  fs.writeFileSync(
    path.join(kodaDir, 'config.json'),
    JSON.stringify(config, null, 2)
  )

  // Add .koda to .gitignore (except config)
  const gitignorePath = path.join(process.cwd(), '.gitignore')
  const gitignoreEntry = '\n# Koda\n.koda/reports/\n.koda/memory/\n.koda/evidence/\n'

  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, 'utf-8')
    if (!current.includes('# Koda')) {
      fs.appendFileSync(gitignorePath, gitignoreEntry)
    }
  } else {
    fs.writeFileSync(gitignorePath, gitignoreEntry)
  }

  // Security guard
  installPreCommitGuard(gitDir)

  spinner.succeed('Koda installed')
  console.log(chalk.dim('\n  → Post-commit hook active'))
  console.log(chalk.dim('  → .koda/ created'))
  console.log(chalk.dim('  → Every commit now triggers verification\n'))
  console.log(chalk.cyan('  Run koda mcp to expose Koda to your coding agent via MCP\n'))
}

function installPreCommitGuard(gitDir) {
  const guardPath = path.join(gitDir, 'hooks', 'pre-commit')
  const guard = `#!/bin/bash
# Koda security guard — blocks private keys before commit

if git diff --cached | grep -qE '0x[0-9a-fA-F]{64}'; then
  echo ""
  echo "  ❌ KODA: Private key detected in staged changes."
  echo "  Use environment variables. Never commit secrets."
  echo ""
  exit 1
fi

if git diff --cached | grep -qE '(sk-[a-zA-Z0-9]{32}|gsk_[a-zA-Z0-9]{32}|ANTHROPIC_API_KEY\\s*=\\s*["\']sk-)'; then
  echo ""
  echo "  ❌ KODA: API key detected in staged changes."
  echo "  Use .env files. Never commit API keys."
  echo ""
  exit 1
fi

exit 0
`
  fs.writeFileSync(guardPath, guard)
  execSync(`chmod +x ${guardPath}`)
}
```

---

## 6. Core Loop

**core/index.js:**
```javascript
import { readDiff } from './diff.js'
import { queryAgent } from './agent-query.js'
import { runKane } from './kane-runner.js'
import { testEndpoints } from './endpoint-tester.js'
import { runIntegrationTests } from './integration-tester.js'
import { generateReport } from './reporter.js'
import { updateMemory, loadMemory } from './memory.js'
import { scanForSecrets } from '../plugins/env-scan.js'
import { sendNotification } from '../plugins/notify.js'
import chalk from 'chalk'

export async function runLoop({ commit = 'HEAD' } = {}) {
  console.log(chalk.cyan('\n  [Koda] Verification starting...\n'))

  try {
    // 1. Read git diff
    console.log(chalk.dim('  → Reading diff...'))
    const diff = await readDiff(commit)

    if (!diff.files_changed.length) {
      console.log(chalk.dim('  → No files changed. Skipping.\n'))
      return
    }

    // 2. Scan for secrets in diff
    const secrets = scanForSecrets(diff.raw)
    if (secrets.length) {
      console.log(chalk.yellow(`  ⚠ Secret pattern found in diff: ${secrets.join(', ')}`))
    }

    // 3. Query active agent for context
    console.log(chalk.dim('  → Querying agent for context...'))
    const agentContext = await queryAgent(diff)

    // 4. Load project memory
    const memory = await loadMemory()

    // 5. Run Kane on affected flows
    console.log(chalk.dim('  → Running Kane verification...'))
    const browserResults = await runKane(agentContext.affected_flows)

    // 6. Run endpoint tests
    console.log(chalk.dim('  → Testing endpoints...'))
    const endpointResults = await testEndpoints(agentContext.affected_endpoints)

    // 7. Run integration tests
    console.log(chalk.dim('  → Running integration tests...'))
    const integrationResults = await runIntegrationTests(agentContext.affected_integrations)

    // 8. Generate report
    console.log(chalk.dim('  → Generating report...'))
    const report = await generateReport({
      commit,
      diff,
      agentContext,
      browserResults,
      endpointResults,
      integrationResults,
      memory
    })

    // 9. Update memory
    await updateMemory(report)

    // 10. Notify
    await sendNotification(report)

    // 11. Print summary
    const failures = report.action_required.failures
    const passed = report.action_required.passed

    if (failures === 0) {
      console.log(chalk.green(`\n  ✓ All ${passed} checks passed. Clean commit.\n`))
    } else {
      console.log(chalk.red(`\n  ✗ ${failures} failure(s) detected. Report sent to agent.\n`))
      console.log(chalk.dim(`  → .koda/reports/report-${commit.slice(0, 7)}.json`))
      console.log(chalk.dim(`  → .koda/reports/report-${commit.slice(0, 7)}.md\n`))
    }

  } catch (err) {
    console.error(chalk.red(`\n  [Koda] Error: ${err.message}\n`))
  }
}
```

---

## 7. Git Diff Reader

**core/diff.js:**
```javascript
import simpleGit from 'simple-git'
import path from 'path'

const git = simpleGit(process.cwd())

// File type classification
const FILE_TYPES = {
  page: ['/pages/', '/app/', 'page.tsx', 'page.ts', 'route.tsx'],
  api: ['/api/', 'route.ts', 'route.js', 'handler.ts'],
  component: ['/components/', '.tsx', '.jsx'],
  lib: ['/lib/', '/utils/', '/helpers/'],
  config: ['config.', '.env', 'package.json', 'next.config'],
  test: ['.test.', '.spec.', '__tests__']
}

function classifyFile(filePath) {
  for (const [type, patterns] of Object.entries(FILE_TYPES)) {
    if (patterns.some(p => filePath.includes(p))) return type
  }
  return 'other'
}

function assessRisk(files) {
  const types = files.map(f => f.type)
  if (types.includes('api') && types.includes('page')) return 'high'
  if (types.includes('api') || types.includes('page')) return 'medium'
  if (types.includes('component')) return 'medium'
  return 'low'
}

export async function readDiff(commit = 'HEAD') {
  const log = await git.log({ maxCount: 1 })
  const currentCommit = log.latest?.hash || 'HEAD'

  // Get changed files
  const diff = await git.diff([`${commit}^`, commit, '--name-only'])
  const rawDiff = await git.diff([`${commit}^`, commit])

  const files = diff
    .split('\n')
    .filter(Boolean)
    .map(filePath => ({
      path: filePath,
      name: path.basename(filePath),
      type: classifyFile(filePath)
    }))

  return {
    commit: currentCommit.slice(0, 7),
    files_changed: files,
    file_paths: files.map(f => f.path),
    has_api_changes: files.some(f => f.type === 'api'),
    has_page_changes: files.some(f => f.type === 'page'),
    has_component_changes: files.some(f => f.type === 'component'),
    risk_level: assessRisk(files),
    raw: rawDiff
  }
}
```

---

## 8. Agent Query

**core/agent-query.js:**
```javascript
import Groq from 'groq-sdk'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config()

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const QUERY_PROMPT = `You are Koda, a verification assistant. Given a git diff summary, identify:

1. Which browser flows to verify (user journeys that could be affected)
2. Which API endpoints to test (based on changed routes)
3. Which integrations to check (based on changed files)

Git diff summary:
Files changed: {files}
Has API changes: {has_api}
Has page changes: {has_pages}
Has component changes: {has_components}
Risk level: {risk}

Respond ONLY with valid JSON in this exact format:
{
  "affected_flows": ["plain English flow 1", "plain English flow 2"],
  "affected_endpoints": [
    {"method": "POST", "path": "/api/example", "description": "what it does"}
  ],
  "affected_integrations": ["integration 1", "integration 2"],
  "reasoning": "brief explanation of why these were selected"
}

Be specific. Only include flows/endpoints directly affected by the changed files.
If risk is low, return minimal flows. If high, be thorough.`

export async function queryAgent(diff) {
  // Load project config for app URL
  const configPath = path.join(process.cwd(), '.koda', 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  const prompt = QUERY_PROMPT
    .replace('{files}', diff.file_paths.join(', '))
    .replace('{has_api}', diff.has_api_changes)
    .replace('{has_pages}', diff.has_page_changes)
    .replace('{has_components}', diff.has_component_changes)
    .replace('{risk}', diff.risk_level)

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', // fast, this is just context extraction
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    })

    const text = response.choices[0].message.content
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)

  } catch (err) {
    // Fallback — run basic flows if agent query fails
    return {
      affected_flows: ['Verify the main page loads correctly'],
      affected_endpoints: [],
      affected_integrations: [],
      reasoning: 'Fallback — agent query failed'
    }
  }
}
```

---

## 9. Kane Runner

**core/kane-runner.js:**
```javascript
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

function humanizeFailure(failure) {
  const { remark = '', step } = failure

  if (remark.toLowerCase().includes('click')) {
    return `Nothing responds to click at step ${step}`
  }
  if (remark.toLowerCase().includes('not found')) {
    return `Element missing from page at step ${step}`
  }
  if (remark.toLowerCase().includes('timeout')) {
    return `Page took too long to respond at step ${step}`
  }
  if (remark.toLowerCase().includes('navigation')) {
    return `App navigated incorrectly at step ${step}`
  }
  return remark || `Flow failed at step ${step}`
}

async function runSingleFlow(flow, targetUrl) {
  return new Promise((resolve) => {
    const args = [
      'run',
      `Go to ${targetUrl} and: ${flow}`,
      '--agent',
      '--headless',
      '--max-steps', '30'
    ]

    const kane = spawn('kane-cli', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = []

    kane.stdout.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach(line => {
        try { lines.push(JSON.parse(line)) } catch { }
      })
    })

    kane.on('close', (code) => {
      const runEnd = lines.find(l => l.type === 'run_end')
      const failures = lines.filter(l => l.step && l.status === 'failed')

      // Save evidence
      const evidenceDir = path.join(process.cwd(), '.koda', 'evidence')
      const evidenceFile = path.join(evidenceDir, `${flow.slice(0, 30).replace(/\s/g, '-')}.json`)
      fs.writeFileSync(evidenceFile, JSON.stringify(lines, null, 2))

      if (code === 0 || runEnd?.status === 'passed') {
        resolve({ flow, status: 'passed', verdict: null, evidence: evidenceFile })
      } else {
        const firstFailure = failures[0]
        resolve({
          flow,
          status: 'failed',
          verdict: firstFailure ? humanizeFailure(firstFailure) : 'Flow did not complete',
          step_failed: firstFailure?.step || null,
          evidence: evidenceFile
        })
      }
    })

    // Timeout after 2 minutes
    setTimeout(() => {
      kane.kill()
      resolve({ flow, status: 'failed', verdict: 'Verification timed out', evidence: null })
    }, 120000)
  })
}

export async function runKane(flows = []) {
  if (!flows.length) return []

  const configPath = path.join(process.cwd(), '.koda', 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const targetUrl = config.kane.target

  // Run flows in sequence (parallel risks port conflicts)
  const results = []
  for (const flow of flows) {
    const result = await runSingleFlow(flow, targetUrl)
    results.push(result)
  }

  return results
}
```

---

## 10. Endpoint Tester

**core/endpoint-tester.js:**
```javascript
import axios from 'axios'
import fs from 'fs'
import path from 'path'

export async function testEndpoints(endpoints = []) {
  if (!endpoints.length) return []

  const configPath = path.join(process.cwd(), '.koda', 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const baseUrl = config.kane.target

  const results = []

  for (const endpoint of endpoints) {
    try {
      const response = await axios({
        method: endpoint.method.toLowerCase(),
        url: `${baseUrl}${endpoint.path}`,
        timeout: 10000,
        validateStatus: () => true // don't throw on 4xx/5xx
      })

      const passed = response.status < 500
      results.push({
        endpoint: `${endpoint.method} ${endpoint.path}`,
        status: passed ? 'passed' : 'failed',
        verdict: passed ? null : `Returns ${response.status} — ${endpoint.description}`,
        expected: '2xx or 4xx',
        received: response.status
      })

    } catch (err) {
      results.push({
        endpoint: `${endpoint.method} ${endpoint.path}`,
        status: 'failed',
        verdict: `Endpoint unreachable: ${err.message}`,
        expected: '2xx',
        received: null
      })
    }
  }

  return results
}
```

---

## 11. Integration Test Runner

**core/integration-tester.js:**
```javascript
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export async function runIntegrationTests(integrations = []) {
  if (!integrations.length) return []

  const results = []
  const projectPath = process.cwd()

  // Check if project has existing test scripts
  const packageJsonPath = path.join(projectPath, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  const hasTestScript = packageJson.scripts?.test && !packageJson.scripts.test.includes('no test')

  if (hasTestScript) {
    try {
      execSync('npm test --passWithNoTests', {
        cwd: projectPath,
        stdio: 'pipe',
        timeout: 60000
      })
      results.push({
        name: 'Project test suite',
        status: 'passed',
        verdict: null,
        affected_files: []
      })
    } catch (err) {
      results.push({
        name: 'Project test suite',
        status: 'failed',
        verdict: err.stdout?.toString()?.split('\n')?.[0] || 'Tests failed',
        affected_files: []
      })
    }
  }

  return results
}
```

---

## 12. Memory

**core/memory.js:**
```javascript
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'

const MEMORY_FILE = () => path.join(process.cwd(), '.koda', 'memory', 'koda.memory.json')

const DEFAULT_MEMORY = {
  project: '',
  created_at: new Date().toISOString(),
  total_commits_verified: 0,
  total_failures: 0,
  total_fixes: 0,
  failures: [],
  patterns: []
}

export function loadMemory() {
  const memPath = MEMORY_FILE()
  if (!fs.existsSync(memPath)) {
    const memory = {
      ...DEFAULT_MEMORY,
      project: path.basename(process.cwd())
    }
    fs.writeFileSync(memPath, JSON.stringify(memory, null, 2))
    return memory
  }
  return JSON.parse(fs.readFileSync(memPath, 'utf-8'))
}

export function updateMemory(report) {
  const memory = loadMemory()

  memory.total_commits_verified++

  // Log failures to memory
  const allFailures = [
    ...report.verification.browser_flows.filter(f => f.status === 'failed'),
    ...report.verification.endpoint_tests.filter(f => f.status === 'failed'),
    ...report.verification.integration_tests.filter(f => f.status === 'failed')
  ]

  memory.total_failures += allFailures.length

  for (const failure of allFailures) {
    memory.failures.push({
      commit: report.meta.commit,
      timestamp: report.meta.timestamp,
      flow: failure.flow || failure.endpoint || failure.name,
      verdict: failure.verdict,
      resolved: false
    })
  }

  // Pattern detection — same flow failing 3+ times
  const flowCounts = {}
  for (const f of memory.failures.filter(f => !f.resolved)) {
    const key = f.flow
    flowCounts[key] = (flowCounts[key] || 0) + 1
  }

  memory.patterns = Object.entries(flowCounts)
    .filter(([, count]) => count >= 2)
    .map(([flow, count]) => ({
      flow,
      occurrences: count,
      first_seen: memory.failures.find(f => f.flow === flow)?.timestamp,
      note: `This has failed ${count} times. Likely a structural issue, not a one-off bug.`
    }))

  // Keep last 100 failures only
  memory.failures = memory.failures.slice(-100)

  fs.writeFileSync(MEMORY_FILE(), JSON.stringify(memory, null, 2))
  return memory
}

export function getMemoryContext(flow) {
  const memory = loadMemory()
  const similar = memory.failures
    .filter(f => f.flow === flow && f.resolved)
    .slice(-3)

  const pattern = memory.patterns.find(p => p.flow === flow)

  return { similar, pattern }
}

export function showMemory() {
  const memory = loadMemory()
  console.log(chalk.cyan('\n  Koda Memory\n'))
  console.log(chalk.dim(`  Project: ${memory.project}`))
  console.log(chalk.dim(`  Commits verified: ${memory.total_commits_verified}`))
  console.log(chalk.dim(`  Total failures caught: ${memory.total_failures}`))
  if (memory.patterns.length) {
    console.log(chalk.yellow('\n  Patterns detected:'))
    memory.patterns.forEach(p => {
      console.log(chalk.yellow(`  → ${p.flow} (${p.occurrences}x)`))
    })
  }
  console.log()
}
```

---

## 13. Reporter

**core/reporter.js:**
```javascript
import fs from 'fs'
import path from 'path'
import { getMemoryContext } from './memory.js'
import chalk from 'chalk'

export async function generateReport({
  commit, diff, agentContext,
  browserResults, endpointResults,
  integrationResults, memory
}) {
  const timestamp = new Date().toISOString()
  const allResults = [...browserResults, ...endpointResults, ...integrationResults]
  const failures = allResults.filter(r => r.status === 'failed')
  const passed = allResults.filter(r => r.status === 'passed')

  // Get memory context for each failed flow
  const memoryContext = failures.length ? {
    similar_failures: failures.flatMap(f => {
      const ctx = getMemoryContext(f.flow || f.endpoint || f.name)
      return ctx.similar
    }).slice(0, 5),
    patterns: memory.patterns,
    fix_confidence: failures.length > 0 && memory.patterns.length > 0 ? 'high' : 'medium'
  } : null

  // Determine priority
  const priority = failures.length === 0 ? 'none'
    : diff.risk_level === 'high' ? 'critical'
    : diff.risk_level === 'medium' ? 'high'
    : 'medium'

  const report = {
    meta: {
      commit: commit.slice(0, 7),
      timestamp,
      project: path.basename(process.cwd()),
      agent: agentContext.agent || 'unknown',
      koda_version: '0.2.0'
    },
    diff_summary: {
      files_changed: diff.file_paths,
      risk_level: diff.risk_level,
      affected_flows: agentContext.affected_flows
    },
    verification: {
      browser_flows: browserResults,
      endpoint_tests: endpointResults,
      integration_tests: integrationResults
    },
    memory_context: memoryContext,
    action_required: {
      priority,
      failures: failures.length,
      passed: passed.length,
      suggested_focus: failures.map(f => {
        const file = diff.file_paths.find(p =>
          p.toLowerCase().includes((f.flow || f.endpoint || '').toLowerCase().split(' ')[0])
        )
        return file
          ? `${file} — ${f.verdict}`
          : f.verdict
      }).filter(Boolean)
    }
  }

  // Write JSON report
  const reportsDir = path.join(process.cwd(), '.koda', 'reports')
  const jsonPath = path.join(reportsDir, `report-${commit.slice(0, 7)}.json`)
  const mdPath = path.join(reportsDir, `report-${commit.slice(0, 7)}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(mdPath, generateMarkdownReport(report))

  return report
}

function generateMarkdownReport(report) {
  const { meta, diff_summary, verification, memory_context, action_required } = report

  const riskEmoji = {
    high: '🔴',
    medium: '🟡',
    low: '🟢',
    none: '⚪'
  }

  const rows = [
    ...verification.browser_flows.map(f => `| ${f.flow} | ${f.status === 'passed' ? '✅ PASS' : '❌ FAIL'} | ${f.verdict || '—'} |`),
    ...verification.endpoint_tests.map(e => `| ${e.endpoint} | ${e.status === 'passed' ? '✅ PASS' : '❌ FAIL'} | ${e.verdict || '—'} |`),
    ...verification.integration_tests.map(i => `| ${i.name} | ${i.status === 'passed' ? '✅ PASS' : '❌ FAIL'} | ${i.verdict || '—'} |`)
  ]

  let md = `## Koda Report — commit ${meta.commit}
**${new Date(meta.timestamp).toLocaleString()}** | Risk: ${riskEmoji[diff_summary.risk_level] || '⚪'} ${diff_summary.risk_level.toUpperCase()}

### What changed
${diff_summary.files_changed.map(f => `- \`${f}\``).join('\n')}

### Verification Results
| Test | Status | Verdict |
|------|--------|---------|
${rows.join('\n')}
`

  if (memory_context?.patterns?.length) {
    md += `
### ⚠ Patterns Detected
${memory_context.patterns.map(p => `- **${p.flow}** — failed ${p.occurrences} times. ${p.note}`).join('\n')}
`
  }

  if (memory_context?.similar_failures?.length) {
    md += `
### Memory Context
Similar past failures:
${memory_context.similar_failures.map(f => `- commit ${f.commit}: ${f.verdict}`).join('\n')}
`
  }

  if (action_required.failures > 0) {
    md += `
### Agent Action Required
Priority: **${action_required.priority.toUpperCase()}**

Focus on:
${action_required.suggested_focus.map((f, i) => `${i + 1}. ${f}`).join('\n')}
`
  } else {
    md += `
### ✅ All checks passed. Clean commit.
`
  }

  return md
}

export function showLastReport() {
  const reportsDir = path.join(process.cwd(), '.koda', 'reports')
  if (!fs.existsSync(reportsDir)) {
    console.log(chalk.dim('\n  No reports yet. Make a commit.\n'))
    return
  }

  const files = fs.readdirSync(reportsDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()

  if (!files.length) {
    console.log(chalk.dim('\n  No reports yet. Make a commit.\n'))
    return
  }

  const latest = path.join(reportsDir, files[0])
  console.log('\n' + fs.readFileSync(latest, 'utf-8'))
}
```

---

## 14. CI/CD Generator

**core/cicd-generator.js:**
```javascript
import fs from 'fs'
import path from 'path'
import Groq from 'groq-sdk'
import chalk from 'chalk'
import dotenv from 'dotenv'
dotenv.config()

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function generateCICD() {
  console.log(chalk.cyan('\n  [Koda] Setting up CI/CD...\n'))

  const configPath = path.join(process.cwd(), '.koda', 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const packageJsonPath = path.join(process.cwd(), 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

  // Ask agent to describe the project for CI context
  const prompt = `You are generating a GitHub Actions CI/CD config for a project.

Project name: ${config.project}
Framework/dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}
Test script: ${packageJson.scripts?.test || 'none'}
Start command: ${packageJson.scripts?.dev || packageJson.scripts?.start || 'npm start'}
App port: ${config.kane.target.split(':').pop()}

Generate a GitHub Actions workflow YAML that:
1. Runs on push to main and pull requests
2. Installs dependencies
3. Starts the app in the background
4. Waits for the app to be ready
5. Runs Kane CLI verification
6. Reports pass/fail

Output ONLY the YAML content, no explanation.`

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500
    })

    const yaml = response.choices[0].message.content
      .replace(/```yaml|```/g, '')
      .trim()

    const workflowDir = path.join(process.cwd(), '.github', 'workflows')
    fs.mkdirSync(workflowDir, { recursive: true })

    const workflowPath = path.join(workflowDir, 'koda.yml')
    fs.writeFileSync(workflowPath, yaml)

    console.log(chalk.green(`  ✓ CI/CD config written to .github/workflows/koda.yml`))
    console.log(chalk.dim('  → Add KANE_USERNAME and KANE_ACCESS_KEY to your GitHub secrets\n'))

  } catch (err) {
    // Fallback to template
    const template = generateFallbackCICD(config, packageJson)
    const workflowDir = path.join(process.cwd(), '.github', 'workflows')
    fs.mkdirSync(workflowDir, { recursive: true })
    fs.writeFileSync(path.join(workflowDir, 'koda.yml'), template)
    console.log(chalk.green('  ✓ CI/CD config written (template)'))
  }
}

function generateFallbackCICD(config, packageJson) {
  const port = config.kane.target.split(':').pop() || '3000'
  const startCmd = packageJson.scripts?.start || 'npm start'

  return `name: Koda Verification

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  koda-verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Install Kane CLI
        run: npm install -g @testmuai/kane-cli

      - name: Authenticate Kane CLI
        run: kane-cli login --username \${{ secrets.KANE_USERNAME }} --access-key \${{ secrets.KANE_ACCESS_KEY }}

      - name: Start app
        run: ${startCmd} &

      - name: Wait for app
        run: npx wait-on http://localhost:${port} --timeout 30000

      - name: Run Koda verification
        run: npx koda run --commit \${{ github.sha }}
`
}
```

---

## 15. MCP Server

**mcp/server.js:**
```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { runLoop } from '../core/index.js'
import { loadMemory } from '../core/memory.js'
import { showLastReport } from '../core/reporter.js'
import { generateCICD } from '../core/cicd-generator.js'
import fs from 'fs'
import path from 'path'

const server = new McpServer({
  name: 'koda',
  version: '0.2.0'
})

// Tool 1 — Run verification
server.tool(
  'koda_verify',
  'Run Koda verification on the current commit. Returns pass/fail summary.',
  {
    commit: z.string().optional().describe('Commit hash to verify. Defaults to HEAD.')
  },
  async ({ commit = 'HEAD' }) => {
    await runLoop({ commit })

    const reportsDir = path.join(process.cwd(), '.koda', 'reports')
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.json'))
      .sort().reverse()

    if (!files.length) {
      return { content: [{ type: 'text', text: 'No report generated.' }] }
    }

    const report = JSON.parse(
      fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8')
    )

    const summary = `Koda verification complete.
Commit: ${report.meta.commit}
Failures: ${report.action_required.failures}
Passed: ${report.action_required.passed}
Priority: ${report.action_required.priority}
${report.action_required.failures > 0
      ? '\nFocus on:\n' + report.action_required.suggested_focus.map(f => `- ${f}`).join('\n')
      : '\nAll checks passed. Clean commit.'
    }`

    return { content: [{ type: 'text', text: summary }] }
  }
)

// Tool 2 — Get full report
server.tool(
  'koda_report',
  'Get the full Koda report for the last verified commit as JSON.',
  {},
  async () => {
    const reportsDir = path.join(process.cwd(), '.koda', 'reports')

    if (!fs.existsSync(reportsDir)) {
      return { content: [{ type: 'text', text: 'No reports found. Run a commit first.' }] }
    }

    const files = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.json'))
      .sort().reverse()

    if (!files.length) {
      return { content: [{ type: 'text', text: 'No reports yet.' }] }
    }

    const report = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8')
    return { content: [{ type: 'text', text: report }] }
  }
)

// Tool 3 — Get memory
server.tool(
  'koda_memory',
  'Get project verification memory — past failures, patterns, fix history.',
  {},
  async () => {
    const memory = loadMemory()
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(memory, null, 2)
      }]
    }
  }
)

// Tool 4 — Setup CI/CD
server.tool(
  'koda_setup_cicd',
  'Generate and install a Kane-powered CI/CD config for this project.',
  {},
  async () => {
    await generateCICD()
    return {
      content: [{
        type: 'text',
        text: 'CI/CD config generated at .github/workflows/koda.yml'
      }]
    }
  }
)

// Start server
const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[Koda MCP] Server running on stdio')
```

**Add to package.json scripts:**
```json
"mcp": "node mcp/server.js"
```

**To register with Claude Code:**
```bash
claude mcp add koda node /path/to/koda/mcp/server.js
```

**To register with any MCP-compatible agent:**
```json
{
  "mcpServers": {
    "koda": {
      "command": "node",
      "args": ["/path/to/koda/mcp/server.js"]
    }
  }
}
```

---

## 16. Plugins

**plugins/notify.js:**
```javascript
import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()

export async function sendNotification(report) {
  const { action_required, meta } = report
  if (action_required.failures === 0) return // only notify on failures

  const message = `❌ Koda — ${action_required.failures} failure(s) on commit ${meta.commit}\n` +
    action_required.suggested_focus.slice(0, 3).map(f => `• ${f}`).join('\n')

  await Promise.allSettled([
    sendTelegram(message),
    sendDiscord(message)
  ])
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message
  })
}

async function sendDiscord(message) {
  const webhook = process.env.DISCORD_WEBHOOK_URL
  if (!webhook) return

  await axios.post(webhook, {
    embeds: [{ description: message, color: 0xFF0000 }]
  })
}
```

**plugins/env-scan.js:**
```javascript
const PATTERNS = [
  { regex: /0x[0-9a-fA-F]{64}/, label: 'Private key' },
  { regex: /sk-[a-zA-Z0-9]{32,}/, label: 'OpenAI API key' },
  { regex: /gsk_[a-zA-Z0-9]{32,}/, label: 'Groq API key' },
  { regex: /-----BEGIN.*PRIVATE KEY-----/, label: 'Private key block' },
  { regex: /ANTHROPIC_API_KEY\s*=\s*["']?sk-/, label: 'Anthropic API key' }
]

export function scanForSecrets(content) {
  return PATTERNS
    .filter(p => p.regex.test(content))
    .map(p => p.label)
}
```

---

## 17. VS Code Extension

**extension/package.json:**
```json
{
  "name": "koda",
  "displayName": "Koda",
  "description": "Verification and memory layer for every coding agent.",
  "version": "0.2.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["workspaceContains:.git"],
  "main": "./extension.js",
  "contributes": {
    "commands": [
      {
        "command": "koda.init",
        "title": "Koda: Initialize in this project"
      },
      {
        "command": "koda.report",
        "title": "Koda: Show last report"
      },
      {
        "command": "koda.memory",
        "title": "Koda: Show project memory"
      }
    ]
  },
  "dependencies": {
    "koda": "latest"
  }
}
```

**extension/extension.js:**
```javascript
const vscode = require('vscode')
const { execSync, exec } = require('child_process')
const path = require('path')
const fs = require('fs')

function activate(context) {
  // Auto-install hook on every workspace open
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (workspaceFolders) {
    workspaceFolders.forEach(folder => {
      autoInstall(folder.uri.fsPath)
    })
  }

  // Watch for new workspace folders
  vscode.workspace.onDidChangeWorkspaceFolders(event => {
    event.added.forEach(folder => autoInstall(folder.uri.fsPath))
  })

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('koda.init', () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (folder) {
        exec('npx koda init', { cwd: folder }, (err, stdout) => {
          if (err) {
            vscode.window.showErrorMessage(`Koda: ${err.message}`)
          } else {
            vscode.window.showInformationMessage('Koda initialized in this project')
          }
        })
      }
    }),

    vscode.commands.registerCommand('koda.report', () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!folder) return

      const reportsDir = path.join(folder, '.koda', 'reports')
      if (!fs.existsSync(reportsDir)) {
        vscode.window.showInformationMessage('No Koda reports yet. Make a commit first.')
        return
      }

      const files = fs.readdirSync(reportsDir)
        .filter(f => f.endsWith('.md'))
        .sort().reverse()

      if (!files.length) {
        vscode.window.showInformationMessage('No Koda reports yet.')
        return
      }

      const reportPath = path.join(reportsDir, files[0])
      vscode.workspace.openTextDocument(reportPath).then(doc => {
        vscode.window.showTextDocument(doc)
      })
    })
  )

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left, 100
  )
  statusBar.text = '$(shield) Koda'
  statusBar.tooltip = 'Koda — verification active'
  statusBar.command = 'koda.report'
  statusBar.show()
  context.subscriptions.push(statusBar)
}

function autoInstall(projectPath) {
  // Only install if it's a git repo and Koda isn't already installed
  const gitDir = path.join(projectPath, '.git')
  const kodaDir = path.join(projectPath, '.koda')
  const hookPath = path.join(gitDir, 'hooks', 'post-commit')

  if (!fs.existsSync(gitDir)) return
  if (fs.existsSync(hookPath) && fs.readFileSync(hookPath, 'utf-8').includes('Koda')) return

  exec('npx koda init', { cwd: projectPath }, (err) => {
    if (!err) {
      vscode.window.showInformationMessage(
        `Koda: Verification active in ${path.basename(projectPath)}`
      )
    }
  })
}

module.exports = { activate, deactivate: () => {} }
```

---

## 18. Demo Script (3 minutes)

This is exactly what judges see. Rehearse this sequence:

```
0:00 — Open any existing project with a known bug in it
       "I have a checkout app with a broken payment flow"

0:15 — Run: npx koda init
       Show the hook installing silently

0:30 — Make a commit with the broken code
       git add . && git commit -m "add payment handler"

0:40 — Koda fires automatically in the background
       Show the terminal output:
       [Koda] Verification starting...
       → Reading diff...
       → Querying agent for context...
       → Running Kane verification...
       ✗ 2 failures detected. Report sent to agent.

1:00 — Open .koda/reports/report-abc1234.md
       Show the plain English report:
       ❌ Submit button does nothing after card entry
       ❌ POST /api/payment returns 500 when amount is null

1:20 — Open Claude Code (or Cursor)
       Show it reading the JSON report via MCP:
       koda_report → returns structured JSON
       Agent reads it → fixes both issues → commits

1:40 — Second commit triggers Koda again
       ✓ All 3 checks passed. Clean commit.

1:55 — Run: koda memory
       Show pattern detection:
       → CheckoutForm submit handler (flagged 2x)

2:10 — Run: koda cicd
       Show GitHub Actions config generated
       "Add KANE_USERNAME and KANE_ACCESS_KEY to your secrets"

2:30 — Done. Leave 30s for questions.
```

---

## 19. Submission Checklist

Before Aug 30, 7:30 PM GMT+1:

- [ ] GitHub repo initialized on or after Aug 19
- [ ] README: one-command install + what Koda does + Kane integration explained
- [ ] Demo video: 3 minutes, the exact sequence above, unlisted YouTube
- [ ] `npx koda init` works in under 60 seconds
- [ ] MCP server registers with Claude Code via `claude mcp add koda`
- [ ] At least one real Kane verification run in the demo — real failure caught
- [ ] TestMu AI account active, Kane CLI authenticated
- [ ] Submit at surveymonkey.com/r/kane-cli-hackathon-submission

---

*Install once. Commit forever. Koda watches.*
