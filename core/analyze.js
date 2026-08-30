import Groq from 'groq-sdk'
import { detectAgent } from './detect-agent.js'
import { loadKodaEnv } from './root.js'

function normalizeSupplied(supplied = {}) {
  return {
    affected_flows: (supplied.flows || supplied.affected_flows || []).map(item =>
      typeof item === 'string' ? { flow: item, likely_files: [] } : { likely_files: [], ...item }),
    affected_endpoints: supplied.endpoints || supplied.affected_endpoints || [],
    affected_integrations: supplied.integrations || supplied.affected_integrations || [],
    reasoning: supplied.reasoning || 'Impact analysis supplied by the calling agent.'
  }
}

function fallback(diff, agent) {
  const flows = diff.has_page_changes || diff.has_component_changes
    ? [{ flow: 'confirm the page loads with visible content and no error messages', likely_files: diff.file_paths.slice(0, 3) }]
    : []
  return {
    affected_flows: flows,
    affected_endpoints: [],
    affected_integrations: [],
    reasoning: 'Deterministic fallback used because no agent or model analysis was available.',
    agent,
    analysis_source: 'fallback'
  }
}

export async function analyzeImpact(root, diff, supplied = null) {
  const agent = supplied?.agent || detectAgent(root)
  if (supplied && (supplied.flows?.length || supplied.affected_flows?.length || supplied.endpoints?.length)) {
    return { ...normalizeSupplied(supplied), agent, analysis_source: 'agent' }
  }
  loadKodaEnv(root)
  if (!process.env.GROQ_API_KEY) return fallback(diff, agent)
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const prompt = `Analyze this commit for focused verification. Return JSON only with affected_flows, affected_endpoints, affected_integrations, and reasoning. Each affected_flows item must contain flow and likely_files. Endpoints must contain method, path, description, optional sample_body. Never invent destructive checks.\nFiles: ${diff.file_paths.join(', ')}\nRisk: ${diff.risk_level}\nDiff:\n${diff.raw.slice(0, 12000)}`
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}')
    return { ...normalizeSupplied(parsed), agent, analysis_source: 'llm-fallback' }
  } catch {
    return fallback(diff, agent)
  }
}
