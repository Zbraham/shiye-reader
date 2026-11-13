import { reflowParagraphs } from './chapters'
import {
  cleanInline,
  decodeEntities,
  extractBodyHtml,
  removeUnsafeElements,
  sanitizeHtml,
  stripTags,
  type SanitizeOptions
} from './sanitize'
import { IMPORT_LIMITS, type ParsedChapter } from './types'

export interface Block {
  heading: boolean
  text: string
}

export interface SplitHtmlOptions extends SanitizeOptions {
  fallbackTitle: string
  /** Volume carried over from a previous document. */
  volume?: string
}

export interface HtmlSplitResult {
  chapters: ParsedChapter[]
  volume?: string
}

interface HeadingInfo {
  start: number
  end: number
  level: number
  title: string
}

const VOLUME_PATTERN =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[卷部篇]|卷\s*[0-9零〇一二三四五六七八九十百千万两]+|(?:volume|part|book)\b)/iu

/**
 * Converts one XHTML document into heading-tagged paragraph blocks.
 * Kept as a public helper: EPUB text extraction uses it for chapter `content`
 * while the rich sanitiser independently builds chapter `html`.
 */
export function xhtmlToBlocks(html: string): Block[] {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(html)
  let body = bodyMatch?.[1] ?? html
  body = body
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/giu, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, '')

  body = body.replace(
    /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/giu,
    (_match, _level: string, inner: string) => `\u0001\u0003${cleanInline(inner)}\u0004\u0001`
  )
  body = body.replace(/<br\s*\/?>/giu, '\u0001')
  body = body.replace(/<hr\s*\/?>/giu, '\u0001')
  body = body.replace(
    /<\/?(?:p|div|section|article|li|ul|ol|blockquote|tr|td|th|table|h[1-6]|figure|figcaption|pre|header|footer)\b[^>]*>/giu,
    '\u0001'
  )
  body = stripTags(body)
  body = decodeEntities(body)
  body = body.replace(/ /gu, ' ').replace(/[ \t\r\n]+/gu, ' ')
  body = body.replace(/\s*\u0001\s*/gu, '\u0001')

  const blocks: Block[] = []
  let cursor = 0
  while (cursor < body.length) {
    const open = body.indexOf('\u0003', cursor)
    if (open < 0) {
      pushText(body.slice(cursor))
      break
    }
    pushText(body.slice(cursor, open))
    const close = body.indexOf('\u0004', open + 1)
    if (close < 0) break
    const title = body.slice(open + 1, close).trim()
    if (title) blocks.push({ heading: true, text: title })
    cursor = close + 1
  }
  return blocks

  function pushText(segment: string): void {
    for (const piece of segment.split('\u0001')) {
      const text = piece.replace(/\s+/gu, ' ').trim()
      if (text) blocks.push({ heading: false, text })
    }
  }
}

function findHeadings(body: string): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/giu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const parsed = Number.parseInt(match[1] ?? '1', 10)
    const level = Number.isFinite(parsed) ? Math.min(6, Math.max(1, parsed)) : 1
    headings.push({
      start: match.index,
      end: match.index + (match[0]?.length ?? 0),
      level,
      title: cleanInline(match[2] ?? '')
    })
  }
  return headings
}

/** Text extraction shared with the legacy EPUB path. */
function textOf(html: string): string {
  const paragraphs = xhtmlToBlocks(html)
    .filter((block) => !block.heading)
    .map((block) => block.text)
  return reflowParagraphs(paragraphs.join('\n\n'))
}

function levelOf(headingLevel: number): number {
  if (headingLevel <= 2) return 1
  if (headingLevel === 3) return 2
  return 3
}

function hasTextContent(html: string): boolean {
  return cleanInline(html).length > 0
}

/**
 * Rich HTML that would exceed the IPC schema is dropped rather than failing the
 * whole import: the chapter still reads fine as plain text.
 */
function richOf(html: string, options: SanitizeOptions): string {
  const rich = sanitizeHtml(html, options)
  return rich.length > IMPORT_LIMITS.chapterHtmlChars ? '' : rich
}

/**
 * Splits an XHTML document at h1-h6 boundaries. High-level headings with no
 * body immediately before a deeper heading are treated as volume labels.
 */
export function splitHtmlDocument(html: string, options: SplitHtmlOptions): HtmlSplitResult {
  const body = removeUnsafeElements(extractBodyHtml(html))
  const headings = findHeadings(body)
  const chapters: ParsedChapter[] = []
  let volume = options.volume

  if (headings.length === 0) {
    const content = textOf(body)
    if (!content) return { chapters, ...(volume ? { volume } : {}) }
    const rich = richOf(body, options)
    return {
      chapters: [
        {
          title: options.fallbackTitle,
          content,
          level: 1,
          ...(rich ? { html: rich } : {})
        }
      ],
      ...(volume ? { volume } : {})
    }
  }

  const first = headings[0]
  if (first) {
    const prefaceHtml = body.slice(0, first.start)
    const preface = textOf(prefaceHtml)
    if (preface) {
      const rich = richOf(prefaceHtml, options)
      chapters.push({
        title: options.fallbackTitle,
        content: preface,
        level: 1,
        ...(rich ? { html: rich } : {}),
        ...(volume ? { volume } : {})
      })
    }
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]
    if (!heading) continue
    const next = headings[index + 1]
    const segmentEnd = next?.start ?? body.length
    const afterHtml = body.slice(heading.end, segmentEnd)

    const isVolume =
      !hasTextContent(afterHtml) &&
      heading.title.length > 0 &&
      (VOLUME_PATTERN.test(heading.title) ||
        (next !== undefined && heading.level === 1))
    if (isVolume) {
      volume = heading.title.slice(0, 80)
      continue
    }

    const content = textOf(afterHtml)
    if (!content) continue
    // The heading is shown by the reader chrome already. Including it in the
    // rich body would print the chapter title twice.
    const rich = richOf(afterHtml, options)
    chapters.push({
      title: heading.title || options.fallbackTitle,
      content,
      level: levelOf(heading.level),
      ...(rich ? { html: rich } : {}),
      ...(volume ? { volume } : {})
    })
  }

  return { chapters, ...(volume ? { volume } : {}) }
}

export function splitHtmlChapters(html: string, options: SplitHtmlOptions): ParsedChapter[] {
  return splitHtmlDocument(html, options).chapters
}
