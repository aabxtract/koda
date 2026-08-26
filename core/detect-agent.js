import fs from 'node:fs'
import path from 'node:path'

export function detectAgent(root) {
  const signs = [
    { agent: 'claude-code', env: 'CLAUDECODE', marker: '.claude' },
    { agent: 'cursor', env: 'CURSOR_TRACE_ID', marker: '.cursor' },
    { agent: 'codex', env: 'CODEX_SANDBOX', marker: '.codex' },
    { agent: 'gemini-cli', env: 'GEMINI_CLI', marker: '.gemini' }
  ]
  for (const sign of signs) {
    if (process.env[sign.env] || fs.existsSync(path.join(root, sign.marker))) return sign.agent
  }
  return 'unknown'
}
