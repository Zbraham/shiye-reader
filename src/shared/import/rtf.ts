import { finalizeChapters, splitPlainText } from './chapters'
import { decodeNovelBytes } from './decode'
import { ImportError, type ParsedChapter } from './types'

export interface RtfBook {
  chapters: ParsedChapter[]
  warnings: string[]
  encoding: string
}

const DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'annotation',
  'field',
  'fldinst',
  'listtext',
  'pntext',
  'pntxta',
  'pntxtb',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'xmlnstbl',
  'generator',
  'filetbl',
  'revtbl',
  'rsidtbl',
  'listtable',
  'listoverridetable',
  'mmathpr'
])

const SYMBOLS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' '
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]{2}$/u.test(value)
}

/** Conservative RTF → plain text extraction. Never throws on malformed input. */
export function extractRtfText(source: string): string {
  const skipStack: boolean[] = [false]
  const ucStack: number[] = [1]
  const pendingBytes: number[] = []
  let output = ''

  const skipping = (): boolean => skipStack[skipStack.length - 1] === true
  const currentUc = (): number => ucStack[ucStack.length - 1] ?? 1

  const flushBytes = (): void => {
    if (pendingBytes.length === 0) return
    const bytes = new Uint8Array(pendingBytes)
    pendingBytes.length = 0
    if (skipping()) return
    try {
      const decoded = decodeNovelBytes(bytes)
      output += decoded.text
    } catch {
      output += Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    }
  }

  const append = (text: string): void => {
    if (!skipping()) output += text
  }

  const lineBreak = (): void => {
    flushBytes()
    append('\n')
  }

  /**
   * Skips the fallback characters that follow \uN. An escaped byte or symbol
   * (\'hh, \\, \{, \}, \~) is one fallback unit, not one source character.
   */
  const skipFallback = (count: number): void => {
    let remaining = Math.max(0, count)
    while (remaining > 0 && index < source.length) {
      const char = source[index] ?? ''
      if (char === '\\') {
        const escaped = source[index + 1] ?? ''
        if (escaped === "'") {
          const hex = source.slice(index + 2, index + 4)
          index += isHex(hex) ? 4 : 2
        } else if (
          escaped === '\\' ||
          escaped === '{' ||
          escaped === '}' ||
          escaped === '~'
        ) {
          index += 2
        } else {
          // A control word is not a fallback character; let the parser see it.
          break
        }
        remaining -= 1
        continue
      }
      if (char === '{' || char === '}') break
      index += 1
      remaining -= 1
    }
  }

  let index = 0
  while (index < source.length) {
    const char = source[index] ?? ''

    if (char === '{') {
      flushBytes()
      skipStack.push(skipping())
      ucStack.push(currentUc())
      index += 1
      continue
    }
    if (char === '}') {
      flushBytes()
      if (skipStack.length > 1) skipStack.pop()
      if (ucStack.length > 1) ucStack.pop()
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      index += 1
      continue
    }
    if (char !== '\\') {
      flushBytes()
      append(char)
      index += 1
      continue
    }

    const next = source[index + 1] ?? ''
    if (next === "'") {
      const hex = source.slice(index + 2, index + 4)
      if (isHex(hex)) {
        pendingBytes.push(Number.parseInt(hex, 16))
        index += 4
      } else {
        index += 2
      }
      continue
    }
    if (next === '\\' || next === '{' || next === '}') {
      flushBytes()
      append(next)
      index += 2
      continue
    }
    if (next === '~') {
      flushBytes()
      append(' ')
      index += 2
      continue
    }
    if (next === '-' || next === '_') {
      flushBytes()
      index += 2
      continue
    }
    if (next === '*') {
      flushBytes()
      skipStack[skipStack.length - 1] = true
      index += 2
      continue
    }
    if (next === '\r' || next === '\n') {
      index += 2
      continue
    }
    if (!/[a-zA-Z]/u.test(next)) {
      flushBytes()
      index += 2
      continue
    }

    flushBytes()
    let cursor = index + 1
    while (cursor < source.length && /[a-zA-Z]/u.test(source[cursor] ?? '')) {
      cursor += 1
    }
    const word = source.slice(index + 1, cursor).toLowerCase()
    let parameter: number | null = null
    let sign = 1
    let hasDigits = false
    if (source[cursor] === '-') {
      sign = -1
      cursor += 1
    }
    let digits = ''
    while (cursor < source.length && /[0-9]/u.test(source[cursor] ?? '')) {
      digits += source[cursor] ?? ''
      cursor += 1
      hasDigits = true
    }
    if (hasDigits) parameter = sign * Number.parseInt(digits, 10)
    if (source[cursor] === ' ') cursor += 1
    index = cursor

    if (DESTINATIONS.has(word)) {
      skipStack[skipStack.length - 1] = true
      continue
    }
    if (word === 'par' || word === 'line' || word === 'page' || word === 'sect') {
      lineBreak()
      if (word === 'page' || word === 'sect') append('\n')
      continue
    }
    if (word === 'tab' || word === 'cell') {
      append(' ')
      continue
    }
    if (word === 'row') {
      lineBreak()
      continue
    }
    if (word === 'uc') {
      if (parameter !== null && parameter >= 0) {
        ucStack[ucStack.length - 1] = parameter
      }
      continue
    }
    const symbol = SYMBOLS[word]
    if (symbol !== undefined) {
      append(symbol)
      continue
    }
    if (word === 'u' && parameter !== null) {
      const code = parameter < 0 ? parameter + 65536 : parameter
      if (code > 0 && code <= 0x10ffff) append(String.fromCodePoint(code))
      // RTF emits \ucN fallback characters after \uN; skip exactly that many.
      skipFallback(currentUc())
    }
  }

  flushBytes()

  return output
    .replace(/\r/gu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function parseRtf(bytes: Uint8Array): RtfBook {
  const decoded = decodeNovelBytes(bytes)
  const text = extractRtfText(decoded.text)
  if (!text) throw new ImportError('RTF 文件里的可读文字太少，无法导入。')

  const replacements = text.match(/�/gu)?.length ?? 0
  if (replacements > Math.max(8, text.length / 20)) {
    throw new ImportError('RTF 的字符编码无法识别，请先另存为 TXT 或 UTF-8 再导入。')
  }
  const readable = text.match(/[A-Za-z㐀-鿿]/gu)?.length ?? 0
  if (readable < 2) {
    throw new ImportError('RTF 文件里的可读文字太少，无法导入。')
  }

  const split = splitPlainText(text, { fallbackTitle: '正文', format: 'txt' })
  return {
    chapters: finalizeChapters(split.chapters),
    warnings: split.warnings,
    encoding: `RTF（${decoded.encoding}）`
  }
}
