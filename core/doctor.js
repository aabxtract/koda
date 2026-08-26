import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { execFileResult } from './process.js'
import { checkTarget } from './target.js'
import { readConfig, resolveRoot, loadKodaEnv } from './root.js'

function kaneInvocation() {
  if (process.platform === 'win32') {
    return {
      command: process.execPath,
      prefix: [path.join(process.env.APPDATA || path.dirname(process.execPath), 'npm', 'node_modules', '@testmuai', 'kane-cli', 'bin', 'kane-cli.cjs')]
    }
  }
  return { command: 'kane-cli', prefix: [] }
}
function commandExists(command, args = ['--version']) {
  return execFileResult(command, args).then(() => true).catch(() => false)
}

export async function runDoctor({ project, kaneProbe = false, logger }) {
  const checks = []
  let root
  try { root = resolveRoot(project); checks.push(['pass', 'Project', root]) }
  catch (error) { checks.push(['fail', 'Project', error.message]); root = path.resolve(project || process.cwd()) }
  loadKodaEnv(root)
  try {
    const { stdout } = await execFileResult('git', ['rev-parse', '--absolute-git-dir'], { cwd: root })
    checks.push(['pass', 'Git', stdout.trim()])
  } catch { checks.push(['fail', 'Git', 'Not a Git repository']) }
  let config
  try { config = readConfig(root); checks.push(['pass', 'Config', config.kane.target]) }
  catch (error) { checks.push(['fail', 'Config', error.message]) }
  const kane = kaneInvocation()
  checks.push([await commandExists(kane.command, [...kane.prefix, '--version']) ? 'pass' : 'fail', 'Kane CLI', kane.prefix[0] || kane.command])
  checks.push([process.env.GROQ_API_KEY ? 'pass' : 'warn', 'Groq', process.env.GROQ_API_KEY ? 'configured' : 'not configured; fallback analysis only'])
  if (config) {
    const health = await checkTarget(config.kane.target)
    checks.push([health.up ? 'pass' : 'warn', 'Target', health.up ? `HTTP ${health.status}` : 'not responding'])
  }
  for (const directory of ['reports', 'memory', 'evidence']) {
    const absolute = path.join(root, '.koda', directory)
    checks.push([fs.existsSync(absolute) ? 'pass' : 'fail', directory, absolute])
  }
  if (kaneProbe && config) {
    const observed = await probeKane(root, kane, config.kane.target)
    checks.push([observed.error ? 'warn' : 'pass', 'Kane schema', observed.error || observed.keys.join(', ') || 'No JSON keys observed'])
  }
  for (const [status, name, detail] of checks) logger.info(`${status.toUpperCase().padEnd(4)} ${name}: ${detail}`)
  return { ok: checks.every(([status]) => status !== 'fail'), checks }
}

function probeKane(root, invocation, target) {
  return new Promise(resolve => {
    const child = spawn(invocation.command, [...invocation.prefix, 'run', `Go to ${target} and confirm the page responds`, '--agent', '--headless', '--max-steps', '2'],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const keys = new Set()
    let buffer = ''
    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) { try { Object.keys(JSON.parse(line)).forEach(key => keys.add(key)) } catch {} }
    })
    child.once('error', error => resolve({ error: error.message, keys: [] }))
    child.once('close', () => resolve({ keys: [...keys] }))
    setTimeout(() => { child.kill(); resolve({ error: 'Probe timed out', keys: [...keys] }) }, 30000)
  })
}
