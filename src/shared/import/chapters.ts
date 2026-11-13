import { countWords, stripMetaTrailer } from '../text'
import { IMPORT_LIMITS, ImportError, type ParsedChapter } from './types'

export interface SplitOptions {
  fallbackTitle: string
  format: 'txt' | 'md'
}

export interface SplitResult {
  title: string | null
  chapters: ParsedChapter[]
  warnings: string[]
}

interface Breakpoint {
  line: number
  title: string
  volume: boolean
}

const CHAPTER_HEADING =
  /^第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节回集部篇](?:\s*[：:、.·—\-]\s*|\s+|$)(.*)$/u
const VOLUME_HEADING =
  /^第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*卷(?:\s*[：:、.·—\-]\s*|\s+|$)(.*)$/u
const SPECIAL_HEADING =
  /^(序章|序言|楔子|引子|前言|尾声|后记|终章|番外(?:篇)?)(?:\s*[：:、.·—\-]\s*|\s+|$)(.*)$/u
const ENGLISH_HEADING = /^(?:chapter|chapter\s+no\.?)\s*[0-9ivxlcdm]+\b.*$/iu
const MARKDOWN_HEADING = /^(#{1,6})\s+(.*)$/u
const ADS = [
  /^本章未完[，,]?\s*请(?:点击|访问|翻页|继续)/u,
  /^请记住(?:本站|本书|域名)/u,
  /^(?:最新|手机版)?(?:网址|域名)[：:]/u,
  /^手机(?:版)?(?:阅读|用户)?(?:请)?(?:访问|浏览)/u,
  /^一秒记住/u,
  /^笔趣阁/u,
  /^最新章节[！!]?$/u,
  /^加入书签/u,
  /^投推荐票/u,
  /^求(?:收藏|推荐|月票)/u,
  /^(?:www\.|https?:\/\/)\S+$/iu,
  /^(\S+\.(?:com|net|org|cn|cc|la|info|me))\s*$/iu,
  /^（本章完）$/u,
  /^\(本章完\)$/u
]
const TERMINAL = /[。！？!?…”“”"』」）)\]】—…]$/u

function normalizeNewlines(raw: string): string {
  return raw
    .replace(/^﻿/u, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[​-‍⁠﻿]/g, '')
}

function cleanLine(line: string): string {
  return line.replace(/^[\s　]+/u, '').replace(/[\s　]+$/u, '')
}

function isAdLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.length <= 90) {
    for (const pattern of ADS) {
      if (pattern.test(trimmed)) return true
    }
  }
  return false
}

function isHeadingLine(line: string, includeVolume: boolean): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 80) return false
  if (CHAPTER_HEADING.test(trimmed) || SPECIAL_HEADING.test(trimmed)) return true
  if (ENGLISH_HEADING.test(trimmed)) return true
  if (includeVolume && VOLUME_HEADING.test(trimmed)) return true
  return false
}

function headingText(line: string): string {
  return cleanLine(line).replace(/^#+\s*/u, '').trim()
}

/** Shared by non-text formats (DOCX) that need the same chapter detection. */
export function isChapterHeadingLine(line: string, includeVolume = true): boolean {
  return isHeadingLine(line, includeVolume)
}

export function cleanHeadingText(line: string): string {
  return headingText(line)
}

/** Joins hard-wrapped lines, adding a space only when both sides are Latin. */
function joinWrapped(left: string, right: string): string {
  if (!left) return right
  const last = left[left.length - 1] ?? ''
  const first = right[0] ?? ''
  if (/[A-Za-z0-9,;:'")\]]/.test(last) && /[A-Za-z0-9(["]/.test(first)) {
    return `${left} ${right}`
  }
  return `${left}${right}`
}

function mergeSoftWraps(lines: string[]): string[] {
  const paragraphs: string[] = []
  for (const raw of lines) {
    const line = cleanLine(raw)
    if (!line) continue
    const previous = paragraphs[paragraphs.length - 1]
    if (
      previous !== undefined &&
      previous.length < 60 &&
      !TERMINAL.test(previous) &&
      !/^[“"「『（(]/u.test(line)
    ) {
      paragraphs[paragraphs.length - 1] = joinWrapped(previous, line)
    } else {
      paragraphs.push(line)
    }
  }
  return paragraphs
}

/**
 * Reflows a chapter body into `\n\n` paragraphs. Handles blank-line-separated
 * text, one-line-per-paragraph Chinese TXT, and hard-wrapped lines.
 */
export function reflowParagraphs(raw: string): string {
  const text = normalizeNewlines(raw)
  if (!text.trim()) return ''
  const blocks = text.split(/\n{2,}/u)
  let paragraphs: string[]
  if (blocks.length > 1) {
    paragraphs = blocks
      .map((block) => {
        const lines = block.split('\n').filter((line) => cleanLine(line).length > 0)
        let merged = ''
        for (const line of lines) {
          merged = joinWrapped(merged, cleanLine(line))
        }
        return merged.trim()
      })
      .filter((block) => block.length > 0)
  } else {
    paragraphs = mergeSoftWraps(text.split('\n'))
  }
  paragraphs = paragraphs
    .map((paragraph) => stripMetaTrailer(paragraph.trim()))
    .filter((paragraph) => paragraph.length > 0 && !isAdLine(paragraph))
  return paragraphs.join('\n\n').trim()
}

/** Removes Markdown heading markers from body lines; only the marker goes. */
function stripMarkdownHeadingMarkers(raw: string): string {
  return raw.replace(/^[\t 　]*#{1,6}[\t 　]+/gmu, '')
}

function bodyLines(lines: string[]): string {
  const kept: string[] = []
  for (const line of lines) {
    if (isAdLine(line)) continue
    kept.push(line)
  }
  return reflowParagraphs(kept.join('\n'))
}

function fallbackTitle(index: number, fallback: string): string {
  if (index === 1) return fallback || '第 1 章'
  return `第 ${index} 章`
}

/** Splits at paragraph boundaries so one chapter never exceeds the hard cap. */
export function splitOversized(chapter: ParsedChapter): ParsedChapter[] {
  if (chapter.content.length <= IMPORT_LIMITS.chapterChars) return [chapter]
  const paragraphs = chapter.content.split(/\n{2,}/u)
  const pieces: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > IMPORT_LIMITS.chapterChars) {
      if (current) {
        pieces.push(current)
        current = ''
      }
      for (let offset = 0; offset < paragraph.length; offset += IMPORT_LIMITS.chapterChars) {
        pieces.push(paragraph.slice(offset, offset + IMPORT_LIMITS.chapterChars))
      }
      continue
    }
    if (current.length + paragraph.length + 2 > IMPORT_LIMITS.chapterChars) {
      if (current) pieces.push(current)
      current = paragraph
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
  }
  if (current) pieces.push(current)
  if (pieces.length <= 1) return [chapter]
  const suffixes =
    pieces.length === 2
      ? ['（上）', '（下）']
      : pieces.length === 3
        ? ['（上）', '（中）', '（下）']
        : pieces.map((_piece, index) => `（${index + 1}）`)
  return pieces.map((content, index) => ({
    title: `${chapter.title}${suffixes[index] ?? ''}`,
    content,
    // Rich HTML cannot be split at an arbitrary character offset; drop it for
    // the split pieces rather than duplicating the whole chapter fragment.
    ...(chapter.volume ? { volume: chapter.volume } : {}),
    ...(chapter.level ? { level: chapter.level } : {})
  }))
}

function byLength(text: string, fallback: string, warnings: string[]): ParsedChapter[] {
  const paragraphs = reflowParagraphs(text).split(/\n{2,}/u).filter(Boolean)
  if (paragraphs.length === 0) return []
  const chapters: ParsedChapter[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > IMPORT_LIMITS.fallbackChapterChars) {
      chapters.push({ title: fallbackTitle(chapters.length + 1, fallback), content: current })
      current = paragraph
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
  }
  if (current) {
    chapters.push({ title: fallbackTitle(chapters.length + 1, fallback), content: current })
  }
  warnings.push('没有找到章节标题，已按段落长度自动分章。')
  return chapters
}

function buildPlainChapters(
  lines: string[],
  breakpoints: Breakpoint[],
  fallback: string,
  warnings: string[]
): ParsedChapter[] {
  const first = breakpoints[0]
  if (!first) return byLength(lines.join('\n'), fallback, warnings)

  const preface = bodyLines(lines.slice(0, first.line))
  const chapters: ParsedChapter[] = []
  // A short preface is merged into the first chapter instead of becoming its own.
  const mergePreface = preface.length > 0 && preface.length <= 100
  if (preface.length > 100) chapters.push({ title: '前言', content: preface })

  let volume: string | undefined
  let prefaceMerged = !mergePreface
  for (let index = 0; index < breakpoints.length; index += 1) {
    const point = breakpoints[index]
    if (!point) continue
    if (point.volume) {
      // Volume headings are boundaries, not chapters; their label belongs to
      // every following chapter until the next volume starts.
      volume = point.title
      continue
    }
    const next = breakpoints[index + 1]
    let content = bodyLines(lines.slice(point.line + 1, next?.line ?? lines.length))
    if (!prefaceMerged && content) {
      content = reflowParagraphs(`${preface}\n\n${content}`)
      prefaceMerged = true
    }
    if (content) {
      chapters.push({
        title: point.title,
        content,
        ...(volume ? { volume } : {})
      })
    }
  }
  return chapters
}

function fallbackBookTitle(fallback: string): string {
  return fallback.trim() || '未命名'
}

export function splitPlainText(raw: string, options: SplitOptions): SplitResult {
  const warnings: string[] = []
  const normalized = normalizeNewlines(raw)
  if (!normalized.trim()) throw new ImportError('文件里没有可阅读的正文。')

  if (options.format === 'md') {
    const markdown = splitMarkdown(normalized, options.fallbackTitle)
    if (markdown.chapters.length > 1 || markdown.title) return markdown
    warnings.push(...markdown.warnings)
  }

  const lines = normalized.split('\n')
  let candidates: Breakpoint[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (isHeadingLine(line, false)) {
      candidates.push({ line: index, title: headingText(line), volume: false })
    } else if (isHeadingLine(line, true)) {
      candidates.push({ line: index, title: headingText(line), volume: true })
    }
  }
  const real = candidates.filter((candidate) => !candidate.volume)
  // With two or more real chapters, volume headings stay in `candidates` as
  // boundaries so their labels attach to following chapters rather than leaking
  // into the preceding chapter body.
  if (real.length === 0 && candidates.length >= 2) {
    warnings.push('只找到卷标题，已按卷分章。')
    candidates = candidates.map((candidate) => ({ ...candidate, volume: false }))
  } else if (real.length === 1) {
    candidates = real
    const only = real[0]
    if (only && only.line === 0) {
      // A single heading at the top is likely the book title.
      const title = only.title
      const rest = bodyLines(lines.slice(1))
      if (rest) {
        return {
          title,
          chapters: splitOversized({
            title: title || fallbackBookTitle(options.fallbackTitle),
            content: rest
          }),
          warnings
        }
      }
    }
    warnings.push('只找到 1 个章节标题，可能未正确分章。')
  } else if (real.length === 0) {
    candidates = []
  }

  if (candidates.length === 0) {
    return {
      title: null,
      chapters: byLength(normalized, options.fallbackTitle, warnings),
      warnings
    }
  }

  let chapters = buildPlainChapters(lines, candidates, options.fallbackTitle, warnings)
  if (chapters.length === 0) {
    chapters = byLength(normalized, options.fallbackTitle, warnings)
  }
  chapters = chapters.flatMap((chapter) => splitOversized(chapter))
  return { title: null, chapters, warnings }
}

function splitMarkdown(raw: string, fallbackTitle: string): SplitResult {
  const warnings: string[] = []
  const lines = normalizeNewlines(raw).split('\n')
  const headings: { line: number; level: number; title: string }[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = MARKDOWN_HEADING.exec((lines[index] ?? '').trim())
    if (!match) continue
    const level = (match[1] ?? '').length
    const title = (match[2] ?? '').trim()
    if (title) headings.push({ line: index, level, title })
  }
  if (headings.length === 0) {
    return { title: null, chapters: [], warnings }
  }

  let title: string | null = null
  let firstChapterHeading = 0
  const h1s = headings.filter((heading) => heading.level === 1)
  const firstHeading = headings[0]
  if (firstHeading && firstHeading.level === 1 && firstHeading.line <= 3) {
    title = firstHeading.title
    firstChapterHeading = 1
  } else if (h1s.length === 0 && firstHeading && firstHeading.line <= 3) {
    title = firstHeading.title
    firstChapterHeading = 1
  }

  const chapterHeadings = headings
    .slice(firstChapterHeading)
    .filter((heading) => heading.level <= 2)
  if (chapterHeadings.length === 0) {
    // A short story with only a title and body has no chapter headings at all.
    // Fall back to length-based splitting instead of rejecting the file.
    if (!title) return { title, chapters: [], warnings }
    const bodyStart = (firstHeading?.line ?? -1) + 1
    const body = stripMarkdownHeadingMarkers(lines.slice(bodyStart).join('\n'))
    return {
      title,
      chapters: byLength(body, fallbackTitle, warnings).flatMap((chapter) =>
        splitOversized(chapter)
      ),
      warnings
    }
  }
  if (chapterHeadings.length === 1) {
    warnings.push('只找到 1 个 Markdown 标题，可能未正确分章。')
  }

  // Anything between the book title and the first chapter heading is preface.
  const prefaceStart = title && firstHeading ? firstHeading.line + 1 : 0
  const firstChapter = chapterHeadings[0]
  const preface = reflowParagraphs(
    stripMarkdownHeadingMarkers(
      lines.slice(prefaceStart, firstChapter?.line ?? lines.length).join('\n')
    )
  )
  const mergePreface = preface.length > 0 && preface.length <= 100

  const chapters: ParsedChapter[] = []
  if (preface.length > 100) chapters.push({ title: '前言', content: preface })
  let prefaceMerged = !mergePreface
  for (let index = 0; index < chapterHeadings.length; index += 1) {
    const heading = chapterHeadings[index]
    if (!heading) continue
    const next = chapterHeadings[index + 1]
    let content = reflowParagraphs(
      stripMarkdownHeadingMarkers(
        lines.slice(heading.line + 1, next?.line ?? lines.length).join('\n')
      )
    )
    if (!prefaceMerged && content) {
      content = reflowParagraphs(`${preface}\n\n${content}`)
      prefaceMerged = true
    }
    if (content) chapters.push({ title: heading.title, content })
  }
  if (chapters.length === 0) {
    return { title, chapters: [], warnings }
  }
  title = title ?? fallbackBookTitle(fallbackTitle)
  return {
    title,
    chapters: chapters.flatMap((chapter) => splitOversized(chapter)),
    warnings
  }
}

/** Validates parsed chapters against import limits, then normalises titles. */
export function finalizeChapters(chapters: ParsedChapter[]): ParsedChapter[] {
  const cleaned = chapters
    .map((chapter) => ({
      // The IPC schema caps titles at 120 characters; long Markdown/EPUB
      // headings must be trimmed here rather than rejected after parsing.
      title: (chapter.title.trim() || '未命名章节').slice(0, 120),
      content: chapter.content.trim(),
      ...(chapter.html ? { html: chapter.html } : {}),
      ...(chapter.volume ? { volume: chapter.volume.slice(0, 80) } : {}),
      ...(chapter.level ? { level: chapter.level } : {})
    }))
    .filter((chapter) => chapter.content.length > 0)
    .flatMap((chapter) => splitOversized(chapter))
  if (cleaned.length === 0) throw new ImportError('文件里没有可阅读的正文。')
  if (cleaned.length > IMPORT_LIMITS.chapters) {
    throw new ImportError(
      `这本书有 ${cleaned.length} 章，超过 ${IMPORT_LIMITS.chapters} 章上限。请先在外部合并或拆分。`
    )
  }
  const total = cleaned.reduce((sum, chapter) => sum + chapter.content.length, 0)
  if (total > IMPORT_LIMITS.totalChars) {
    throw new ImportError(
      `正文约 ${Math.round(total / 10000)} 万字，超过 ${IMPORT_LIMITS.totalChars / 10000} 万字上限。请拆分后再导入。`
    )
  }
  return cleaned
}

export function totalWords(chapters: ParsedChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0)
}
