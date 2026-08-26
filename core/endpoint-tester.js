import axios from 'axios'
import { readLatestReport } from './reporter.js'

const SAFE_METHODS = new Set(['get', 'head', 'options'])

function previousResult(report, key) {
  return report?.verification?.endpoint_tests?.find(item => item.endpoint === key)
}

export async function testEndpoints(root, endpoints, target, config) {
  const results = []
  const previous = readLatestReport(root)
  const expectedStatuses = config.tests?.expected_statuses || {}
  for (const endpoint of endpoints) {
    const method = (endpoint.method || 'GET').toLowerCase()
    const key = `${method.toUpperCase()} ${endpoint.path}`
    if (!SAFE_METHODS.has(method) && !config.tests?.allow_mutating_methods) {
      results.push({ endpoint: key, status: 'skipped', verdict: `${method.toUpperCase()} skipped — mutating methods are disabled` })
      continue
    }
    try {
      const url = new URL(endpoint.path, target).toString()
      const response = await axios({
        method, url, timeout: 10000, data: endpoint.sample_body,
        headers: process.env.KODA_TEST_TOKEN ? { Authorization: `Bearer ${process.env.KODA_TEST_TOKEN}` } : {},
        validateStatus: () => true
      })
      const before = previousResult(previous, key)
      const expected = expectedStatuses[key]
      const regressed = before?.received < 400 && response.status >= 400
      const accepted = Array.isArray(expected) ? expected.includes(response.status) : response.status < 400
      const failed = regressed || response.status >= 500 || !accepted
      results.push({
        endpoint: key,
        status: failed ? 'failed' : 'passed',
        verdict: regressed ? `Regression: was ${before.received}, now ${response.status}`
          : failed ? `Unexpected HTTP ${response.status}` : null,
        received: response.status,
        previous: before?.received ?? null,
        likely_files: endpoint.likely_files || []
      })
    } catch (error) {
      results.push({ endpoint: key, status: 'failed', verdict: error.message, likely_files: endpoint.likely_files || [] })
    }
  }
  return results
}
