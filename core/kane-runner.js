import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { spawn } from 'node:child_process'

function normalizeEvent(event) {
  return {
    ...event,
    type: event.type ?? event.event ?? event.kind,
    step: event.step ?? event.step_index ?? event.index,
    status: event.status ?? event.result ?? event.state,
    message: event.remark ?? event.message ?? event.error ?? event.detail ?? event.reason
  }
}

function humanize(event) {
  const message = event?.message || ''
  const lower = message.toLowerCase()
  if (lower.includes('click')) return `Nothing responds to click at step ${event.step ?? '?'}`
  if (lower.includes('not found')) return `Element missing from page at step ${event.step ?? '?'}`
  if (lower.includes('timeout')) return `Page took too long to respond at step ${event.step ?? '?'}`
  if (lower.includes('navigation')) return `App navigated incorrectly at step ${event.step ?? '?'}`
  return message || `Flow failed${event?.step != null ? ` at step ${event.step}` : ''}`
}

function evidencePath(root, flow) {
  const slug = flow.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'flow'
  const hash = crypto.createHash('sha256').update(flow).digest('hex').slice(0, 8)
  return path.join(root, '.koda', 'evidence', `${slug}-${hash}.json`)
}

export function runSingleFlow(root, flowInput, target, config) {
  const flow = typeof flowInput === 'string' ? { flow: flowInput, likely_files: [] } : flowInput
  return new Promise(resolve => {
    const args = ['run', `Go to ${target} and: ${flow.flow}`, '--agent']
    if (config.headless !== false) args.push('--headless')
    args.push('--max-steps', String(config.max_steps || 30))
    const command = process.platform === 'win32' ? process.execPath : 'kane-cli'
    const spawnArgs = process.platform === 'win32'
      ? [path.join(process.env.APPDATA || path.dirname(process.execPath), 'npm', 'node_modules', '@testmuai', 'kane-cli', 'bin', 'kane-cli.cjs'), ...args]
      : args
    const child = spawn(command, spawnArgs, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const events = []
    let stderr = ''
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const file = evidencePath(root, flow.flow)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ events, stderr }, null, 2))
      resolve({ flow: flow.flow, likely_files: flow.likely_files || [], evidence: file, ...result })
    }
    const lineReader = readline.createInterface({ input: child.stdout })
    lineReader.on('line', line => {
      try { events.push(normalizeEvent(JSON.parse(line))) } catch { /* Kane may print non-JSON diagnostics. */ }
    })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', error => finish({ status: 'failed', verdict: `Kane could not start: ${error.message}` }))
    child.once('close', code => {
      const runEnd = [...events].reverse().find(event => event.type === 'run_end')
      const failure = events.find(event => event.status === 'failed')
      if (runEnd?.status === 'passed' || (!runEnd && code === 0)) finish({ status: 'passed', verdict: null })
      else finish({
        status: 'failed',
        verdict: failure ? humanize(failure) : stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) || `kane-cli exited ${code}`,
        step_failed: failure?.step ?? null
      })
    })
    const timer = setTimeout(() => {
      child.kill()
      finish({ status: 'failed', verdict: 'Verification timed out' })
    }, config.timeout_ms || 120000)
  })
}

export async function runKane(root, flows, target, config, maxFlows = Infinity) {
  const selected = flows.slice(0, maxFlows)
  const results = []
  for (const flow of selected) results.push(await runSingleFlow(root, flow, target, config))
  return { results, selected: selected.length, requested: flows.length }
}


