import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initializeProject } from '../core/init.js'
import { readDiff } from '../core/diff.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-smoke-'))
execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite --port 4567' } }))
const existingHook = path.join(root, '.git', 'hooks', 'post-commit')
fs.writeFileSync(existingHook, '#!/bin/sh\necho existing\n')
await initializeProject({ project: root, logger: { info() {}, warn() {}, error() {} } })
const config = JSON.parse(fs.readFileSync(path.join(root, '.koda', 'config.json'), 'utf8'))
if (config.kane.target !== 'http://localhost:4567') throw new Error(`Unexpected target ${config.kane.target}`)
if (!fs.existsSync(`${existingHook}.koda-backup`)) throw new Error('Existing hook was not backed up')
fs.writeFileSync(path.join(root, 'index.js'), 'export default 1\n')
execFileSync('git', ['add', '.'], { cwd: root })
execFileSync('git', ['-c', 'user.name=Koda Test', '-c', 'user.email=koda@example.test', 'commit', '-m', 'first'], { cwd: root, stdio: 'ignore' })
const diff = await readDiff(root, 'HEAD')
if (!diff.commit || !diff.file_paths.includes('index.js')) throw new Error('First-commit diff failed')
console.log(JSON.stringify({ root, target: config.kane.target, commit: diff.commit.slice(0, 7), files: diff.file_paths }))
