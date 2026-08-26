import fs from 'node:fs'
import path from 'node:path'
import { execFileResult } from '../../core/process.js'
import { SECRET_PATTERNS } from '../../plugins/env-scan.js'

function ensureParent(file) { fs.mkdirSync(path.dirname(file), { recursive: true }) }

export function installHookFile(hookPath, body) {
  const marker = '# Koda'
  ensureParent(hookPath)
  if (fs.existsSync(hookPath)) {
    const current = fs.readFileSync(hookPath, 'utf8')
    if (current.includes(marker)) return 'already-installed'
    fs.copyFileSync(hookPath, `${hookPath}.koda-backup`)
    fs.appendFileSync(hookPath, `\n${marker}\n${body.trim()}\n`)
    fs.chmodSync(hookPath, 0o755)
    return 'appended'
  }
  fs.writeFileSync(hookPath, `#!/bin/sh\n${marker}\n${body.trim()}\n`)
  fs.chmodSync(hookPath, 0o755)
  return 'created'
}

function hookDirectory(root, gitDir) {
  const husky = path.join(root, '.husky')
  return fs.existsSync(husky) ? husky : path.join(gitDir, 'hooks')
}

export async function installHooks(root) {
  const { stdout } = await execFileResult('git', ['rev-parse', '--absolute-git-dir'], { cwd: root })
  const gitDir = stdout.trim()
  const directory = hookDirectory(root, gitDir)
  const preCommit = `
if [ "\${KODA_SKIP_GUARD:-0}" = "1" ]; then exit 0; fi
ROOT="$(git rev-parse --show-toplevel)"
if git diff --cached --diff-filter=ACM -- . ':(exclude)*.lock' ':(exclude)*-lock.json' | grep -qE -f "$ROOT/.koda/secret-patterns.txt"; then
  echo "Koda: possible secret detected; commit blocked."
  exit 1
fi
exit 0`
  const postCommit = `
ROOT="$(git rev-parse --show-toplevel)"
SHA="$(git rev-parse HEAD)"
if command -v koda >/dev/null 2>&1; then
  koda run --project "$ROOT" --commit "$SHA" >> "$ROOT/.koda/koda.log" 2>&1 &
fi
exit 0`
  const prePush = `
ROOT="$(git rev-parse --show-toplevel)"
if [ ! -f "$ROOT/.github/workflows/koda.yml" ]; then
  echo "Koda: no CI verification workflow found. Run 'koda cicd' to create one."
fi
exit 0`
  return {
    directory,
    preCommit: installHookFile(path.join(directory, 'pre-commit'), preCommit),
    postCommit: installHookFile(path.join(directory, 'post-commit'), postCommit),
    prePush: installHookFile(path.join(directory, 'pre-push'), prePush)
  }
}

export function writeSecretPatterns(root) {
  const file = path.join(root, '.koda', 'secret-patterns.txt')
  fs.writeFileSync(file, `${SECRET_PATTERNS.map(pattern => pattern.ere).join('\n')}\n`)
}
