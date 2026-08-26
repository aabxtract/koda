import fs from 'node:fs'
import path from 'node:path'
import { MEMORY_SCHEMA } from './constants.js'
import { checkKey, fuzzyMatch } from './keys.js'

export function defaultMemory() {
  return { schema: MEMORY_SCHEMA, failures: [], patterns: [], total_fixes: 0, updated_at: null }
}

function memoryFile(root) { return path.join(root, '.koda', 'memory', 'koda.memory.json') }

export function loadMemory(root) {
  const file = memoryFile(root)
  if (!fs.existsSync(file)) return defaultMemory()
  try { return { ...defaultMemory(), ...JSON.parse(fs.readFileSync(file, 'utf8')) } }
  catch {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    fs.renameSync(file, backup)
    return defaultMemory()
  }
}

export function saveMemory(root, memory) {
  const file = memoryFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  memory.updated_at = new Date().toISOString()
  fs.writeFileSync(tmp, JSON.stringify(memory, null, 2))
  fs.renameSync(tmp, file)
}

function rebuildPatterns(memory) {
  const grouped = new Map()
  for (const failure of memory.failures) {
    const entries = grouped.get(failure.key) || []
    entries.push(failure)
    grouped.set(failure.key, entries)
  }
  memory.patterns = [...grouped.entries()].filter(([, entries]) => entries.length >= 2).map(([key, entries]) => ({
    key,
    flow: entries.at(-1).label,
    occurrences: entries.length,
    resolved: entries.filter(entry => entry.resolved).length,
    note: 'Recurring verification failure'
  }))
}

export function reconcileMemory(memory, results, commit) {
  const now = new Date().toISOString()
  const passingKeys = new Set(results.filter(result => result.status === 'passed').map(checkKey))
  let fixed = 0
  for (const failure of memory.failures) {
    if (!failure.resolved && fuzzyMatch(failure.key, passingKeys)) {
      failure.resolved = true
      failure.resolved_at = now
      failure.resolved_in_commit = commit
      failure.time_to_fix_ms = Date.parse(now) - Date.parse(failure.timestamp)
      fixed += 1
    }
  }
  for (const result of results.filter(item => item.status === 'failed')) {
    const key = checkKey(result)
    memory.failures.push({
      key,
      label: result.flow || result.endpoint || result.name,
      verdict: result.verdict,
      affected_files: result.likely_files || result.affected_files || [],
      commit,
      timestamp: now,
      resolved: false
    })
  }
  memory.total_fixes += fixed
  rebuildPatterns(memory)
  return fixed
}

export function memoryContext(memory, result) {
  const key = checkKey(result)
  const candidates = new Set([key])
  const similar = memory.failures.filter(failure => fuzzyMatch(failure.key, candidates)).slice(-5)
  const rate = similar.length ? similar.filter(item => item.resolved).length / similar.length : 0
  return { similar, fix_confidence: similar.length < 2 ? 'low' : rate > 0.7 ? 'high' : rate > 0.3 ? 'medium' : 'low' }
}

export function showMemory(root, logger) {
  logger.info(JSON.stringify(loadMemory(root), null, 2))
}
