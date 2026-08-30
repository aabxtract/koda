const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const isWin = process.platform === 'win32'

function commandResult(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, windowsHide: true, timeout: options.timeout || 30000, shell: isWin }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return }
      resolve({ stdout, stderr })
    })
  })
}

function kaneInvocation(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const entrypoint = path.join(env.APPDATA || path.dirname(process.execPath), 'npm', 'node_modules', '@testmuai', 'kane-cli', 'bin', 'kane-cli.cjs')
    if (fs.existsSync(entrypoint)) return { command: process.execPath, prefix: [entrypoint] }
    return { command: 'kane-cli.cmd', prefix: [] }
  }
  return { command: 'kane-cli', prefix: [] }
}

function kodaInvocation(platform = process.platform, env = process.env, configured = null, baseDir = __dirname) {
  if (configured) return { command: configured, prefix: [] }
  // Check for local bin/koda.js relative to this extension directory (dev / repo install)
  const localEntrypoint = path.join(baseDir, '..', 'bin', 'koda.js')
  if (fs.existsSync(localEntrypoint)) return { command: process.execPath, prefix: [localEntrypoint] }
  if (platform === 'win32') {
    const npmRoot = path.join(env.APPDATA || path.dirname(process.execPath), 'npm', 'node_modules')
    for (const folder of ['koda-verify', 'koda']) {
      const entrypoint = path.join(npmRoot, folder, 'bin', 'koda.js')
      if (fs.existsSync(entrypoint)) return { command: process.execPath, prefix: [entrypoint] }
    }
    return { command: 'koda.cmd', prefix: [] }
  }
  return { command: 'koda', prefix: [] }
}
function npmInvocation(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (fs.existsSync(npmCli)) return { command: process.execPath, prefix: [npmCli] }
    return { command: 'npm.cmd', prefix: [] }
  }
  return { command: 'npm', prefix: [] }
}

function invoke(invocation, args, options = {}) {
  return commandResult(invocation.command, [...invocation.prefix, ...args], options)
}
async function kaneInstalled(run = () => invoke(kaneInvocation(), ['--version'])) { try { await run(); return true } catch { return false } }
async function kaneAuthenticated(run = () => invoke(kaneInvocation(), ['whoami'])) { try { await run(); return true } catch { return false } }
async function installKane(run = () => invoke(npmInvocation(), ['install', '-g', '@testmuai/kane-cli'])) { await run() }

async function ensureKaneReady({ promptInstall, chooseLogin, invokeKane = args => invoke(kaneInvocation(), args), invokeNpm = args => invoke(npmInvocation(), args) }) {
  if (!(await kaneInstalled(() => invokeKane(['--version'])))) {
    if (!(await promptInstall())) return { ready: false, reason: 'install-declined' }
    try { await installKane(() => invokeNpm(['install', '-g', '@testmuai/kane-cli'])) }
    catch (error) { return { ready: false, reason: 'install-failed', error } }
    if (!(await kaneInstalled(() => invokeKane(['--version'])))) return { ready: false, reason: 'install-unavailable' }
  }
  if (await kaneAuthenticated(() => invokeKane(['whoami']))) return { ready: true, authenticated: true }
  const mode = await chooseLogin()
  if (!mode) return { ready: false, reason: 'login-cancelled' }
  try {
    if (mode.type === 'oauth') await invokeKane(['login', '--oauth'])
    else await invokeKane(['login', '--username', mode.username, '--access-key', mode.accessKey])
    return await kaneAuthenticated(() => invokeKane(['whoami']))
      ? { ready: true, authenticated: true }
      : { ready: false, reason: 'login-not-confirmed' }
  } catch (error) { return { ready: false, reason: 'login-failed', error } }
}

module.exports = { commandResult, kaneInvocation, kodaInvocation, npmInvocation, kaneInstalled, kaneAuthenticated, installKane, ensureKaneReady }
