import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { createLogger } from '../core/logger.js'
import { initializeProject } from '../core/init.js'
import { runLoop } from '../core/index.js'
import { resolveRoot } from '../core/root.js'
import { showLastReport } from '../core/reporter.js'
import { showMemory } from '../core/memory.js'
import { generateCICD } from '../core/cicd-generator.js'
import { runDoctor } from '../core/doctor.js'
import { KODA_VERSION } from '../core/constants.js'

export async function main(argv) {
  const logger = createLogger(process.stdout)
  const program = new Command()
  program.name('koda').description('Verification and memory layer for coding-agent workflows.').version(KODA_VERSION)
  program.command('init').option('--project <path>').option('--force').action(options =>
    initializeProject({ project: options.project || process.cwd(), force: options.force, logger }))
  program.command('run').option('--project <path>').option('--commit <sha>', 'Commit to verify', 'HEAD').option('--max-flows <count>', 'Maximum browser flows', Number)
    .action(options => runLoop({ project: options.project, commit: options.commit, maxFlows: options.maxFlows ?? Infinity, logger }))
  program.command('report').option('--project <path>').action(options => showLastReport(resolveRoot(options.project), logger))
  program.command('memory').option('--project <path>').action(options => showMemory(resolveRoot(options.project), logger))
  program.command('cicd').option('--project <path>').option('--force').action(options => generateCICD({ project: options.project, force: options.force, logger }))
  program.command('doctor').option('--project <path>').option('--kane').action(options => runDoctor({ project: options.project, kaneProbe: options.kane, logger }))
  program.command('mcp').description('Start the Koda MCP server').action(() => new Promise((resolve, reject) => {
    const file = fileURLToPath(new URL('../mcp/server.js', import.meta.url))
    const child = spawn(process.execPath, [file], { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', code => { process.exitCode = code ?? 1; resolve() })
  }))
  await program.parseAsync(argv)
}


