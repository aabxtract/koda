export function createLogger(stream = process.stdout) {
  return {
    info(message = '') { stream.write(`${message}\n`) },
    warn(message = '') { stream.write(`${message}\n`) },
    error(message = '') { stream.write(`${message}\n`) }
  }
}

export const silentLogger = { info() {}, warn() {}, error() {} }
