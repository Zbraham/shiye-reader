import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildExportFile,
  buildExportText,
  exportExtension,
  sanitizeFileName,
  type ExportBook
} from '@shared/export'
import { crc32 } from '@shared/export/zip'

interface ParsedEntry {
  name: string
  method: number
  flags: number
  crc: number
  compressedSize: number
  size: number
  data: Uint8Array
}

interface ParsedZip {
  entries: ParsedEntry[]
  names: string[]
  byName: Map<string, ParsedEntry>
}

const decoder = new TextDecoder()

/** Reads our own ZIP output through the central directory and inflates data. */
function parseZip(bytes: Uint8Array): ParsedZip {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const minimum = Math.max(0, bytes.length - 22 - 0xffff)
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0)
  if (eocd < 0) throw new Error('missing end of central directory')

  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  const entries: ParsedEntry[] = []

  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50)
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const nameStart = cursor + 46
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    const data =
      method === 8 ? new Uint8Array(inflateRawSync(compressed)) : compressed.slice()
    expect(data.length).toBe(size)

    entries.push({ name, method, flags, crc, compressedSize, size, data })
    cursor = nameStart + nameLength + extraLength + commentLength
  }

  const byName = new Map<string, ParsedEntry>()
  for (const entry of entries) byName.set(entry.name, entry)
  return { entries, names: entries.map((entry) => entry.name), byName }
}

function textOf(zip: ParsedZip, name: string): string {
  return decoder.decode(zip.byName.get(name)?.data ?? new Uint8Array())
}

/** Resolves a relative href against a directory inside the archive. */
function resolveReference(baseDir: string, href: string): string {
  const stack: string[] = []
  for (const part of `${baseDir}/${href}`.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function stylesheetHref(xhtml: string): string {
  return /<link\b[^>]*\bhref="([^"]+)"/iu.exec(xhtml)?.[1] ?? ''
}

const BOOK: ExportBook = {
  title: '雨夜来信',
  author: '林深',
  language: 'zh-CN',
  publisher: '拾页出版社',
  series: '雨夜系列',
  description: '一部关于雨夜的长篇。',
  tags: ['悬疑', '都市'],
  genre: '悬疑',
  tone: '克制',
  pov: '第三人称',
  synopsis: '雨落在瓦上，她数着回声。',
  coverData: 'data:image/jpeg;base64,/9j/4AAAAA==',
  chapters: [
    {
      idx: 1,
      title: '第1章 雨',
      content: '雨落在瓦上 & 很轻。\n\n她数着雨声。'
    },
    {
      idx: 2,
      title: '第2章 北站',
      content: '广播里念出了她的名字。'
    }
  ]
}

describe('plain text export', () => {
  it('builds a TXT file with title, synopsis and chapter headings', () => {
    const text = buildExportText(BOOK, 'txt')
    expect(text.startsWith('《雨夜来信》\n')).toBe(true)
    expect(text).toContain('雨落在瓦上，她数着回声。')
    expect(text).toContain('第 1 章　雨')
    expect(text).toContain('第 2 章　北站')
    expect(text).toContain('雨落在瓦上 & 很轻。')
    expect(text).not.toContain('\r')
  })

  it('builds Markdown with metadata, synopsis and paragraphs', () => {
    const text = buildExportText(BOOK, 'md')
    expect(text.startsWith('# 雨夜来信\n')).toBe(true)
    expect(text).toContain('> 作者：林深')
    expect(text).toContain('类型：悬疑')
    expect(text).toContain('标签：悬疑、都市')
    expect(text).toContain('雨落在瓦上，她数着回声。')
    expect(text).toContain('## 第 1 章 雨')
    expect(text).not.toContain('\r')
  })

  it('normalizes CRLF input to LF output', () => {
    const book: ExportBook = {
      ...BOOK,
      chapters: [{ idx: 1, title: '第1章 雨', content: '第一行\r\n\r\n第二行' }]
    }
    for (const format of ['txt', 'md'] as const) {
      expect(buildExportText(book, format)).not.toContain('\r')
    }
    expect(buildExportText(book, 'txt')).toContain('第一行\n\n第二行')
  })

  it('encodes TXT as UTF-8 bytes with a matching file name and MIME type', async () => {
    const file = await buildExportFile(BOOK, 'txt')
    expect(file.fileName).toBe('雨夜来信.txt')
    expect(file.mime).toContain('text/plain')
    expect(decoder.decode(file.bytes)).toBe(buildExportText(BOOK, 'txt'))
  })
})

describe('export helpers', () => {
  it('sanitises file names and maps extensions', () => {
    const safe = sanitizeFileName('雨夜/来信:上')
    expect(safe).not.toMatch(/[\\/:*?"<>|]/u)
    expect(safe).toContain('雨夜')
    expect(safe).toContain('来信')
    expect(sanitizeFileName('')).toBe('未命名')
    expect(sanitizeFileName('a'.repeat(100)).length).toBeLessThanOrEqual(80)
    expect(sanitizeFileName('书名.')).toBe('书名')
    expect(exportExtension('txt')).toBe('txt')
    expect(exportExtension('md')).toBe('md')
    expect(exportExtension('epub')).toBe('epub')
    expect(exportExtension('docx')).toBe('docx')
    expect(exportExtension('pdf')).toBe('pdf')
  })

  it('avoids Windows reserved device names', async () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('con')).toBe('_con')
    expect(sanitizeFileName('nul.txt')).toBe('_nul.txt')
    expect(sanitizeFileName('COM1')).toBe('_COM1')
    expect(sanitizeFileName('LPT9.md')).toBe('_LPT9.md')
    expect(sanitizeFileName('COM10')).toBe('COM10')
    expect(sanitizeFileName('PRN.')).toBe('_PRN')

    const file = await buildExportFile({ ...BOOK, title: 'CON' }, 'txt')
    expect(file.fileName).toBe('_CON.txt')
  })

  it('rejects PDF because the desktop process handles it', async () => {
    await expect(buildExportFile(BOOK, 'pdf')).rejects.toThrow('PDF 由桌面端生成')
  })

  it('computes the standard CRC32 test vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('EPUB export', () => {
  it('writes a valid ZIP with stored mimetype and one XHTML per chapter', async () => {
    const file = await buildExportFile(BOOK, 'epub')
    expect(file.fileName).toBe('雨夜来信.epub')
    expect(file.mime).toBe('application/epub+zip')

    const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength)
    expect(Array.from(file.bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    const firstNameLength = view.getUint16(26, true)
    expect(decoder.decode(file.bytes.subarray(30, 30 + firstNameLength))).toBe('mimetype')
    expect(view.getUint16(8, true)).toBe(0)

    const zip = parseZip(file.bytes)
    expect(zip.names[0]).toBe('mimetype')
    expect(textOf(zip, 'mimetype')).toBe('application/epub+zip')
    for (const entry of zip.entries) expect(entry.flags & 0x0800).toBe(0x0800)
    expect(zip.names).toContain('META-INF/container.xml')
    expect(zip.names).toContain('OEBPS/content.opf')
    expect(zip.names).toContain('OEBPS/nav.xhtml')
    expect(zip.names).toContain('OEBPS/style.css')
    expect(zip.names).toContain('OEBPS/text/chapter-1.xhtml')
    expect(zip.names).toContain('OEBPS/text/chapter-2.xhtml')

    const opf = textOf(zip, 'OEBPS/content.opf')
    expect(opf).toContain('version="3.0"')
    expect(opf).toContain('properties="nav"')
    expect(opf).toContain('properties="cover-image"')
    expect(opf).toContain('urn:uuid:')

    const nav = textOf(zip, 'OEBPS/nav.xhtml')
    expect(nav).toContain('epub:type="toc"')
    expect(nav).toContain('text/chapter-1.xhtml')
    expect(nav).toContain('text/chapter-2.xhtml')

    // nav.xhtml sits in OEBPS/, while chapters sit in OEBPS/text/.
    const navStylesheet = stylesheetHref(nav)
    expect(navStylesheet).toBe('style.css')
    expect(zip.byName.has(resolveReference('OEBPS', navStylesheet))).toBe(true)
    expect(zip.byName.has(resolveReference('OEBPS', 'text/chapter-1.xhtml'))).toBe(true)

    const chapter = textOf(zip, 'OEBPS/text/chapter-1.xhtml')
    expect(chapter).toContain('第 1 章 雨')
    expect(chapter).toContain('<p>雨落在瓦上 &amp; 很轻。</p>')
    expect(chapter).toContain('<p>她数着雨声。</p>')
    expect(chapter).not.toContain('雨落在瓦上 & 很轻。')

    const chapterStylesheet = stylesheetHref(chapter)
    expect(chapterStylesheet).toBe('../style.css')
    expect(zip.byName.has(resolveReference('OEBPS/text', chapterStylesheet))).toBe(true)

    expect(zip.names).toContain('OEBPS/images/cover.jpeg')
    expect(Array.from(zip.byName.get('OEBPS/images/cover.jpeg')?.data.slice(0, 2) ?? []))
      .toEqual([0xff, 0xd8])
  })

  it('supports PNG, GIF and WebP covers and ignores unsupported formats', async () => {
    const png = await buildExportFile(
      { ...BOOK, coverData: 'data:image/png;base64,iVBORw0KGgo=' },
      'epub'
    )
    const pngZip = parseZip(png.bytes)
    expect(pngZip.names).toContain('OEBPS/images/cover.png')
    expect(textOf(pngZip, 'OEBPS/content.opf')).toContain('media-type="image/png"')

    const gif = await buildExportFile(
      { ...BOOK, coverData: 'data:image/gif;base64,R0lGODlh' },
      'epub'
    )
    const gifZip = parseZip(gif.bytes)
    expect(gifZip.names).toContain('OEBPS/images/cover.gif')
    expect(textOf(gifZip, 'OEBPS/content.opf')).toContain('media-type="image/gif"')

    const webp = await buildExportFile(
      { ...BOOK, coverData: 'data:image/webp;base64,UklGRg==' },
      'epub'
    )
    const webpZip = parseZip(webp.bytes)
    expect(webpZip.names).toContain('OEBPS/images/cover.webp')
    expect(textOf(webpZip, 'OEBPS/content.opf')).toContain('media-type="image/webp"')

    const unsupported = await buildExportFile(
      { ...BOOK, coverData: 'data:image/bmp;base64,Qk0=' },
      'epub'
    )
    const unsupportedZip = parseZip(unsupported.bytes)
    expect(unsupportedZip.names.some((name) => name.startsWith('OEBPS/images/'))).toBe(false)
    expect(textOf(unsupportedZip, 'OEBPS/content.opf')).not.toContain('cover-image')
  })

  it('includes SVG covers in EPUB but not in DOCX', async () => {
    const book: ExportBook = {
      ...BOOK,
      coverData: 'data:image/svg+xml;base64,PHN2Zy8+'
    }

    const epub = await buildExportFile(book, 'epub')
    const epubZip = parseZip(epub.bytes)
    expect(epubZip.names).toContain('OEBPS/images/cover.svg')
    expect(textOf(epubZip, 'OEBPS/content.opf')).toContain('media-type="image/svg+xml"')

    const docx = await buildExportFile(book, 'docx')
    const docxZip = parseZip(docx.bytes)
    expect(docxZip.names).not.toContain('word/media/cover.svg')
    expect(textOf(docxZip, 'word/document.xml')).not.toContain('r:embed="rIdCover"')
    expect(textOf(docxZip, '[Content_Types].xml')).not.toContain('image/svg+xml')
  })
})

describe('DOCX export', () => {
  it('writes minimal OOXML with title, author, headings and body text', async () => {
    const file = await buildExportFile(BOOK, 'docx')
    expect(file.fileName).toBe('雨夜来信.docx')
    expect(file.mime).toContain('wordprocessingml.document')

    const zip = parseZip(file.bytes)
    expect(zip.names).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'word/styles.xml',
        'word/_rels/document.xml.rels',
        'word/media/cover.jpeg'
      ])
    )

    const document = textOf(zip, 'word/document.xml')
    expect(document).toContain('雨夜来信')
    expect(document).toContain('林深')
    expect(document).toContain('第 1 章 雨')
    expect(document).toContain('广播里念出了她的名字。')
    expect(document).toContain('w:pStyle w:val="Heading1"')
    expect(document).toContain('r:embed="rIdCover"')

    const rels = textOf(zip, 'word/_rels/document.xml.rels')
    expect(rels).toContain('media/cover.jpeg')
    expect(rels).toContain('styles.xml')

    const contentTypes = textOf(zip, '[Content_Types].xml')
    expect(contentTypes).toContain('ContentType="image/jpeg"')
    expect(contentTypes).toContain('wordprocessingml.styles+xml')
  })

  it('embeds GIF and WebP covers', async () => {
    const covers = [
      ['data:image/gif;base64,R0lGODlh', 'gif', 'image/gif'],
      ['data:image/webp;base64,UklGRg==', 'webp', 'image/webp']
    ] as const

    for (const [coverData, extension, mediaType] of covers) {
      const file = await buildExportFile({ ...BOOK, coverData }, 'docx')
      const zip = parseZip(file.bytes)
      expect(zip.names).toContain(`word/media/cover.${extension}`)
      expect(textOf(zip, 'word/document.xml')).toContain('r:embed="rIdCover"')
      expect(textOf(zip, 'word/_rels/document.xml.rels')).toContain(
        `media/cover.${extension}`
      )
      expect(textOf(zip, '[Content_Types].xml')).toContain(`ContentType="${mediaType}"`)
    }
  })
})
