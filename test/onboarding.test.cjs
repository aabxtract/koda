const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ensureKaneReady, kaneInvocation, kodaInvocation, npmInvocation, shellQuote } = require('../extension/onboarding')

test('shell mode quotes arguments containing spaces and leaves plain args alone', () => {
  assert.equal(shellQuote('C:\\Program Files\\Microsoft VS Code\\Code.exe'), '"C:\\Program Files\\Microsoft VS Code\\Code.exe"')
  assert.equal(shellQuote('--version'), '--version')
  assert.equal(shellQuote('login --oauth'), '"login --oauth"')
})

test('invocations never resolve to a non-node process.execPath on Windows', () => {
  const results = [kaneInvocation('win32', { APPDATA: 'C:\\does-not-exist' }), kodaInvocation('win32', { APPDATA: 'C:\\does-not-exist' }), npmInvocation('win32', { APPDATA: 'C:\\does-not-exist' })]
  for (const result of results) {
    const isNode = result.command === process.execPath
    const isShim = /\.(cmd|bat)$/i.test(result.command)
    assert.ok(isNode || isShim, `unexpected command: ${result.command}`)
  }
})

test('Windows resolves Kane to the direct Node entrypoint when globally installed', () => {
  const result = kaneInvocation('win32', { APPDATA: 'C:\\does-not-exist' })
  assert.equal(typeof result.command, 'string')
  assert.ok(Array.isArray(result.prefix))
})

test('Windows resolves Koda to the koda-verify entrypoint when globally installed', () => {
  const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-test-'))
  const baseDir = path.join(fakeAppData, 'extension')
  const entrypoint = path.join(fakeAppData, 'npm', 'node_modules', 'koda-verify', 'bin', 'koda.js')
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true })
  fs.writeFileSync(entrypoint, '// fixture')
  const result = kodaInvocation('win32', { APPDATA: fakeAppData }, null, baseDir)
  fs.rmSync(fakeAppData, { recursive: true, force: true })
  assert.equal(result.command.endsWith('node.exe') || result.command === process.execPath, true)
  assert.deepEqual(result.prefix, [entrypoint])
})

test('Windows koda fallback without global install is the cmd shim', () => {
  const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-test-'))
  const baseDir = path.join(fakeAppData, 'extension')
  fs.mkdirSync(baseDir, { recursive: true })
  const result = kodaInvocation('win32', { APPDATA: fakeAppData }, null, baseDir)
  fs.rmSync(fakeAppData, { recursive: true, force: true })
  assert.equal(result.command, 'koda.cmd')
  assert.deepEqual(result.prefix, [])
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
