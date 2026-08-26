import { resolveRoot, readConfig, loadKodaEnv } from './root.js'
import { readDiff } from './diff.js'
import { analyzeImpact } from './analyze.js'
import { checkTarget } from './target.js'
import { runKane } from './kane-runner.js'
import { testEndpoints } from './endpoint-tester.js'
import { runIntegrationTests } from './integration-tester.js'
import { loadMemory, reconcileMemory, saveMemory } from './memory.js'
import { generateReport } from './reporter.js'
import { scanForSecrets } from '../plugins/env-scan.js'
import { sendNotification } from '../plugins/notify.js'
import { createLogger } from './logger.js'

function skippedBrowser(flows, target) {
  return flows.map(flow => ({
    flow: typeof flow === 'string' ? flow : flow.flow,
    likely_files: typeof flow === 'string' ? [] : flow.likely_files || [],
    status: 'skipped', verdict: `App not running at ${target}`
  }))
}

function skippedEndpoints(endpoints, target) {
  return endpoints.map(endpoint => ({
    endpoint: `${(endpoint.method || 'GET').toUpperCase()} ${endpoint.path}`,
    status: 'skipped', verdict: `App not running at ${target}`,
    likely_files: endpoint.likely_files || []
  }))
}

export async function runLoop({ project, commit = 'HEAD', impact = null, maxFlows = Infinity, logger = createLogger() } = {}) {
  const root = resolveRoot(project)
  loadKodaEnv(root)
  const config = readConfig(root)
  logger.info('[Koda] Verification starting')
  const diff = await readDiff(root, commit)
  if (!diff.files_changed.length) {
    logger.info('No changed files found; verification skipped.')
    return { report: null, root, selected: 0, requested: 0 }
  }
  const secrets = scanForSecrets(diff.raw)
  if (secrets.length) logger.warn(`Warning: secret patterns found in commit: ${secrets.join(', ')}`)
  const agentContext = await analyzeImpact(root, diff, impact)
  const health = await checkTarget(config.kane.target)
  let browserResults = []
  let endpointResults = []
  let selected = 0
  let requested = agentContext.affected_flows.length
  if (!health.up) {
    logger.warn(`${config.kane.target} is unavailable; browser and endpoint checks skipped.`)
    browserResults = skippedBrowser(agentContext.affected_flows, config.kane.target)
    endpointResults = skippedEndpoints(agentContext.affected_endpoints, config.kane.target)
  } else {
    if (config.tests.browser_flows) {
      const kane = await runKane(root, agentContext.affected_flows, config.kane.target, config.kane, maxFlows)
      browserResults = kane.results
      selected = kane.selected
      requested = kane.requested
    }
    if (config.tests.endpoint_tests) endpointResults = await testEndpoints(root, agentContext.affected_endpoints, config.kane.target, config)
  }
  const integrationResults = config.tests.integration_tests ? await runIntegrationTests(root, diff.file_paths) : []
  const memory = loadMemory(root)
  const allResults = [...browserResults, ...endpointResults, ...integrationResults]
  reconcileMemory(memory, allResults, diff.commit)
  saveMemory(root, memory)
  const generated = generateReport({
    root, commit: diff.commit, diff, agentContext, browserResults, endpointResults, integrationResults, memory
  })
  await sendNotification(generated.report, config)
  logger.info(`Report: ${generated.mdPath}`)
  logger.info(`${generated.report.action_required.failures} failed, ${generated.report.action_required.passed} passed, ${generated.report.action_required.skipped} skipped`)
  return { ...generated, root, selected, requested }
}
