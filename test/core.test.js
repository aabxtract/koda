import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFile } from '../core/diff.js'
import { checkKey, fuzzyMatch } from '../core/keys.js'
import { defaultMemory, reconcileMemory } from '../core/memory.js'

test('Next app API routes are classified as API before page routes', () => {
  assert.equal(classifyFile('app/api/payment/route.ts'), 'api')
  assert.equal(classifyFile('app/checkout/page.tsx'), 'page')
})

test('flow keys tolerate wording changes', () => {
  const first = checkKey({ flow: 'Verify checkout submits a card payment successfully' })
  const second = checkKey({ flow: 'Card payment submits successfully during checkout' })
  assert.ok(fuzzyMatch(first, new Set([second]), 0.5))
})

test('memory records failures and resolves them when a matching check passes', () => {
  const memory = defaultMemory()
  reconcileMemory(memory, [{ flow: 'Complete checkout with card', status: 'failed', verdict: 'Button did nothing' }], 'aaaaaaa')
  assert.equal(memory.failures.length, 1)
  assert.equal(memory.failures[0].resolved, false)
  reconcileMemory(memory, [{ flow: 'Complete checkout with card', status: 'passed' }], 'bbbbbbb')
  assert.equal(memory.failures[0].resolved, true)
  assert.equal(memory.total_fixes, 1)
})

test('skipped checks never enter failure memory', () => {
  const memory = defaultMemory()
  reconcileMemory(memory, [{ flow: 'Open dashboard', status: 'skipped', verdict: 'App offline' }], 'aaaaaaa')
  assert.equal(memory.failures.length, 0)
})

test('bare hosts normalize with the right protocol', async () => {
  const { normalizeTarget } = await import('../core/target.js')
  assert.equal(normalizeTarget('myapp.vercel.app'), 'https://myapp.vercel.app')
  assert.equal(normalizeTarget('192.168.1.5:8080'), 'http://192.168.1.5:8080')
  assert.equal(normalizeTarget('localhost:3000'), 'http://localhost:3000')
  assert.equal(normalizeTarget('https://staging.example.com/'), 'https://staging.example.com')
  assert.equal(normalizeTarget('ftp://nope'), null)
})

test('target resolution follows override > env > config precedence', async () => {
  const { resolveTarget } = await import('../core/target.js')
  const config = { kane: { target: 'http://localhost:3000' } }
  assert.equal(resolveTarget(config, 'https://preview.deploy.com'), 'https://preview.deploy.com')
  process.env.KODA_TARGET = 'http://localhost:9999'
  assert.equal(resolveTarget(config), 'http://localhost:9999')
  delete process.env.KODA_TARGET
  assert.equal(resolveTarget(config), 'http://localhost:3000')
})

test('coverage-gap failures resolve when a passing test covers the flagged files', async () => {
  const { defaultMemory, reconcileMemory } = await import('../core/memory.js')
  const memory = defaultMemory()
  reconcileMemory(memory, [{ name: 'Test coverage', status: 'failed', verdict: 'No tests cover 1 changed file(s): app/page.js', affected_files: ['app/page.js'], coverage: true }], 'aaa')
  assert.equal(memory.failures[0].resolved, false)
  const fixed = reconcileMemory(memory, [{ name: 'node: app/page.test.js', status: 'passed', affected_files: ['app/page.test.js'] }], 'bbb')
  assert.equal(memory.failures[0].resolved, true)
  assert.equal(fixed, 1)
  assert.ok(memory.failures[0].resolved_in_commit === 'bbb')
})
