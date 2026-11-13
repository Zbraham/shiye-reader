export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super('config', message)
    this.name = 'ConfigError'
  }
}

export class CancelledError extends AppError {
  constructor(message = '已停止') {
    super('cancelled', message)
    this.name = 'CancelledError'
  }
}

export class EmptyResponseError extends AppError {
  constructor(message = '模型返回为空。重试？') {
    super('empty_response', message)
    this.name = 'EmptyResponseError'
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof CancelledError) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  return false
}

export function toReadableMessage(error: unknown): string {
  if (error instanceof AppError) return error.message
  if (isAbortError(error)) return '已停止'
  if (error instanceof Error) {
    const message = error.message.trim()
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(message)) {
      return '连接模型服务失败。检查网络与接口地址后重试。'
    }
    if (message.length > 160) return `${message.slice(0, 160)}…`
    return message || '发生未知错误'
  }
  return '发生未知错误'
}
