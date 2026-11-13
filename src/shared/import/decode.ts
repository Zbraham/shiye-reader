import { ImportError } from './types'

export interface DecodedText {
  text: string
  encoding: string
}

const SAMPLE_SIZE = 8192
const TEXT_SAMPLE = 4096

interface TextQuality {
  score: number
  /** Share of sample characters that look like real prose. */
  plausible: number
  /** Count of control/private-use/replacement characters. */
  bad: number
  /** Count of letters, digits and CJK ideographs. */
  words: number
  /** Count of whitespace characters (spaces, tabs, line breaks). */
  spaces: number
  length: number
}

interface Utf16Candidate {
  text: string
  encoding: string
  quality: TextQuality
  hinted: boolean
}

const CJK_PATTERN = /[㐀-䶿一-鿿豈-﫿]/u
const CJK_PUNCT_PATTERN = /[　-〿＀-￯]/u
const WORD_PATTERN = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ]/u
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu

function countZeroBytes(bytes: Uint8Array): number {
  let zero = 0
  const sample = Math.min(bytes.length, SAMPLE_SIZE)
  for (let index = 0; index < sample; index += 1) {
    if (bytes[index] === 0) zero += 1
  }
  return zero
}

/** Reads a byte range one-to-one as Latin-1 so charset declarations stay ASCII-safe. */
export function readAsciiHead(bytes: Uint8Array, limit = TEXT_SAMPLE): string {
  const sample = Math.min(bytes.length, limit)
  let head = ''
  for (let index = 0; index < sample; index += 1) {
    head += String.fromCharCode(bytes[index] ?? 0)
  }
  return head
}

/**
 * Scores decoded text so the UTF-16 endianness that yields real prose wins.
 * Garbled CJK/UTF-8 byte pairs usually decode to private-use or exotic blocks.
 */
function scoreText(text: string): TextQuality {
  let score = 0
  let plausible = 0
  let bad = 0
  let words = 0
  let spaces = 0
  let length = 0

  for (let index = 0; index < text.length && length < TEXT_SAMPLE; index += 1) {
    const code = text.codePointAt(index) ?? 0
    if (code > 0xffff) index += 1
    length += 1

    if (code === 0xfeff) {
      plausible += 1
      continue
    }
    if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20) {
      score += 0.5
      plausible += 1
      spaces += 1
      continue
    }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      score -= 5
      bad += 1
      continue
    }
    if (code === 0xfffd || code === 0xfffe || code === 0xffff) {
      score -= 6
      bad += 1
      continue
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      score -= 8
      bad += 1
      continue
    }
    if (code >= 0xe000 && code <= 0xf8ff) {
      score -= 4
      bad += 1
      continue
    }

    const char = String.fromCodePoint(code)
    if (CJK_PATTERN.test(char)) {
      score += 3
      plausible += 1
      words += 1
      continue
    }
    if (CJK_PUNCT_PATTERN.test(char)) {
      score += 2
      plausible += 1
      continue
    }
    if (WORD_PATTERN.test(char)) {
      score += 1
      plausible += 1
      words += 1
      continue
    }
    score += 0.05
  }

  return {
    score,
    plausible: length === 0 ? 0 : plausible / length,
    bad,
    words,
    spaces,
    length
  }
}

/**
 * Inspects byte structure for endianness hints: ASCII-heavy UTF-16 has zero
 * high bytes on one parity, CJK UTF-16 clusters its high byte in 0x4E-0x9F.
 */
function utf16EndianHint(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = Math.min(bytes.length, SAMPLE_SIZE)
  const pairs = Math.floor(sample / 2)
  if (pairs < 8) return null

  let evenZeros = 0
  let oddZeros = 0
  let evenHigh = 0
  let oddHigh = 0

  for (let index = 0; index < pairs * 2; index += 2) {
    const even = bytes[index] ?? 0
    const odd = bytes[index + 1] ?? 0
    if (even === 0) evenZeros += 1
    if (odd === 0) oddZeros += 1
    if (even >= 0x4e && even <= 0x9f) evenHigh += 1
    if (odd >= 0x4e && odd <= 0x9f) oddHigh += 1
  }

  if (oddZeros >= 8 && oddZeros >= evenZeros * 3 && oddZeros >= pairs * 0.5) {
    return 'utf-16le'
  }
  if (evenZeros >= 8 && evenZeros >= oddZeros * 3 && evenZeros >= pairs * 0.5) {
    return 'utf-16be'
  }
  if (oddHigh >= 8 && oddHigh >= evenHigh * 2 && oddHigh >= pairs * 0.5) {
    return 'utf-16le'
  }
  if (evenHigh >= 8 && evenHigh >= oddHigh * 2 && evenHigh >= pairs * 0.5) {
    return 'utf-16be'
  }
  return null
}

function tryUtf16(bytes: Uint8Array, encoding: 'utf-16le' | 'utf-16be'): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function guessUtf16(bytes: Uint8Array): Utf16Candidate | null {
  const hint = utf16EndianHint(bytes)
  const candidates: Utf16Candidate[] = []

  for (const encoding of ['utf-16le', 'utf-16be'] as const) {
    const text = tryUtf16(bytes, encoding)
    if (text === null) continue
    candidates.push({
      text,
      encoding: encoding === 'utf-16le' ? 'UTF-16 LE' : 'UTF-16 BE',
      quality: scoreText(text),
      hinted: hint === encoding
    })
  }

  if (candidates.length === 0) return null
  const hinted = candidates.find((candidate) => candidate.hinted)
  if (hinted) return hinted

  let best = candidates[0]
  if (!best) return null
  for (const candidate of candidates) {
    if (candidate.quality.score > best.quality.score) best = candidate
  }
  return best
}

function isNaturalText(quality: TextQuality): boolean {
  return (
    quality.bad === 0 &&
    quality.plausible >= 0.4 &&
    quality.words >= Math.max(1, quality.length * 0.15) &&
    (quality.spaces > 0 || quality.plausible >= 0.75)
  )
}

function decodeWith(
  bytes: Uint8Array,
  encoding: string,
  fatal = false
): string {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes)
  } catch {
    throw new ImportError(
      `当前系统不支持 ${encoding} 解码，请先把文件另存为 UTF-8 再导入。`
    )
  }
}

function decodeFallback(bytes: Uint8Array): DecodedText {
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'UTF-8'
    }
  } catch {
    return { text: decodeWith(bytes, 'gb18030'), encoding: 'GB18030 / GBK' }
  }
}

function hasBom(bytes: Uint8Array): boolean {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return true
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return true
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return true
  return false
}

const UTF16_LABELS = new Set([
  'unicode',
  'ucs-2',
  'utf-16',
  'utf-16le',
  'utf-16be',
  'utf16',
  'utf16le',
  'utf16be'
])

const UTF8_LABELS = new Set(['utf-8', 'utf8', 'unicode-1-1-utf-8'])

/**
 * Decodes with a charset declared by the document (HTML meta / XML declaration).
 * UTF-8 and UTF-16 labels are left to the byte heuristic, which handles BOMs and
 * BOM-less files. Returns null when the label is unsupported or decoding fails.
 */
export function decodeDeclaredText(
  bytes: Uint8Array,
  label: string
): DecodedText | null {
  if (bytes.length === 0 || hasBom(bytes)) return null

  const normalized = label.trim().toLowerCase().replace(/^["']|["']$/gu, '')
  if (!normalized || UTF8_LABELS.has(normalized) || UTF16_LABELS.has(normalized)) {
    return null
  }

  try {
    const decoder = new TextDecoder(normalized, { fatal: true })
    return { text: decoder.decode(bytes), encoding: decoder.encoding.toUpperCase() }
  } catch {
    return null
  }
}

/** Decodes a downloaded novel while refusing obvious binaries. */
export function decodeNovelBytes(bytes: Uint8Array): DecodedText {
  if (bytes.length === 0) throw new ImportError('这个文件是空的。')

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return { text: decodeWith(bytes.subarray(3), 'utf-8'), encoding: 'UTF-8 BOM' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeWith(bytes.subarray(2), 'utf-16le'), encoding: 'UTF-16 LE' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeWith(bytes.subarray(2), 'utf-16be'), encoding: 'UTF-16 BE' }
  }

  const fallback = decodeFallback(bytes)
  const fallbackQuality = scoreText(fallback.text)
  const utf16 = guessUtf16(bytes)

  // Valid UTF-8 that reads as natural prose is never reinterpreted as UTF-16.
  const trustUtf8 = fallback.encoding === 'UTF-8' && isNaturalText(fallbackQuality)
  if (utf16 && !trustUtf8) {
    const quality = utf16.quality
    // Real UTF-16 prose has no control characters; binary data does.
    const clean = quality.bad <= Math.max(1, Math.floor(quality.length * 0.02))
    const enoughText = quality.plausible >= (utf16.hinted ? 0.5 : 0.65)
    const better = utf16.hinted
      ? quality.score >= fallbackQuality.score
      : quality.score > fallbackQuality.score + Math.max(2, quality.length * 0.5)
    if (clean && enoughText && better) {
      return { text: utf16.text, encoding: utf16.encoding }
    }
  }

  if (countZeroBytes(bytes) > 8) {
    throw new ImportError('这个文件看起来不是纯文本，请选择 TXT、Markdown 或 EPUB。')
  }

  const control = fallback.text.slice(0, TEXT_SAMPLE).match(CONTROL_PATTERN)
  if (control && control.length > 40) {
    throw new ImportError('这个文件看起来不是纯文本，请选择 TXT、Markdown 或 EPUB。')
  }
  return fallback
}
