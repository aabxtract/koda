import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

const COMMON_PORTS = [3000, 5173, 8080, 8000, 4200, 5000, 3001]

function readPackage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return {} }
}

function scriptPortHint(pkg) {
  const scripts = Object.values(pkg.scripts || {}).join(' ')
  return scripts.match(/(?:--port|-p)[= ](\d{2,5})/)?.[1] || scripts.match(/PORT=(\d{2,5})/)?.[1] || null
}

function defaultPort(pkg) {
  return pkg.dependencies?.vite || pkg.devDependencies?.vite ? '5173' : '3000'
}

// Accepts bare hosts ('myapp.vercel.app', '192.168.1.5:8080', 'localhost:3000')
// or full URLs; picks http for local/private addresses, https otherwise.
export function normalizeTarget(input) {
  let value = String(input || '').trim().replace(/\/+$/, '')
  if (!value) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null
  if (!/^https?:\/\//i.test(value)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value)
    value = (isLocal ? 'http://' : 'https://') + value
  }
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol) || !url.hostname) return null
    return url.origin + (url.pathname === '/' ? '' : url.pathname)
  } catch { return null }
}

// Precedence: explicit override > KODA_TARGET env > project config > localhost default.
export function resolveTarget(config, override = null) {
  for (const candidate of [override, process.env.KODA_TARGET, config?.kane?.target]) {
    const normalized = normalizeTarget(candidate)
    if (normalized) return normalized
  }
  return 'http://localhost:3000'
}

export function guessTarget(root, existingConfig) {
  if (existingConfig?.kane?.target) return existingConfig.kane.target
  const pkg = readPackage(root)
  return `http://localhost:${scriptPortHint(pkg) || defaultPort(pkg)}`
}

// Probe candidate ports and trust whatever is actually running; falls back to
// the script hint (or 3000/5173) when nothing responds.
export async function detectTarget(root, existingConfig) {
  const existing = normalizeTarget(existingConfig?.kane?.target)
  if (existing) return existing
  const pkg = readPackage(root)
  const hinted = scriptPortHint(pkg)
  const candidates = [...new Set([hinted, defaultPort(pkg), ...COMMON_PORTS].filter(Boolean))]
  for (const port of candidates) {
    const candidate = `http://localhost:${port}`
    if ((await checkTarget(candidate, 400)).up) return candidate
  }
  return `http://localhost:${hinted || defaultPort(pkg)}`
}

export async function checkTarget(target, timeout = 3000) {
  try {
    const response = await axios.get(target, { timeout, validateStatus: () => true })
    return { up: true, status: response.status }
  } catch (error) { return { up: false, error: error.message } }
}
