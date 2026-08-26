import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import dotenv from 'dotenv'

export function findProjectRoot(explicit) {
  let dir = path.resolve(explicit || process.env.KODA_PROJECT || process.cwd())
  while (true) {
    if (fs.existsSync(path.join(dir, '.koda'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function resolveRoot(explicit) {
  const root = findProjectRoot(explicit)
  if (!root) throw new Error('Koda is not initialized here. Run `koda init` first.')
  return root
}

export function loadKodaEnv(root) {
  if (root) dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true })
  dotenv.config({ path: path.join(os.homedir(), '.koda', '.env'), override: false, quiet: true })
}

export function readConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.koda', 'config.json'), 'utf8')) }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Koda config is missing. Run `koda init` again.')
    throw new Error(`Koda config is invalid: ${error.message}`)
  }
}
