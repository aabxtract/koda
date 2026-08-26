const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'to', 'for', 'of', 'is', 'it', 'that', 'when', 'after', 'verify', 'check'])

function words(value = '') {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word && !STOP_WORDS.has(word)))]
}

export function checkKey(result) {
  if (result.endpoint) return `endpoint:${result.endpoint.toLowerCase()}`
  if (result.name) return `test:${result.name.toLowerCase()}`
  return `flow:${words(result.flow).sort().slice(0, 8).join('-')}`
}

export function fuzzyMatch(key, candidates, threshold = 0.6) {
  if (candidates.has(key)) return key
  if (!key.startsWith('flow:')) return null
  const left = new Set(key.slice(5).split('-').filter(Boolean))
  for (const candidate of candidates) {
    if (!candidate.startsWith('flow:')) continue
    const right = new Set(candidate.slice(5).split('-').filter(Boolean))
    const union = new Set([...left, ...right])
    const overlap = [...left].filter(word => right.has(word)).length
    if (union.size && overlap / union.size >= threshold) return candidate
  }
  return null
}
