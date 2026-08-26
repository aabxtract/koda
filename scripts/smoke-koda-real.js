import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initializeProject } from '../core/init.js'
import { runLoop } from '../core/index.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-real-'))
execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'koda-real-smoke', version: '1.0.0' }, null, 2))
fs.writeFileSync(path.join(root, 'index.js'), 'export const heading = "Example Domain"\n')
await initializeProject({ project: root, logger: { info() {}, warn() {}, error() {} } })
const configFile = path.join(root, '.koda', 'config.json')
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
config.kane.target = 'https://example.com'
config.tests.integration_tests = false
fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
execFileSync('git', ['add', '.'], { cwd: root })
execFileSync('git', ['-c', 'user.name=Koda Test', '-c', 'user.email=koda@example.test', 'commit', '-m', 'first'], { cwd: root, stdio: 'ignore' })
const result = await runLoop({
  project: root,
  commit: 'HEAD',
  impact: { flows: [{ flow: 'Verify the Example Domain heading', likely_files: ['index.js'] }], endpoints: [] },
  maxFlows: 1,
  logger: { info: console.log, warn: console.log, error: console.error }
})
console.log(JSON.stringify({ root, meta: result.report?.meta, action: result.report?.action_required, reportPath: result.mdPath }, null, 2))
