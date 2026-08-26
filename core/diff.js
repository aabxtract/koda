import path from 'node:path'
import { execFileResult } from './process.js'

export function classifyFile(file) {
  const normalized = file.replaceAll('\\', '/').toLowerCase()
  if (/(^|\/)api(\/|$)/.test(normalized) || /(^|\/)route\.(ts|tsx|js|jsx)$/.test(normalized)) return 'api'
  if (/(^|\/)(pages|app)(\/|$)/.test(normalized) && /(^|\/)(page|layout)\.(ts|tsx|js|jsx)$/.test(normalized)) return 'page'
  if (/(^|\/)components(\/|$)/.test(normalized) || /\.(tsx|jsx)$/.test(normalized)) return 'component'
  if (/(^|\/)(lib|utils|helpers)(\/|$)/.test(normalized)) return 'lib'
  if (/config\.|(^|\/)\.env|package\.json|next\.config/.test(normalized)) return 'config'
  if (/\.test\.|\.spec\.|__tests__/.test(normalized)) return 'test'
  return 'other'
}

function assessRisk(files) {
  const types = new Set(files.map(file => file.type))
  if (types.has('api') && types.has('page')) return 'high'
  if (types.has('api') || types.has('page') || types.has('component')) return 'medium'
  return 'low'
}

export async function resolveCommit(root, commit = 'HEAD') {
  const { stdout } = await execFileResult('git', ['rev-parse', commit], { cwd: root })
  return stdout.trim()
}

export async function readDiff(root, commit = 'HEAD') {
  const resolved = await resolveCommit(root, commit)
  const [{ stdout: names }, { stdout: raw }] = await Promise.all([
    execFileResult('git', ['diff-tree', '--root', '-m', '--no-commit-id', '--name-only', '-r', resolved], { cwd: root }),
    execFileResult('git', ['show', '--format=', '--no-ext-diff', resolved], { cwd: root })
  ])
  const filePaths = [...new Set(names.split(/\r?\n/).filter(Boolean))]
  const files = filePaths.map(file => ({ path: file, name: path.basename(file), type: classifyFile(file) }))
  return {
    commit: resolved,
    files_changed: files,
    file_paths: filePaths,
    has_api_changes: files.some(file => file.type === 'api'),
    has_page_changes: files.some(file => file.type === 'page'),
    has_component_changes: files.some(file => file.type === 'component'),
    risk_level: assessRisk(files),
    raw
  }
}
