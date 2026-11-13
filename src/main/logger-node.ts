import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { setLogSink } from './logger'

const MAX_SIZE = 2 * 1024 * 1024

/** Installs a size-capped file sink at `<directory>/main.log`. */
export function initLogger(directory: string): void {
  let logFile: string | null = null
  try {
    mkdirSync(directory, { recursive: true })
    const file = join(directory, 'main.log')
    if (existsSync(file) && statSync(file).size > MAX_SIZE) {
      renameSync(file, join(directory, 'main.prev.log'))
    }
    logFile = file
  } catch {
    logFile = null
  }
  if (!logFile) return
  const target = logFile
  setLogSink((level, scope, message) => {
    try {
      const line = `${new Date().toISOString()} [${level}] ${scope}: ${message}\n`
      appendFileSync(target, line, 'utf8')
    } catch {
      // Logging must never take the app down.
    }
  })
}
