import fs from 'node:fs'
import path from 'node:path'
import { KODA_VERSION, REPORT_SCHEMA } from './constants.js'
import { memoryContext } from './memory.js'

function safeTimestamp(iso) { return iso.replace(/[:.]/g, '-') }
function statusLabel(status) { return status === 'passed' ? 'PASS' : status === 'skipped' ? 'SKIPPED' : 'FAIL' }

function focusFor(failure, changedFiles) {
  const likely = failure.likely_files || failure.affected_files || []
  if (likely[0]) return `${likely[0]} — ${failure.verdict}`
  const endpointParts = (failure.endpoint || '').toLowerCase().split(/[^a-z0-9]+/).filter(part => part.length > 2)
  const matched = changedFiles.find(file => endpointParts.some(part => file.toLowerCase().includes(part)))
  return matched ? `${matched} — ${failure.verdict}` : failure.verdict
}

export function generateReport({ root, commit, diff, agentContext, browserResults, endpointResults, integrationResults, memory }) {
  const timestamp = new Date().toISOString()
  const allResults = [...browserResults, ...endpointResults, ...integrationResults]
  const failures = allResults.filter(result => result.status === 'failed')
  const passed = allResults.filter(result => result.status === 'passed')
  const skipped = allResults.filter(result => result.status === 'skipped')
  const contexts = failures.flatMap(result => memoryContext(memory, result).similar)
  const confidences = failures.map(result => memoryContext(memory, result).fix_confidence)
  const fixConfidence = confidences.includes('high') ? 'high' : confidences.includes('medium') ? 'medium' : 'low'
  const report = {
    schema: REPORT_SCHEMA,
    meta: {
      commit: commit.slice(0, 7), full_commit: commit, timestamp,
      project: path.basename(root), agent: agentContext.agent || 'unknown',
      analysis_source: agentContext.analysis_source, koda_version: KODA_VERSION
    },
    diff_summary: { files_changed: diff.file_paths, risk_level: diff.risk_level, affected_flows: agentContext.affected_flows },
    verification: { browser_flows: browserResults, endpoint_tests: endpointResults, integration_tests: integrationResults },
    memory_context: failures.length ? { similar_failures: contexts.slice(-5), patterns: memory.patterns, fix_confidence: fixConfidence } : null,
    action_required: {
      priority: failures.length === 0 ? 'none' : diff.risk_level === 'high' ? 'critical' : diff.risk_level === 'medium' ? 'high' : 'medium',
      failures: failures.length, passed: passed.length, skipped: skipped.length,
      coverage_complete: skipped.length === 0,
      suggested_focus: failures.map(result => focusFor(result, diff.file_paths)).filter(Boolean)
    }
  }
  const base = `${safeTimestamp(timestamp)}-${commit.slice(0, 7)}`
  const directory = path.join(root, '.koda', 'reports')
  fs.mkdirSync(directory, { recursive: true })
  const jsonPath = path.join(directory, `${base}.json`)
  const mdPath = path.join(directory, `${base}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(mdPath, markdownReport(report))
  return { report, jsonPath, mdPath }
}

export function markdownReport(report) {
  const groups = [
    ...report.verification.browser_flows.map(item => [item.flow, item]),
    ...report.verification.endpoint_tests.map(item => [item.endpoint, item]),
    ...report.verification.integration_tests.map(item => [item.name, item])
  ]
  const rows = groups.map(([name, item]) => `| ${name} | ${statusLabel(item.status)} | ${item.verdict || '—'} |`).join('\n')
  let output = `# Koda Report — ${report.meta.commit}\n\nRisk: **${report.diff_summary.risk_level}**  \nAnalysis: **${report.meta.analysis_source}** (${report.meta.agent})\n\n## Changed files\n\n${report.diff_summary.files_changed.map(file => `- \`${file}\``).join('\n')}\n\n## Verification\n\n| Check | Status | Verdict |\n|---|---|---|\n${rows || '| No checks selected | SKIPPED | Nothing relevant was selected |'}\n`
  if (report.memory_context?.patterns?.length) output += `\n## Patterns\n\n${report.memory_context.patterns.map(pattern => `- ${pattern.flow}: ${pattern.occurrences} occurrences`).join('\n')}\n`
  if (report.action_required.failures) output += `\n## Action required\n\n${report.action_required.suggested_focus.map((focus, index) => `${index + 1}. ${focus}`).join('\n')}\n`
  else output += `\n## Result\n\nNo verification failures were detected.${report.action_required.skipped ? ' Coverage was incomplete because some checks were skipped.' : ''}\n`
  return output
}

export function latestReportPath(root, extension = '.json') {
  const directory = path.join(root, '.koda', 'reports')
  if (!fs.existsSync(directory)) return null
  return fs.readdirSync(directory).filter(file => file.endsWith(extension)).sort().at(-1)
    ? path.join(directory, fs.readdirSync(directory).filter(file => file.endsWith(extension)).sort().at(-1)) : null
}

export function readLatestReport(root) {
  const file = latestReportPath(root, '.json')
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

export function showLastReport(root, logger) {
  const file = latestReportPath(root, '.md')
  logger.info(file ? fs.readFileSync(file, 'utf8') : 'No Koda reports yet.')
}
