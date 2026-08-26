import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { resolveRoot, readConfig } from './root.js'

function readPackage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return {} }
}

function workflow(config, pkg) {
  const target = new URL(config.kane.target)
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')
  const build = pkg.scripts?.build ? 'npm run build' : null
  const start = pkg.scripts?.start ? 'npm start' : pkg.scripts?.dev ? 'npm run dev' : 'npm start'
  return {
    name: 'Koda Verification',
    on: { push: { branches: ['main'] }, pull_request: { branches: ['main'] } },
    jobs: {
      'koda-verify': {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          { name: 'Setup Node.js', uses: 'actions/setup-node@v4', with: { 'node-version': '20', cache: 'npm' } },
          { name: 'Install dependencies', run: 'npm ci' },
          ...(build ? [{ name: 'Build app', run: build }] : []),
          { name: 'Install Kane CLI', run: 'npm install -g @testmuai/kane-cli' },
          { name: 'Start app', run: `${start} &` },
          { name: 'Wait for app', run: `npx --yes wait-on http://localhost:${port} --timeout 60000` },
          { name: 'Run Koda verification', run: 'npx --no-install koda run --commit ${{ github.sha }}' }
        ]
      }
    }
  }
}

export function generateCICD({ project, force = false, logger }) {
  const root = resolveRoot(project)
  const file = path.join(root, '.github', 'workflows', 'koda.yml')
  if (fs.existsSync(file) && !force) throw new Error('CI workflow already exists. Use --force to replace it.')
  const value = workflow(readConfig(root), readPackage(root))
  const output = yaml.dump(value, { lineWidth: 120, noRefs: true, quotingType: '"' })
  yaml.load(output)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, output)
  logger?.info(`CI workflow written to ${file}`)
  return file
}
