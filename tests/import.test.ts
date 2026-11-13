import { describe, expect, it } from 'vitest'
import { decodeNovelBytes } from '@shared/import/decode'
import { parseHtml } from '@shared/import/html'
import { parseFb2 } from '@shared/import/fb2'
import { extractRtfText } from '@shared/import/rtf'

function asciiBytes(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0))
}

function concatBytes(...parts: Array<string | number[]>): Uint8Array {
  const bytes: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') bytes.push(...asciiBytes(part))
    else bytes.push(...part)
  }
  return new Uint8Array(bytes)
}

function utf16Bytes(text: string, littleEndian: boolean): Uint8Array {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (littleEndian) bytes.push(code & 0xff, (code >> 8) & 0xff)
    else bytes.push((code >> 8) & 0xff, code & 0xff)
  }
  return new Uint8Array(bytes)
}

describe('decodeNovelBytes UTF-16 detection', () => {
  it('detects BOM-less UTF-16LE Chinese', () => {
    const text = '第1章 你好世界'
    const decoded = decodeNovelBytes(utf16Bytes(text, true))
    expect(decoded.text).toBe(text)
    expect(decoded.encoding).toBe('UTF-16 LE')
  })

  it('detects BOM-less UTF-16BE Chinese', () => {
    const text = '第1章 你好世界'
    const decoded = decodeNovelBytes(utf16Bytes(text, false))
    expect(decoded.text).toBe(text)
    expect(decoded.encoding).toBe('UTF-16 BE')
  })

  it('detects BOM-less UTF-16LE text without zero bytes', () => {
    const text = '你好世界'
    const decoded = decodeNovelBytes(utf16Bytes(text, true))
    expect(decoded.text).toBe(text)
    expect(decoded.encoding).toBe('UTF-16 LE')
  })

  it('detects short BOM-less UTF-16LE Chinese text', () => {
    const text = '你好'
    const decoded = decodeNovelBytes(utf16Bytes(text, true))
    expect(decoded.text).toBe(text)
  })

  it('detects a short BOM-less UTF-16BE Chinese phrase', () => {
    const text = '中文测试'
    const decoded = decodeNovelBytes(utf16Bytes(text, false))
    expect(decoded.text).toBe(text)
    expect(decoded.encoding).toBe('UTF-16 BE')
  })

  it('decodes plain UTF-8 unchanged', () => {
    const text = '第一章 你好世界'
    const decoded = decodeNovelBytes(new TextEncoder().encode(text))
    expect(decoded.text).toBe(text)
    expect(decoded.encoding).toBe('UTF-8')
  })

  it('decodes plain GB18030 unchanged', () => {
    const bytes = new Uint8Array([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xc4, 0xe3, 0xba, 0xc3
    ])
    const decoded = decodeNovelBytes(bytes)
    expect(decoded.text).toBe('第一章 你好')
    expect(decoded.encoding).toBe('GB18030 / GBK')
  })

  it('honours the UTF-8 BOM', () => {
    const body = Array.from(new TextEncoder().encode('第一章 你好世界'))
    const bytes = concatBytes([0xef, 0xbb, 0xbf], body)
    const decoded = decodeNovelBytes(bytes)
    expect(decoded.text).toBe('第一章 你好世界')
    expect(decoded.encoding).toBe('UTF-8 BOM')
  })

  it('does not reinterpret plain ASCII as UTF-16', () => {
    const text = 'Hello world, this is ordinary plain ASCII text.'
    const decoded = decodeNovelBytes(new TextEncoder().encode(text))
    expect(decoded.text).toBe(text)
    expect(decoded.encoding).toBe('UTF-8')
  })
})

const SHIFT_JIS_TEST = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67] // テスト
const BIG5_CHINESE = [0xa4, 0xa4, 0xa4, 0xe5] // 中文
const WIN1251_TEST = [0xd2, 0xe5, 0xf1, 0xf2] // Тест

describe('html declared encodings', () => {
  it('decodes Shift_JIS declared with <meta charset>', () => {
    const bytes = concatBytes(
      '<html><head><meta charset="Shift_JIS"><title>',
      SHIFT_JIS_TEST,
      '</title></head><body><h1>',
      SHIFT_JIS_TEST,
      '</h1><p>',
      SHIFT_JIS_TEST,
      '</p></body></html>'
    )
    const book = parseHtml(bytes)
    expect(book.title).toBe('テスト')
    expect(book.chapters[0]?.title).toBe('テスト')
    expect(book.chapters[0]?.content).toContain('テスト')
  })

  it('decodes Big5 declared with http-equiv content-type', () => {
    const bytes = concatBytes(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=big5">',
      '<title>',
      BIG5_CHINESE,
      '</title></head><body><h1>',
      BIG5_CHINESE,
      '</h1><p>',
      BIG5_CHINESE,
      BIG5_CHINESE,
      '</p></body></html>'
    )
    const book = parseHtml(bytes)
    expect(book.title).toBe('中文')
    expect(book.chapters[0]?.title).toBe('中文')
    expect(book.chapters[0]?.content).toContain('中文中文')
  })
})

describe('fb2 declared encodings', () => {
  it('decodes windows-1251 from the XML declaration', () => {
    const bytes = concatBytes(
      '<?xml version="1.0" encoding="windows-1251"?>',
      '<FictionBook><description><title-info><book-title>',
      WIN1251_TEST,
      '</book-title><lang>ru</lang></title-info></description>',
      '<body><section><title>',
      WIN1251_TEST,
      '</title><p>',
      WIN1251_TEST,
      '</p></section></body></FictionBook>'
    )
    const book = parseFb2(bytes)
    expect(book.title).toBe('Тест')
    expect(book.language).toBe('ru')
    expect(book.chapters[0]?.title).toBe('Тест')
    expect(book.chapters[0]?.content).toContain('Тест')
  })
})

describe('extractRtfText unicode fallbacks', () => {
  it('skips one fallback character by default', () => {
    expect(extractRtfText('{\\rtf1\\u20320?}')).toBe('你')
  })

  it('skips nothing with \\uc0', () => {
    expect(extractRtfText('{\\rtf1\\uc0\\u20320?}')).toBe('你?')
  })

  it('skips two fallback units with \\uc2', () => {
    expect(extractRtfText('{\\rtf1\\uc2\\u20320??}')).toBe('你')
  })

  it('treats an escaped hex byte as one fallback unit', () => {
    expect(extractRtfText("{\\rtf1\\uc1\\u20320\\'c4}")).toBe('你')
    expect(extractRtfText("{\\rtf1\\uc2\\u20320\\'c4\\'e3}")).toBe('你')
  })

  it('treats escaped symbols as one fallback unit', () => {
    expect(extractRtfText('{\\rtf1\\uc1\\u20320\\\\}')).toBe('你')
    expect(extractRtfText('{\\rtf1\\uc1\\u20320\\~}')).toBe('你')
  })
})
