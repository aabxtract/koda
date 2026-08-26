import fs from 'node:fs'
import path from 'node:path'
import { KODA_VERSION } from './constants.js'
import { execFileResult } from './process.js'
import { guessTarget } from './target.js'
import { installHooks, writeSecretPatterns } from '../cli/installer/hooks.js'

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function appendGitignore(root) {
  const file = path.join(root, '.gitignore')
  const marker = '# Koda'
  const entry = `${marker}\n.koda/reports/\n.koda/memory/\n.koda/evidence/\n.koda/koda.log\n`
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!current.includes(marker)) fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${entry}`)
}

export async function initializeProject({ project = process.cwd(), force = false, logger }) {
  const root = path.resolve(project)
  try { await execFileResult('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }) }
  catch { throw new Error('Not a Git repository. Run `git init` first.') }
  const kodaDir = path.join(root, '.koda')
  for (const directory of ['reports', 'memory', 'evidence']) fs.mkdirSync(path.join(kodaDir, directory), { recursive: true })
  const configFile = path.join(kodaDir, 'config.json')
  const existing = readJson(configFile)
  if (!existing || force) {
    const config = {
      schema: 1, version: KODA_VERSION, project: path.basename(root),
      kane: { target: guessTarget(root, existing), headless: true, max_steps: 30, timeout_ms: 120000 },
      tests: { browser_flows: true, endpoint_tests: true, integration_tests: true, allow_mutating_methods: false, expected_statuses: {} },
      cicd: { notify_on_push: true }, notify: { telegram: false, discord: false }
    }
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
  }
  writeSecretPatterns(root)
  appendGitignore(root)
  const hooks = await installHooks(root)
  logger?.info(`Koda initialized in ${root}`)
  logger?.info(`Target: ${readJson(configFile).kane.target}`)
  logger?.info(`Hooks: ${hooks.directory}`)
  return { root, hooks, config: readJson(configFile) }
}
