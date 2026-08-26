import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { runLoop } from '../core/index.js'
import { resolveRoot } from '../core/root.js'
import { readLatestReport } from '../core/reporter.js'
import { loadMemory } from '../core/memory.js'
import { generateCICD } from '../core/cicd-generator.js'
import { KODA_VERSION } from '../core/constants.js'

const server = new Server({ name: 'koda', version: KODA_VERSION }, { capabilities: { tools: {} } })
const tools = [
  { name: 'koda_verify', description: 'Run focused Koda verification for a commit.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, commit: { type: 'string' }, max_flows: { type: 'integer', minimum: 1, maximum: 20 }, flows: { type: 'array' }, endpoints: { type: 'array' } } } },
  { name: 'koda_report', description: 'Read the latest Koda JSON report.', inputSchema: { type: 'object', properties: { project: { type: 'string' } } } },
  { name: 'koda_memory', description: 'Read Koda project memory.', inputSchema: { type: 'object', properties: { project: { type: 'string' } } } },
  { name: 'koda_setup_cicd', description: 'Generate a validated Koda GitHub Actions workflow.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, force: { type: 'boolean' } } } }
]
const logger = () => ({ info: value => process.stderr.write(`${value}\n`), warn: value => process.stderr.write(`${value}\n`), error: value => process.stderr.write(`${value}\n`) })
const text = value => ({ content: [{ type: 'text', text: value }] })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
server.setRequestHandler(CallToolRequestSchema, async request => {
  const args = request.params.arguments || {}
  try {
    if (request.params.name === 'koda_verify') {
      const result = await runLoop({ project: args.project, commit: args.commit || 'HEAD', maxFlows: args.max_flows || 2, impact: { flows: args.flows, endpoints: args.endpoints }, logger: logger() })
      if (!result.report) return text('No changed files found.')
      const report = result.report
      const cap = result.requested > result.selected ? `\nVerified ${result.selected} of ${result.requested} flows (max_flows=${args.max_flows || 2}).` : ''
      return text(`Koda verification complete.\nCommit: ${report.meta.commit}\nFailures: ${report.action_required.failures}\nPassed: ${report.action_required.passed}\nSkipped: ${report.action_required.skipped}\nPriority: ${report.action_required.priority}${cap}`)
    }
    if (request.params.name === 'koda_report') {
      const report = readLatestReport(resolveRoot(args.project))
      return text(report ? JSON.stringify(report, null, 2) : 'No reports found.')
    }
    if (request.params.name === 'koda_memory') return text(JSON.stringify(loadMemory(resolveRoot(args.project)), null, 2))
    if (request.params.name === 'koda_setup_cicd') return text(`CI workflow generated at ${generateCICD({ project: args.project, force: args.force || false, logger: logger() })}`)
    throw new Error(`Unknown tool: ${request.params.name}`)
  } catch (error) { return { ...text(`Koda error: ${error.message}`), isError: true } }
})

await server.connect(new StdioServerTransport())
process.stderr.write('[Koda MCP] Server running on stdio\n')
