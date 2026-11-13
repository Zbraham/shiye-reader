/**
 * HTTP transport used by the remote model writer.
 *
 * The desktop build uses `fetch` directly. The Android build installs a
 * transport backed by a native HTTP plugin, because WebView `fetch` is subject
 * to CORS and many OpenAI-compatible endpoints do not send CORS headers.
 */

export interface StreamRequest {
  url: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
  timeoutMs: number
}

export interface StreamMeta {
  status: number
  ok: boolean
  contentType: string
}

export interface StreamOutcome extends StreamMeta {
  /** Full response body. For successful streams this mirrors the emitted chunks. */
  body: string
}

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void
  onChunk?: (text: string) => void
}

export type TransportFailure = 'network' | 'timeout' | 'abort' | 'stream'

export class TransportError extends Error {
  constructor(
    readonly kind: TransportFailure,
    message: string,
    readonly status = 0
  ) {
    super(message)
    this.name = 'TransportError'
  }
}

export interface HttpTransport {
  postStream(request: StreamRequest, handlers: StreamHandlers): Promise<StreamOutcome>
}

function reasonName(signal: AbortSignal): string {
  const reason = (signal as { reason?: unknown }).reason
  if (reason && typeof reason === 'object' && 'name' in reason) {
    return String((reason as { name?: unknown }).name)
  }
  return ''
}

const fetchTransport: HttpTransport = {
  async postStream(request, handlers) {
    let response: Response
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: request.signal
      })
    } catch (error) {
      if (request.signal.aborted) {
        if (reasonName(request.signal) === 'TimeoutError') {
          throw new TransportError('timeout', '请求超时')
        }
        throw new TransportError('abort', '已停止')
      }
      throw new TransportError(
        'network',
        error instanceof Error ? error.message : '网络请求失败'
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    const meta: StreamMeta = {
      status: response.status,
      ok: response.ok,
      contentType
    }
    handlers.onMeta?.(meta)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return { ...meta, body }
    }

    if (!response.body) return { ...meta, body: '' }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let body = ''
    for (;;) {
      let text = ''
      let done = false
      try {
        const chunk = await reader.read()
        done = chunk.done
        if (!done) text = decoder.decode(chunk.value, { stream: true })
      } catch (error) {
        if (request.signal.aborted) {
          if (reasonName(request.signal) === 'TimeoutError') {
            throw new TransportError('timeout', '请求超时')
          }
          throw new TransportError('abort', '已停止')
        }
        throw new TransportError(
          'stream',
          error instanceof Error ? error.message : '生成中断'
        )
      }
      if (done) break
      if (text) {
        body += text
        handlers.onChunk?.(text)
      }
    }
    const tail = decoder.decode()
    if (tail) {
      body += tail
      handlers.onChunk?.(tail)
    }
    return { ...meta, body }
  }
}

let current: HttpTransport = fetchTransport

export function setTransport(transport: HttpTransport): void {
  current = transport
}

export function getTransport(): HttpTransport {
  return current
}
