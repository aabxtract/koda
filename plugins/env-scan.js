export const SECRET_PATTERNS = [
  { regex: /0x[0-9a-fA-F]{64}/, ere: '0x[0-9a-fA-F]{64}', label: 'Private key' },
  { regex: /sk-[a-zA-Z0-9_-]{32,}/, ere: 'sk-[a-zA-Z0-9_-]{32,}', label: 'OpenAI-style API key' },
  { regex: /gsk_[a-zA-Z0-9]{32,}/, ere: 'gsk_[a-zA-Z0-9]{32,}', label: 'Groq API key' },
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, ere: '-----BEGIN [A-Z ]*PRIVATE KEY-----', label: 'Private key block' }
]

export function scanForSecrets(content = '') {
  return SECRET_PATTERNS.filter(pattern => pattern.regex.test(content)).map(pattern => pattern.label)
}
