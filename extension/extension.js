const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { ensureKaneReady, kodaInvocation, npmInvocation, commandResult } = require('./onboarding')

function root() { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null }
function cli() {
  return kodaInvocation(process.platform, process.env, vscode.workspace.getConfiguration('koda').get('cliPath'))
}
function run(project, args) {
  return new Promise((resolve, reject) => execFile(cli().command, [...cli().prefix, ...args], { cwd: project, windowsHide: true, timeout: 180000 }, (error, stdout, stderr) => {
    if (error) { error.stderr = stderr; reject(error); return }
    resolve(stdout)
  }))
}
function latest(project, extension) {
  const directory = path.join(project, '.koda', 'reports')
  if (!fs.existsSync(directory)) return null
  const file = fs.readdirSync(directory).filter(name => name.endsWith(extension)).sort().at(-1)
  return file ? path.join(directory, file) : null
}
function refresh(status, project) {
  const file = latest(project, '.json')
  if (!file) { status.text = '$(shield) Koda'; status.backgroundColor = undefined; return }
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  const { failures, passed, skipped } = report.action_required
  status.text = failures ? `$(error) Koda ${failures}` : skipped ? '$(circle-slash) Koda - app not running' : `$(check) Koda ${passed}`
  status.backgroundColor = failures ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined
}
function watchGit(project, status) {
  const extension = vscode.extensions.getExtension('vscode.git')
  if (!extension) return
  const activated = extension.isActive ? Promise.resolve(extension.exports) : extension.activate()
  activated.then(api => {
    const repository = api.getAPI(1).repositories.find(item => item.rootUri.fsPath === project)
    if (!repository) return
    let last = null
    const verify = () => {
      const sha = repository.state.HEAD?.commit
      if (!sha || sha === last) return
      last = sha
      status.text = '$(sync~spin) Koda - verifying'
      run(project, ['run', '--project', project, '--commit', sha]).finally(() => refresh(status, project))
    }
    repository.state.onDidChange(verify)
    verify()
  }).catch(() => {})
}
async function connectKane(context, project, status) {
  status.text = '$(sync~spin) Koda - checking setup'
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Preparing Koda', cancellable: false }, async progress => ensureKaneReady({
    promptInstall: async () => {
      const choice = await vscode.window.showInformationMessage('Koda needs Kane CLI to verify browser flows. Install Kane CLI globally?', 'Install Kane', 'Cancel')
      return choice === 'Install Kane'
    },
    chooseLogin: async () => {
      const choice = await vscode.window.showInformationMessage('Connect Kane to enable Koda verification.', 'Connect in browser', 'Use access key', 'Cancel')
      if (choice === 'Connect in browser') return { type: 'oauth' }
      if (choice !== 'Use access key') return null
      const username = await vscode.window.showInputBox({ prompt: 'Kane username', ignoreFocusOut: true })
      if (!username) return null
      const accessKey = await vscode.window.showInputBox({ prompt: 'Kane access key', password: true, ignoreFocusOut: true })
      return accessKey ? { type: 'access-key', username, accessKey } : null
    },
    invokeNpm: args => {
      progress.report({ message: 'Installing Kane CLI...' })
      const npm = npmInvocation()
      return commandResult(npm.command, [...npm.prefix, ...args], { timeout: 180000 })
    }
  }))
}
function activate(context) {
  const project = root()
  if (!project) return
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  const key = `koda.enabled:${project}`
  const enabled = context.globalState.get(key)
  status.command = enabled ? 'koda.report' : 'koda.enable'
  status.text = enabled ? '$(shield) Koda' : '$(shield) Koda - click to enable'
  status.show()
  context.subscriptions.push(status)
  if (enabled) watchGit(project, status)
  context.subscriptions.push(vscode.commands.registerCommand('koda.enable', async () => {
    try {
      const kane = await connectKane(context, project, status)
      if (!kane.ready) {
        status.text = '$(key) Koda - Kane setup required'
        status.command = 'koda.enable'
        if (!['install-declined', 'login-cancelled'].includes(kane.reason)) vscode.window.showErrorMessage(`Koda setup could not finish: ${kane.error?.stderr || kane.error?.message || kane.reason}`)
        return
      }
      if (!fs.existsSync(path.join(project, '.koda'))) await run(project, ['init', '--project', project])
      await context.globalState.update(key, true)
      status.command = 'koda.report'
      refresh(status, project)
      watchGit(project, status)
      vscode.window.showInformationMessage('Koda is ready')
    } catch (error) {
      status.text = '$(key) Koda - setup required'
      status.command = 'koda.enable'
      vscode.window.showErrorMessage(`Koda: ${error.stderr || error.message}`)
    }
  }))
  context.subscriptions.push(vscode.commands.registerCommand('koda.report', () => {
    const file = latest(project, '.md')
    if (!file) return vscode.window.showInformationMessage('No Koda reports yet.')
    vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file))
  }))
  context.subscriptions.push(vscode.commands.registerCommand('koda.memory', async () => {
    const file = path.join(project, '.koda', 'memory', 'koda.memory.json')
    if (!fs.existsSync(file)) return vscode.window.showInformationMessage('No Koda memory yet.')
    vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file))
  }))
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(project, '.koda/reports/*.json'))
  watcher.onDidCreate(() => refresh(status, project))
  watcher.onDidChange(() => refresh(status, project))
  context.subscriptions.push(watcher)
}
module.exports = { activate, deactivate() {} }
