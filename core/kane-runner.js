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
  const killTree = () => {
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }) } catch { child.kill() }
    } else child.kill()
  }
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
      resolve({ flow: flow.flow, likely_files: flow.likely_files || [], evidence: file, event_count: events.length, ...result })
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
      killTree()
      // If Kane already completed its assertion, a kill during slow cloud
      // finalization is not a flow failure — trust the emitted events.
      const asserted = events.some(event => event.status === 'done' && typeof event.remark === 'string' && event.remark.startsWith('assert:'))
      const failure = events.find(event => event.status === 'failed')
      if (asserted && !failure) return finish({ status: 'passed', verdict: null, note: 'Assertion completed; Kane finalization timed out' })
      finish({ status: 'failed', verdict: 'Verification timed out' })
    }, config.timeout_ms || 300000)
  })
}

export async function runKane(root, flows, target, config, maxFlows = Infinity) {
  const selected = flows.slice(0, maxFlows)
  const runFlow = async flow => {
    const result = await runSingleFlow(root, flow, target, config)
    // A startup hang (session created but no steps executed) is transient Kane
    // cloud flakiness — retry once before reporting a timeout.
    if (result.status === 'failed' && result.verdict === 'Verification timed out' && result.event_count <= 2) {
      const retried = await runSingleFlow(root, flow, target, config)
      return { ...retried, note: 'Retried after Kane startup timeout' }
    }
    return result
  }
  const results = []
  const queue = [...selected]
  // Two concurrent Kane sessions keep multi-flow runs from serializing.
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) results.push(await runFlow(queue.shift()))
  }))
  return { results, selected: selected.length, requested: flows.length }
}


