const test = require('node:test')
const assert = require('node:assert/strict')
const { ensureKaneReady, kaneInvocation, npmInvocation } = require('../extension/onboarding')

test('Windows resolves Kane to the direct Node entrypoint when globally installed', () => {
  const result = kaneInvocation('win32', { APPDATA: 'C:\\does-not-exist' })
  assert.equal(typeof result.command, 'string')
  assert.ok(Array.isArray(result.prefix))
})

test('Windows npm invocation has a platform-specific command', () => {
  const result = npmInvocation('win32', { APPDATA: 'C:\\does-not-exist' })
  assert.ok(result.command === 'npm.cmd' || result.command.endsWith('node.exe'))
})

test('declining Kane installation stops onboarding before init', async () => {
  const result = await ensureKaneReady({
    promptInstall: async () => false,
    chooseLogin: async () => null,
    invokeKane: async () => { throw new Error('missing') }
  })
  assert.deepEqual(result, { ready: false, reason: 'install-declined' })
})

test('already authenticated Kane completes without login', async () => {
  const calls = []
  const result = await ensureKaneReady({
    promptInstall: async () => true,
    chooseLogin: async () => ({ type: 'oauth' }),
    invokeKane: async args => { calls.push(args); return {} },
    invokeNpm: async () => { throw new Error('must not install') }
  })
  assert.equal(result.ready, true)
  assert.deepEqual(calls, [['--version'], ['whoami']])
})

test('OAuth login is confirmed with a second whoami check', async () => {
  let authenticated = false
  const calls = []
  const result = await ensureKaneReady({
    promptInstall: async () => true,
    chooseLogin: async () => ({ type: 'oauth' }),
    invokeKane: async args => {
      calls.push(args)
      if (args[0] === 'whoami' && !authenticated) throw new Error('not logged in')
      if (args[0] === 'login') authenticated = true
      return {}
    },
    invokeNpm: async () => {}
  })
  assert.equal(result.ready, true)
  assert.deepEqual(calls, [['--version'], ['whoami'], ['login', '--oauth'], ['whoami']])
})

test('access key login receives username and key without persistence', async () => {
  let authenticated = false
  const calls = []
  const result = await ensureKaneReady({
    promptInstall: async () => true,
    chooseLogin: async () => ({ type: 'access-key', username: 'user', accessKey: 'secret' }),
    invokeKane: async args => {
      calls.push(args)
      if (args[0] === 'whoami' && !authenticated) throw new Error('not logged in')
      if (args[0] === 'login') authenticated = true
      return {}
    },
    invokeNpm: async () => {}
  })
  assert.equal(result.ready, true)
  assert.deepEqual(calls[2], ['login', '--username', 'user', '--access-key', 'secret'])
})

test('failed login returns a retryable failure state', async () => {
  const result = await ensureKaneReady({
    promptInstall: async () => true,
    chooseLogin: async () => ({ type: 'oauth' }),
    invokeKane: async args => {
      if (args[0] === 'whoami' || args[0] === 'login') throw new Error('login failed')
      return {}
    },
    invokeNpm: async () => {}
  })
  assert.equal(result.ready, false)
  assert.equal(result.reason, 'login-failed')
})
