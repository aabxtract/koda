import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

function readPackage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return {} }
}

export function guessTarget(root, existingConfig) {
  if (existingConfig?.kane?.target) return existingConfig.kane.target
  const pkg = readPackage(root)
  const scripts = Object.values(pkg.scripts || {}).join(' ')
  const port = scripts.match(/(?:--port|-p)[= ](\d{2,5})/)?.[1]
    || scripts.match(/PORT=(\d{2,5})/)?.[1]
    || (pkg.dependencies?.vite || pkg.devDependencies?.vite ? '5173' : '3000')
  return `http://localhost:${port}`
}

export async function checkTarget(target, timeout = 3000) {
  try {
    const response = await axios.get(target, { timeout, validateStatus: () => true })
    return { up: true, status: response.status }
  } catch (error) { return { up: false, error: error.message } }
}
