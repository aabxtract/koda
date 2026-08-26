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
