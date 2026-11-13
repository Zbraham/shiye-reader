/**
 * Text primitives shared by the main process, the renderer and tests.
 * Pure functions only — no Node or DOM APIs.
 */

const CJK_PATTERN = /[㐀-䶿一-鿿豈-﫿]/g
const LATIN_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g
const DIGIT_PATTERN = /\d+(?:[.,]\d+)*/g

/** Unified word-count rule: one CJK character = 1, one Latin word = 1, one digit run = 1. */
export function countWords(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK_PATTERN)?.length ?? 0
  const latin = text.match(LATIN_WORD_PATTERN)?.length ?? 0
  const digits = text.match(DIGIT_PATTERN)?.length ?? 0
  return cjk + latin + digits
}

/**
 * Approximate token usage. Chinese characters are close to one token each in
 * most OpenAI-compatible tokenisers; Latin text is roughly four characters
 * per token. Estimates intentionally err on the high side.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let latin = 0
  let other = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk += 1
    } else if (/\s/.test(char)) {
      other += 0.2
    } else if (code < 0x80) {
      latin += 1
    } else {
      other += 0.8
    }
  }
  return Math.ceil(cjk + latin / 3.6 + other)
}

/** Truncate text so that its estimated token count stays within `max`. */
export function truncateByTokens(
  text: string,
  max: number,
  keep: 'head' | 'tail' = 'head'
): string {
  if (max <= 0) return ''
  if (estimateTokens(text) <= max) return text
  let result = ''
  let used = 0
  const chars = Array.from(text)
  if (keep === 'head') {
    for (const char of chars) {
      const cost = estimateTokens(char)
      if (used + cost > max) break
      used += cost
      result += char
    }
  } else {
    const reversed = chars.slice().reverse()
    for (const char of reversed) {
      const cost = estimateTokens(char)
      if (used + cost > max) break
      used += cost
      result = char + result
    }
  }
  return result
}

/** FNV-1a, 32 bit. Stable across processes and runs. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export interface ProseParagraph {
  text: string
  start: number
  end: number
  separator: boolean
}

const SEPARATOR_PATTERN = /^[*＊—–\-_=·\s]{2,}$/u

/** Splits reader content on blank lines while keeping exact source offsets. */
export function splitContent(content: string): ProseParagraph[] {
  const paragraphs: ProseParagraph[] = []
  if (!content) return paragraphs
  const push = (rawStart: number, rawEnd: number): void => {
    const raw = content.slice(rawStart, rawEnd)
    const left = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (!text) return
    const start = rawStart + left
    paragraphs.push({
      text,
      start,
      end: start + text.length,
      separator: text.length <= 12 && SEPARATOR_PATTERN.test(text)
    })
  }
  const pattern = /\n{2,}/g
  let cursor = 0
  let match = pattern.exec(content)
  while (match) {
    push(cursor, match.index)
    cursor = pattern.lastIndex
    match = pattern.exec(content)
  }
  push(cursor, content.length)
  return paragraphs
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export interface NewFact {
  key: string
  value: string
}

export interface StrippedText {
  text: string
  facts: NewFact[]
}

const NEW_FACT_PATTERN = /<!--\s*NEW_FACT\s*:\s*([\s\S]*?)-->/g

/**
 * Removes model-only markers from prose. New facts are returned separately so
 * they can be merged into story state.
 */
export function stripModelMarkers(raw: string): StrippedText {
  const facts: NewFact[] = []
  const withoutFacts = raw.replace(NEW_FACT_PATTERN, (_match, body: string) => {
    const parsed = tryParseJson(body)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const key = typeof record.key === 'string' ? record.key.trim() : ''
      const value = typeof record.value === 'string' ? record.value.trim() : ''
      if (key && value) facts.push({ key, value })
    }
    return ''
  })
  const withoutComments = withoutFacts.replace(/<!--[\s\S]*?-->/g, '')
  return { text: stripMetaTrailer(withoutComments), facts }
}

const TRAILERS = [
  /（本章完）\s*$/u,
  /\(本章完\)\s*$/u,
  /——\s*本章完\s*——\s*$/u,
  /（未完待续）\s*$/u,
  /\[本章完\]\s*$/u,
  /【本章完】\s*$/u
]

export function stripMetaTrailer(raw: string): string {
  let text = raw.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const pattern of TRAILERS) {
      const next = text.replace(pattern, '').trimEnd()
      if (next !== text) {
        text = next
        changed = true
      }
    }
  }
  return text
}

/**
 * Normalises generated prose: removes a leading chapter heading, drops
 * markdown fences, and makes every non-empty line a paragraph separated by a
 * blank line so the chunker and reader agree on structure.
 */
export function normalizeProse(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n').replace(/﻿/g, '').trim()
  text = text.replace(/^```[a-zA-Z]*\s*\n/, '').replace(/\n```\s*$/, '')
  let lines = text.split('\n').map((line) => line.trimEnd())

  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0)
  if (firstNonEmpty >= 0) {
    const first = lines[firstNonEmpty]?.trim() ?? ''
    const heading = /^第\s*[0-9一二三四五六七八九十百零两]+\s*章(?:[\s：:、.·—-].*)?$/u
    const markdownHeading = /^#{1,3}\s+/
    if (
      (heading.test(first) && first.length <= 40) ||
      markdownHeading.test(first)
    ) {
      lines = lines.filter((_line, index) => index !== firstNonEmpty)
    }
  }

  const paragraphs = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return paragraphs.join('\n\n').trim()
}

/** Removes code fences and pulls out the first JSON object or array. */
export function extractJson<T = unknown>(raw: string): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const direct = tryParseJson(cleaned)
  if (direct !== undefined) return direct as T

  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    const sliced = cleaned.slice(objectStart, objectEnd + 1)
    const parsed = tryParseJson(sliced)
    if (parsed !== undefined) return parsed as T
  }

  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const parsed = tryParseJson(cleaned.slice(arrayStart, arrayEnd + 1))
    if (parsed !== undefined) return parsed as T
  }

  throw new Error('模型返回的内容不是有效 JSON')
}

export function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    const repaired = raw
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[“”]/g, '"')
    if (repaired !== raw) {
      try {
        return JSON.parse(repaired)
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

export function excerpt(text: string, length: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= length) return clean
  return `${clean.slice(0, length)}…`
}

export function stripSelectionWhitespace(text: string): string {
  return text.replace(/​/g, '').trim()
}
