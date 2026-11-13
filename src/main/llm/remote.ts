import type {
  AppSettings,
  ChapterOutline,
  ConsistencyIssue,
  RewriteTarget,
  SetupDraft,
  StorySkeleton,
  TestModelResult
} from '@shared/types'
import { AppError, ConfigError, EmptyResponseError } from '../errors'
import { logError } from '../logger'
import { getTransport, TransportError, type StreamOutcome } from './transport'
import {
  chunkRewritePrompt,
  consistencyPrompt,
  displayChunkId,
  manualRewritePrompt,
  outlinePrompt,
  selectionPrompt,
  skeletonPrompt,
  SUMMARY_PROMPT,
  TEST_PROMPT,
  verifyPrompt,
  beatsPrompt
} from './prompts'
import {
  cleanRewriteOutput,
  normalizeBeats,
  normalizeConfirmed,
  normalizeIssues,
  normalizeOutline,
  normalizeSkeleton,
  normalizeSummary,
  normalizeTargets,
  parseJsonLoose
} from './parse'
import type {
  BeatsTaskInput,
  ChapterSummary,
  ChapterWriteInput,
  CheckTaskInput,
  ManualRewriteTaskInput,
  OutlineTaskInput,
  RewriteChunkTaskInput,
  SelectionTaskInput,
  SummaryTaskInput,
  VerifyTaskInput,
  Writer
} from './types'

interface ChatPayload {
  choices?: {
    delta?: { content?: unknown }
    message?: { content?: unknown }
    text?: string
  }[]
  error?: { message?: string }
}

function contentFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as ChatPayload
  const choice = record.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const item = part as { text?: unknown }
          return typeof item.text === 'string' ? item.text : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

function httpErrorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return '模型服务鉴权失败。请检查 API Key 与接口地址。'
  }
  if (status === 404) {
    return '接口地址不存在（404）。检查接口地址是否以 /v1 结尾。'
  }
  if (status === 429) return '请求过于频繁（429）。稍后再试。'
  if (status >= 500) return `模型服务暂时不可用（${status}）。稍后再试。`
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string }
    if (typeof parsed.error === 'string') detail = parsed.error
    else if (parsed.error && typeof parsed.error.message === 'string') {
      detail = parsed.error.message
    }
  } catch {
    detail = body.replace(/\s+/g, ' ').slice(0, 100)
  }
  return detail
    ? `模型服务返回错误（${status}）：${detail.slice(0, 140)}`
    : `模型服务返回错误（${status}）。`
}

function isLocalAddress(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(baseUrl)
}

export class RemoteWriter implements Writer {
  readonly mode = 'openai' as const

  constructor(private readonly settings: AppSettings) {}

  private assertConfigured(): void {
    if (!this.settings.baseUrl.trim()) {
      throw new ConfigError('尚未填写接口地址。去设置里配置模型服务。')
    }
    if (!this.settings.model.trim()) {
      throw new ConfigError('尚未填写模型名称。去设置里配置模型服务。')
    }
    if (!this.settings.apiKey.trim() && !isLocalAddress(this.settings.baseUrl)) {
      throw new ConfigError('尚未填写 API Key。去设置里配置模型服务。')
    }
  }

  private endpoint(): string {
    const base = this.settings.baseUrl.trim().replace(/\/+$/, '')
    if (base.endsWith('/chat/completions')) return base
    return `${base}/chat/completions`
  }

  private async chat(
    system: string,
    user: string,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
    temperature = this.settings.temperature
  ): Promise<string> {
    this.assertConfigured()
    const timeout = AbortSignal.timeout(300_000)
    const combined = AbortSignal.any([signal, timeout])
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`
    }

    const body = JSON.stringify({
      model: this.settings.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      stream: true,
      temperature
    })

    let responseOk = false
    let jsonMode = false
    let received = ''
    let buffer = ''
    let accumulated = ''

    const processLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') return
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        return
      }
      const record = payload as ChatPayload
      if (record.error?.message) {
        throw new AppError('provider_error', `模型服务返回错误：${record.error.message}`)
      }
      const delta = contentFromPayload(payload)
      if (delta) {
        accumulated += delta
        onDelta?.(delta)
      }
    }

    const consume = (text: string): void => {
      if (!text || jsonMode) return
      received += text
      buffer += text
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        processLine(line.endsWith('\r') ? line.slice(0, -1) : line)
        newlineIndex = buffer.indexOf('\n')
      }
    }

    let outcome: StreamOutcome
    try {
      outcome = await getTransport().postStream(
        {
          url: this.endpoint(),
          headers,
          body,
          signal: combined,
          timeoutMs: 300_000
        },
        {
          onMeta: (meta) => {
            responseOk = meta.ok
            jsonMode = meta.contentType.includes('application/json')
          },
          onChunk: consume
        }
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (timeout.aborted) throw new AppError('timeout', '请求超时。检查网络后重试。')
      if (error instanceof TransportError) {
        if (error.kind === 'timeout') {
          throw new AppError('timeout', '请求超时。检查网络后重试。')
        }
        if (error.kind === 'abort') throw new DOMException('Aborted', 'AbortError')
        if (error.kind === 'network') {
          logError('llm.fetch', error)
          throw new AppError('network', '连接模型服务失败。检查网络与接口地址后重试。')
        }
      }
      logError('llm.stream', error)
      throw new AppError('stream', '生成中断。已写出的部分已保留。')
    }

    responseOk = outcome.ok
    jsonMode = outcome.contentType.includes('application/json')

    if (!responseOk) {
      logError('llm.http', `${outcome.status} ${outcome.body.slice(0, 500)}`)
      throw new AppError(
        `http_${outcome.status}`,
        httpErrorMessage(outcome.status, outcome.body)
      )
    }

    if (jsonMode) {
      let payload: unknown = null
      try {
        payload = JSON.parse(outcome.body)
      } catch {
        payload = null
      }
      if (payload && typeof payload === 'object') {
        const record = payload as ChatPayload
        if (record.error?.message) {
          throw new AppError('provider_error', `模型服务返回错误：${record.error.message}`)
        }
      }
      const content = contentFromPayload(payload)
      if (content) onDelta?.(content)
      return content
    }

    // Native transports deliver chunks as bridge events, and the final event
    // can be dispatched after the call resolves. `outcome.body` is the
    // authoritative stream, so fold in anything the events did not cover.
    if (outcome.body.startsWith(received)) {
      consume(outcome.body.slice(received.length))
    } else if (!accumulated && outcome.body) {
      buffer = ''
      consume(outcome.body)
    }
    if (buffer.trim()) processLine(buffer)

    if (!outcome.body && !accumulated) {
      throw new AppError('bad_response', '模型返回了空响应。重试？')
    }

    return accumulated
  }

  private async json<T>(
    system: string,
    user: string,
    signal: AbortSignal,
    temperature = 0.4
  ): Promise<T> {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const suffix =
        attempt === 0
          ? ''
          : '\n\n注意：上一次输出不是有效 JSON。这次只输出 JSON，不要任何解释或代码块。'
      const raw = await this.chat(system, user + suffix, signal, undefined, attempt === 0 ? temperature : 0.2)
      try {
        return parseJsonLoose<T>(raw)
      } catch (error) {
        lastError = error
      }
    }
    logError('llm.json', lastError)
    throw new AppError('bad_json', '模型没有返回有效 JSON。重试？')
  }

  private async text(
    system: string,
    user: string,
    signal: AbortSignal,
    temperature = this.settings.temperature
  ): Promise<string> {
    const result = await this.chat(system, user, signal, undefined, temperature)
    if (!result.trim()) throw new EmptyResponseError()
    return result
  }

  async streamChapter(
    input: ChapterWriteInput,
    onDelta: (text: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    return this.chat(input.prompt.system, input.prompt.user, signal, onDelta)
  }

  async writeSkeleton(draft: SetupDraft, signal: AbortSignal): Promise<StorySkeleton> {
    const prompt = skeletonPrompt(draft)
    const raw = await this.json<unknown>(prompt.system, prompt.user, signal, 0.6)
    return normalizeSkeleton(raw, draft.themePrompt.slice(0, 12), draft.genre)
  }

  async writeOutline(input: OutlineTaskInput, signal: AbortSignal): Promise<ChapterOutline> {
    const prompt = outlinePrompt({
      title: input.project.title,
      genre: input.project.genre,
      tone: input.project.tone,
      pov: input.project.pov,
      idx: input.idx,
      characters: input.characters.map((character) => ({
        name: character.name,
        profile: character.profile
      })),
      recentSummaries: input.recentSummaries,
      previousHook: input.recentSummaries[input.recentSummaries.length - 1] ?? '',
      directives: input.directives,
      planned: input.planned
    })
    const raw = await this.json<unknown>(prompt.system, prompt.user, signal, 0.5)
    return normalizeOutline(raw, input.planned?.title ?? `第${input.idx}章`)
  }

  async summarize(input: SummaryTaskInput, signal: AbortSignal): Promise<ChapterSummary> {
    const user = [
      SUMMARY_PROMPT.user,
      '',
      `章节：第 ${input.chapterIdx} 章《${input.chapterTitle}》`,
      '正文：',
      input.content
    ].join('\n')
    const raw = await this.json<unknown>(SUMMARY_PROMPT.system, user, signal, 0.3)
    return normalizeSummary(raw)
  }

  async beats(input: BeatsTaskInput, signal: AbortSignal): Promise<string[]> {
    const prompt = beatsPrompt({
      title: input.project.title,
      idx: input.idx,
      recent: input.recent,
      lastContent: input.lastContent,
      characters: input.characterNames
    })
    const raw = await this.json<unknown>(prompt.system, prompt.user, signal, 0.8)
    return normalizeBeats(raw)
  }

  async selectTargets(
    input: SelectionTaskInput,
    signal: AbortSignal
  ): Promise<{ targets: RewriteTarget[]; globalNote: string }> {
    const prompt = selectionPrompt(input)
    const raw = await this.json<unknown>(prompt.system, prompt.user, signal, 0.3)
    return normalizeTargets(raw, input.chunks, input.chapterIdx, input.maxTargets)
  }

  async verifyTargets(input: VerifyTaskInput, signal: AbortSignal): Promise<string[]> {
    if (input.candidates.length === 0) return []
    const prompt = verifyPrompt({
      instruction: input.instruction,
      chapterIdx: input.chapterIdx,
      chunks: input.chunks,
      candidates: input.candidates.map((candidate) => ({
        id: displayChunkId(input.chapterIdx, candidate.idx),
        action: candidate.action,
        reason: candidate.reason,
        hint: candidate.hint
      }))
    })
    try {
      const raw = await this.json<Record<string, unknown>>(
        prompt.system,
        prompt.user,
        signal,
        0.2
      )
      if (!Array.isArray(raw.confirmed)) {
        return input.candidates.map((candidate) => candidate.chunkId)
      }
      return normalizeConfirmed(raw, input.chunks, input.chapterIdx)
    } catch (error) {
      if (error instanceof AppError && error.code === 'cancelled') throw error
      return input.candidates.map((candidate) => candidate.chunkId)
    }
  }

  async rewriteChunk(input: RewriteChunkTaskInput, signal: AbortSignal): Promise<string> {
    const prompt = chunkRewritePrompt({
      instruction: input.instruction,
      hint: input.hint,
      roleTag: input.roleTag,
      before: input.before,
      after: input.after,
      original: input.original,
      extra: `本章：${input.chapterTitle}`
    })
    const raw = await this.text(prompt.system, prompt.user, signal, 0.75)
    return cleanRewriteOutput(raw)
  }

  async rewriteManual(input: ManualRewriteTaskInput, signal: AbortSignal): Promise<string> {
    const prompt = manualRewritePrompt({
      mode: input.mode,
      instruction: input.instruction,
      selected: input.selected,
      before: input.before,
      after: input.after
    })
    const raw = await this.text(prompt.system, prompt.user, signal, 0.75)
    return cleanRewriteOutput(raw)
  }

  async check(input: CheckTaskInput, signal: AbortSignal): Promise<ConsistencyIssue[]> {
    const prompt = consistencyPrompt(input)
    try {
      const raw = await this.json<unknown>(prompt.system, prompt.user, signal, 0.2)
      return normalizeIssues(raw)
    } catch (error) {
      if (signal.aborted) throw error
      return []
    }
  }

  async test(signal: AbortSignal): Promise<TestModelResult> {
    const started = Date.now()
    try {
      const text = await this.chat(TEST_PROMPT.system, TEST_PROMPT.user, signal, undefined, 0.1)
      return {
        ok: true,
        detail: text.trim() ? `连接正常，返回「${text.trim().slice(0, 20)}」。` : '连接正常。',
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : '连接失败。',
        latencyMs: Date.now() - started
      }
    }
  }
}
