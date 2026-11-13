import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import {
  setTransport,
  TransportError,
  type HttpTransport,
  type StreamHandlers,
  type StreamRequest
} from '@main/llm/transport'
import { newId } from '@main/ids'
import { isNative } from './storage'

interface NativePostOptions {
  id: string
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
}

interface NativePostResult {
  status: number
  contentType: string
  body: string
}

interface NativeMetaEvent {
  id: string
  status: number
  contentType: string
}

interface NativeChunkEvent {
  id: string
  text: string
}

interface NativeHttpPlugin {
  postStream(options: NativePostOptions): Promise<NativePostResult>
  cancel(options: { id: string }): Promise<void>
  addListener(
    eventName: 'meta',
    listener: (event: NativeMetaEvent) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'chunk',
    listener: (event: NativeChunkEvent) => void
  ): Promise<PluginListenerHandle>
}

const NativeHttp = registerPlugin<NativeHttpPlugin>('NativeHttp')

function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '')
  }
  return ''
}

const nativeTransport: HttpTransport = {
  async postStream(request: StreamRequest, handlers: StreamHandlers) {
    const id = newId()
    const listeners: PluginListenerHandle[] = []
    let metaReady = false
    let callbackError: unknown = null
    let received = ''
    const pending: string[] = []

    const deliver = (text: string): void => {
      if (!text || callbackError) return
      try {
        handlers.onChunk?.(text)
      } catch (error) {
        callbackError = error
        void NativeHttp.cancel({ id })
      }
    }

    const onAbort = (): void => {
      void NativeHttp.cancel({ id })
    }
    request.signal.addEventListener('abort', onAbort)

    try {
      listeners.push(
        await NativeHttp.addListener('meta', (event) => {
          if (event.id !== id) return
          metaReady = true
          try {
            handlers.onMeta?.({
              status: event.status,
              ok: event.status >= 200 && event.status < 300,
              contentType: event.contentType
            })
          } catch (error) {
            callbackError = error
            void NativeHttp.cancel({ id })
            return
          }
          for (const text of pending.splice(0)) deliver(text)
        })
      )
      listeners.push(
        await NativeHttp.addListener('chunk', (event) => {
          if (event.id !== id) return
          if (!metaReady) {
            pending.push(event.text)
            return
          }
          received += event.text
          deliver(event.text)
        })
      )

      const result = await NativeHttp.postStream({
        id,
        url: request.url,
        headers: request.headers,
        body: request.body,
        timeoutMs: request.timeoutMs
      })

      if (callbackError) throw callbackError
      // The native side returns the decoded body. If the last bridge events
      // arrived late, hand the missing tail to the caller now.
      if (result.body.startsWith(received)) deliver(result.body.slice(received.length))

      return {
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        contentType: result.contentType,
        body: result.body
      }
    } catch (error) {
      if (callbackError) throw callbackError
      if (request.signal.aborted) {
        throw new TransportError('abort', '已停止')
      }
      const code = failureCode(error)
      if (code === 'timeout') throw new TransportError('timeout', '请求超时')
      if (code === 'aborted' || code === 'cancelled') {
        throw new TransportError('abort', '已停止')
      }
      throw new TransportError(
        'network',
        error instanceof Error ? error.message : '连接模型服务失败'
      )
    } finally {
      request.signal.removeEventListener('abort', onAbort)
      for (const listener of listeners) {
        try {
          await listener.remove()
        } catch {
          // The bridge may already be gone during shutdown.
        }
      }
    }
  }
}

export function installNativeTransport(): void {
  if (isNative()) setTransport(nativeTransport)
}
