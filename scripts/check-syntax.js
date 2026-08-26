import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function filesIn(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesIn(file) : entry.name.endsWith('.js') ? [file] : []
  })
}

const files = ['bin', 'cli', 'core', 'mcp', 'plugins', 'scripts'].flatMap(filesIn)
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log(`Checked ${files.length} JavaScript files.`)
