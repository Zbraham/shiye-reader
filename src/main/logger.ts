/**
 * Platform-neutral logging. Desktop installs a file sink in
 * `logger-node.ts`; the Android build installs a console sink. Logging must
 * never be able to take the app down, so every sink call is guarded.
 */

export type LogSink = (level: 'info' | 'error', scope: string, message: string) => void

let sink: LogSink | null = null

export function setLogSink(next: LogSink | null): void {
  sink = next
}

function write(level: 'info' | 'error', scope: string, message: string): void {
  try {
    sink?.(level, scope, message)
  } catch {
    // Logging must never take the app down.
  }
}

export function logInfo(scope: string, message: string): void {
  write('info', scope, message)
}

export function logError(scope: string, error: unknown): void {
  const message =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  write('error', scope, message)
}
