import type { ApiResult, AppSettings, Chapter, ChapterMeta } from '@shared/types'

export async function unwrap<T>(result: Promise<ApiResult<T>>): Promise<T> {
  const value = await result
  if (!value.ok) throw new Error(value.error.message)
  return value.data
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作没有完成，请再试一次。'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatWords(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万字`
  return `${value.toLocaleString('zh-CN')} 字`
}

export function formatCount(value: number): string {
  return value.toLocaleString('zh-CN')
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return sameYear
    ? `${month}-${day} ${hours}:${minutes}`
    : `${date.getFullYear()}-${month}-${day}`
}

export function stripChapterPrefix(title: string, idx: number): string {
  const cleaned = title.replace(/^第\s*[0-9一二三四五六七八九十百零两]+\s*章[\s：:、.·—-]*/u, '').trim()
  return cleaned || `第 ${idx} 章`
}

export type { ProseParagraph } from '@shared/text'
export { splitContent } from '@shared/text'

export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement
  root.dataset['theme'] = settings.theme
  root.dataset['vertical'] = settings.vertical ? 'true' : 'false'
  root.style.colorScheme =
    settings.theme === 'night' || settings.theme === 'black' ? 'dark' : 'light'
  root.style.setProperty('--reader-size', `${settings.fontSize}px`)
  root.style.setProperty('--reader-font', `var(--font-${settings.readerFont})`)
  root.style.setProperty('--reader-indent', settings.indent ? '2em' : '0')
  root.style.setProperty('--reader-leading', `${settings.lineHeight}`)
  root.style.setProperty('--reader-tracking', `${settings.letterSpacing}em`)
  root.style.setProperty('--reader-paragraph-gap', `${settings.paragraphGap}em`)
  root.style.setProperty('--reader-measure', `${settings.pageWidth}px`)
  root.style.setProperty('--reader-align', settings.justify ? 'justify' : 'start')
  root.style.setProperty('--app-brightness', `${settings.brightness}`)
}

export function chapterFromMeta(meta: ChapterMeta, content: string): Chapter {
  return {
    id: meta.id,
    projectId: meta.projectId,
    idx: meta.idx,
    title: meta.title,
    status: meta.status,
    content,
    html: '',
    volume: meta.volume,
    level: meta.level,
    wordCount: meta.wordCount,
    summaryL1: '',
    summaryL2: meta.summaryL2,
    outline: null,
    version: meta.version,
    generatedAt: null,
    staleReason: meta.staleReason,
    error: meta.error,
    issues: [],
    updatedAt: meta.updatedAt,
    lastOffsetRatio: meta.lastOffsetRatio
  }
}

export function mergeChapterMeta(chapter: Chapter, meta: ChapterMeta): Chapter {
  return {
    ...chapter,
    title: meta.title,
    status: meta.status,
    wordCount: meta.wordCount,
    summaryL2: meta.summaryL2,
    version: meta.version,
    staleReason: meta.staleReason,
    error: meta.error,
    updatedAt: meta.updatedAt,
    volume: meta.volume,
    level: meta.level,
    lastOffsetRatio: meta.lastOffsetRatio
  }
}
