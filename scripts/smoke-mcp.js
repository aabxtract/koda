import { spawn } from 'node:child_process'
import readline from 'node:readline'

const child = spawn(process.execPath, ['mcp/server.js'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
const lines = readline.createInterface({ input: child.stdout })
const responses = []
const waitFor = id => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for MCP response ${id}`)), 10000)
  const handler = line => {
    try {
      const message = JSON.parse(line)
      if (message.id === id) { clearTimeout(timeout); lines.off('line', handler); resolve(message) }
    } catch {}
  }
  lines.on('line', handler)
})
const send = value => child.stdin.write(`${JSON.stringify(value)}\n`)
child.stderr.on('data', () => {})
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'koda-smoke', version: '1.0.0' } } })
responses.push(await waitFor(1))
send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
responses.push(await waitFor(2))
child.kill()
const tools = responses[1].result?.tools || []
if (!tools.some(tool => tool.name === 'koda_verify')) throw new Error('koda_verify was not advertised')
console.log(JSON.stringify({ initialized: Boolean(responses[0].result), tools: tools.map(tool => tool.name) }))
