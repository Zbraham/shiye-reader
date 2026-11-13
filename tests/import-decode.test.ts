import { describe, expect, it } from 'vitest'
import { decodeNovelBytes } from '@shared/import/decode'

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('decodeNovelBytes', () => {
  it('strips a UTF-8 BOM', () => {
    const body = bytesOf('雨落在瓦上。')
    const bytes = new Uint8Array(body.length + 3)
    bytes.set([0xef, 0xbb, 0xbf])
    bytes.set(body, 3)
    const decoded = decodeNovelBytes(bytes)
    expect(decoded.text).toBe('雨落在瓦上。')
    expect(decoded.encoding).toBe('UTF-8 BOM')
  })

  it('decodes UTF-16LE with a BOM', () => {
    const text = '第一章 雨夜'
    const body = new Uint8Array(text.length * 2)
    const view = new DataView(body.buffer)
    for (let index = 0; index < text.length; index += 1) {
      view.setUint16(index * 2, text.charCodeAt(index), true)
    }
    const bytes = new Uint8Array(body.length + 2)
    bytes.set([0xff, 0xfe])
    bytes.set(body, 2)
    const decoded = decodeNovelBytes(bytes)
    expect(decoded.text).toContain('第一章 雨夜')
    expect(decoded.encoding).toBe('UTF-16 LE')
  })

  it('falls back to GB18030 for a GBK file', () => {
    // "中文" in GBK.
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const decoded = decodeNovelBytes(bytes)
    expect(decoded.text).toBe('中文')
    expect(decoded.encoding).toContain('GB')
  })

  it('rejects an empty file', () => {
    expect(() => decodeNovelBytes(new Uint8Array())).toThrow('空')
  })

  it('rejects binary data with NUL bytes', () => {
    const bytes = new Uint8Array(64)
    bytes.fill(0x41)
    // A contiguous NUL block, as found in binary headers. Unlike scattered
    // zeros it does not resemble UTF-16 code units.
    for (let index = 0; index < 16; index += 1) bytes[index] = 0
    expect(() => decodeNovelBytes(bytes)).toThrow('不是纯文本')
  })
})
