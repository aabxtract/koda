import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

function readPackage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return {} }
}

function detectRunner(pkg) {
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
  if (dependencies.jest) return { command: 'jest', args: ['--passWithNoTests'] }
  if (dependencies.vitest) return { command: 'vitest', args: ['run', '--passWithNoTests'] }
  if (dependencies.mocha) return { command: 'mocha', args: [] }
  return null
}

export function testsFor(root, changedPaths) {
  const matches = []
  for (const changed of changedPaths) {
    if (/\.(test|spec)\.[jt]sx?$/.test(changed)) { matches.push(changed); continue }
    const parsed = path.parse(changed)
    const bases = [
      path.join(parsed.dir, `${parsed.name}.test`), path.join(parsed.dir, `${parsed.name}.spec`),
      path.join(parsed.dir, '__tests__', parsed.name)
    ]
    for (const base of bases) {
      for (const extension of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = `${base}${extension}`
        if (fs.existsSync(path.join(root, candidate))) matches.push(candidate)
      }
    }
  }
  return [...new Set(matches)]
}

function runCommand(root, runner, targets) {
  return new Promise(resolve => {
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const child = spawn(command, ['--no-install', runner.command, ...runner.args, ...targets],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    child.once('error', error => resolve({ code: 1, output: error.message }))
    child.once('close', code => resolve({ code, output }))
  })
}

export async function runIntegrationTests(root, changedPaths) {
  const relevant = changedPaths.filter(file => !/\.(md|json|ya?ml|lock)$/.test(file) && !file.includes('.koda/'))
  if (!relevant.length) return []
  const runner = detectRunner(readPackage(root))
  if (!runner) return [{ name: 'Test runner', status: 'skipped', verdict: 'No supported test runner detected' }]
  const targets = testsFor(root, relevant)
  if (!targets.length) return [{
    name: 'Test coverage', status: 'failed',
    verdict: `No tests cover ${relevant.length} changed file(s): ${relevant.slice(0, 3).join(', ')}`,
    affected_files: relevant
  }]
  const result = await runCommand(root, runner, targets)
  const lastLine = result.output.trim().split(/\r?\n/).filter(Boolean).at(-1)
  return [{
    name: `${runner.command}: ${targets.join(', ')}`,
    status: result.code === 0 ? 'passed' : 'failed',
    verdict: result.code === 0 ? null : lastLine || `${runner.command} exited ${result.code}`,
    affected_files: targets
  }]
}
