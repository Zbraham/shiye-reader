import { countWords } from '../text'
import { finalizeChapters, splitPlainText } from './chapters'
import { decodeNovelBytes } from './decode'
import { parseDocx } from './docx'
import { parseEpub } from './epub'
import { parseFb2 } from './fb2'
import { parseHtml } from './html'
import { parseRtf } from './rtf'
import { IMPORT_LIMITS, ImportError, type ImportFormat, type ParsedBook } from './types'
import { openZip, type ZipArchive } from './zip'

export interface ParseNovelInput {
  name: string
  bytes: Uint8Array
}

const SUPPORTED_MESSAGE =
  '只支持导入 TXT、Markdown、HTML、EPUB、DOCX、FB2、RTF 和 ZIP 文件。'

function extensionOf(name: string): string {
  const match = /\.([^.\\/]+)$/u.exec(name)
  return match?.[1]?.toLowerCase() ?? ''
}

function titleFromName(name: string): string {
  const base = name.replace(/^.*[\\/]/u, '').replace(/\.[^.]+$/u, '').trim()
  const cleaned = base.replace(/^《(.*)》$/u, '$1').replace(/[_\s]+/gu, ' ').trim()
  return cleaned || '未命名'
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  )
}

function wordsOf(chapters: ParsedBook['chapters']): number {
  return chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0)
}

function formatOfExtension(extension: string): ImportFormat | 'zip' | null {
  if (extension === 'txt' || extension === 'text') return 'txt'
  if (extension === 'md' || extension === 'markdown') return 'md'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'epub') return 'epub'
  if (extension === 'docx') return 'docx'
  if (extension === 'fb2') return 'fb2'
  if (extension === 'rtf') return 'rtf'
  if (extension === 'zip') return 'zip'
  return null
}

function parsePlain(bytes: Uint8Array, name: string, format: 'txt' | 'md'): ParsedBook {
  const decoded = decodeNovelBytes(bytes)
  const split = splitPlainText(decoded.text, {
    fallbackTitle: titleFromName(name),
    format
  })
  const chapters = finalizeChapters(split.chapters)
  return {
    title: split.title || titleFromName(name),
    format,
    encoding: decoded.encoding,
    chapters,
    words: wordsOf(chapters),
    warnings: split.warnings
  }
}

async function parseEpubBook(bytes: Uint8Array, name: string): Promise<ParsedBook> {
  if (!isZip(bytes)) throw new ImportError('这个 .epub 文件不是有效的 EPUB。')
  const epub = await parseEpub(bytes)
  return {
    title: epub.title && epub.title !== '未命名' ? epub.title : titleFromName(name),
    format: 'epub',
    encoding: 'EPUB（ZIP 解包）',
    chapters: epub.chapters,
    words: wordsOf(epub.chapters),
    warnings: epub.warnings,
    ...(epub.author ? { author: epub.author } : {}),
    ...(epub.description ? { description: epub.description } : {}),
    ...(epub.language ? { language: epub.language } : {}),
    ...(epub.publisher ? { publisher: epub.publisher } : {}),
    ...(epub.series ? { series: epub.series } : {}),
    ...(epub.tags && epub.tags.length > 0 ? { tags: epub.tags } : {}),
    ...(epub.coverData ? { coverData: epub.coverData } : {})
  }
}

function parseHtmlBook(bytes: Uint8Array, name: string): ParsedBook {
  const html = parseHtml(bytes)
  return {
    title: html.title || titleFromName(name),
    format: 'html',
    encoding: html.encoding,
    chapters: html.chapters,
    words: wordsOf(html.chapters),
    warnings: html.warnings,
    ...(html.author ? { author: html.author } : {}),
    ...(html.description ? { description: html.description } : {}),
    ...(html.language ? { language: html.language } : {})
  }
}

async function parseDocxBook(bytes: Uint8Array, name: string): Promise<ParsedBook> {
  if (!isZip(bytes)) throw new ImportError('这个 .docx 文件不是有效的 DOCX（ZIP）文件。')
  const docx = await parseDocx(bytes)
  return {
    title: docx.title || titleFromName(name),
    format: 'docx',
    encoding: 'DOCX（ZIP + Office XML）',
    chapters: docx.chapters,
    words: wordsOf(docx.chapters),
    warnings: docx.warnings,
    ...(docx.author ? { author: docx.author } : {}),
    ...(docx.description ? { description: docx.description } : {}),
    ...(docx.language ? { language: docx.language } : {}),
    ...(docx.publisher ? { publisher: docx.publisher } : {}),
    ...(docx.tags && docx.tags.length > 0 ? { tags: docx.tags } : {})
  }
}

function parseFb2Book(bytes: Uint8Array, name: string): ParsedBook {
  const fb2 = parseFb2(bytes)
  return {
    title: fb2.title || titleFromName(name),
    format: 'fb2',
    encoding: fb2.encoding,
    chapters: fb2.chapters,
    words: wordsOf(fb2.chapters),
    warnings: fb2.warnings,
    ...(fb2.author ? { author: fb2.author } : {}),
    ...(fb2.description ? { description: fb2.description } : {}),
    ...(fb2.language ? { language: fb2.language } : {}),
    ...(fb2.publisher ? { publisher: fb2.publisher } : {}),
    ...(fb2.series ? { series: fb2.series } : {}),
    ...(fb2.tags && fb2.tags.length > 0 ? { tags: fb2.tags } : {}),
    ...(fb2.coverData ? { coverData: fb2.coverData } : {})
  }
}

function parseRtfBook(bytes: Uint8Array, name: string): ParsedBook {
  const rtf = parseRtf(bytes)
  return {
    title: titleFromName(name),
    format: 'rtf',
    encoding: rtf.encoding,
    chapters: rtf.chapters,
    words: wordsOf(rtf.chapters),
    warnings: rtf.warnings
  }
}

async function parseKnownFormat(
  format: ImportFormat,
  name: string,
  bytes: Uint8Array
): Promise<ParsedBook> {
  switch (format) {
    case 'txt':
    case 'md':
      return parsePlain(bytes, name, format)
    case 'html':
      return parseHtmlBook(bytes, name)
    case 'epub':
      return parseEpubBook(bytes, name)
    case 'docx':
      return parseDocxBook(bytes, name)
    case 'fb2':
      return parseFb2Book(bytes, name)
    case 'rtf':
      return parseRtfBook(bytes, name)
  }
}

async function openArchive(bytes: Uint8Array): Promise<ZipArchive> {
  try {
    return await openZip(bytes)
  } catch (error) {
    if (error instanceof ImportError) {
      throw new ImportError(`这个 ZIP 无法读取：${error.message}`)
    }
    throw error
  }
}

async function archiveKind(archive: ZipArchive): Promise<'epub' | 'docx' | 'zip'> {
  if (archive.has('mimetype')) {
    try {
      const mime = await archive.readText('mimetype')
      if (/epub/iu.test(mime)) return 'epub'
    } catch {
      // Fall through to the other markers.
    }
  }
  if (archive.has('META-INF/container.xml')) return 'epub'
  if (
    archive.has('word/document.xml') ||
    archive.find((name) => name.toLowerCase() === 'word/document.xml') !== null
  ) {
    return 'docx'
  }
  return 'zip'
}

function skippedTxtWarning(entries: string[]): string {
  return `压缩包内有 ${entries.length} 个 TXT 无法读取，已跳过：${entries.join('、')}`
}

function isIgnoredEntry(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.startsWith('__macosx/') ||
    lower.includes('/__macosx/') ||
    /(^|\/)\./u.test(name)
  )
}

async function parseZipBook(bytes: Uint8Array, name: string): Promise<ParsedBook> {
  const archive = await openArchive(bytes)
  const kind = await archiveKind(archive)
  if (kind === 'epub') return parseEpubBook(bytes, name)
  if (kind === 'docx') return parseDocxBook(bytes, name)

  const names = archive.names.filter((entry) => !isIgnoredEntry(entry))
  const txtEntries = names
    .filter((entry) => /\.txt$/iu.test(entry))
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))

  if (txtEntries.length >= 2) {
    const parts: string[] = []
    const skipped: string[] = []
    let encoding = 'UTF-8'
    for (const entry of txtEntries) {
      try {
        const decoded = decodeNovelBytes(await archive.read(entry))
        if (parts.length === 0) encoding = decoded.encoding
        parts.push(decoded.text)
      } catch {
        // Skip unreadable entries, but name them in the import warning.
        skipped.push(entry)
      }
    }
    if (parts.length > 0) {
      const fallbackTitle = titleFromName(name)
      const split = splitPlainText(parts.join('\n\n'), {
        fallbackTitle,
        format: 'txt'
      })
      const chapters = finalizeChapters(split.chapters)
      return {
        title: split.title || fallbackTitle,
        format: 'txt',
        encoding,
        chapters,
        words: wordsOf(chapters),
        warnings: [
          ...split.warnings,
          '已合并压缩包内的多个 TXT 文件。',
          ...(skipped.length > 0 ? [skippedTxtWarning(skipped)] : [])
        ]
      }
    }
  }

  const candidates = names
    .map((entry) => ({
      entry,
      format: formatOfExtension(extensionOf(entry)),
      size: archive.entrySize(entry)
    }))
    .filter(
      (
        candidate
      ): candidate is { entry: string; format: ImportFormat; size: number } =>
        candidate.format !== null && candidate.format !== 'zip'
    )
    .sort((left, right) => right.size - left.size)

  if (candidates.length === 0) {
    throw new ImportError('压缩包里没有可导入的小说文件。')
  }

  let lastError: ImportError | null = null
  for (const candidate of candidates) {
    let data: Uint8Array
    try {
      data = await archive.read(candidate.entry)
    } catch {
      continue
    }
    const innerName = candidate.entry.replace(/^.*\//u, '')
    try {
      const book = await parseKnownFormat(candidate.format, innerName, data)
      return {
        ...book,
        warnings: [...book.warnings, `已从压缩包中读取 ${innerName}。`]
      }
    } catch (error) {
      if (error instanceof ImportError) {
        lastError = error
        continue
      }
      throw error
    }
  }
  if (lastError) throw lastError
  throw new ImportError('压缩包里没有可阅读的小说文件。')
}

function sniffFormat(bytes: Uint8Array): ImportFormat | null {
  if (isZip(bytes)) return null
  let text = ''
  try {
    text = decodeNovelBytes(bytes).text
  } catch {
    return null
  }
  const head = text.slice(0, 8192)
  if (/^\s*\{\\rtf/iu.test(head)) return 'rtf'
  if (/<FictionBook\b/iu.test(head)) return 'fb2'
  if (
    /^\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+html\b|<html\b|<body\b)/iu.test(head)
  ) {
    return 'html'
  }
  return null
}

export async function parseNovelFile(input: ParseNovelInput): Promise<ParsedBook> {
  const name = input.name || '未命名'
  const bytes = input.bytes
  if (bytes.length === 0) throw new ImportError('这个文件是空的。')
  if (bytes.length > IMPORT_LIMITS.fileBytes) {
    throw new ImportError(
      `文件有 ${(bytes.length / 1024 / 1024).toFixed(1)} MB，超过 ${IMPORT_LIMITS.fileBytes / 1024 / 1024} MB 上限。`
    )
  }

  const extension = extensionOf(name)
  const declared = formatOfExtension(extension)
  if (declared === 'zip') return parseZipBook(bytes, name)
  if (declared) return parseKnownFormat(declared, name, bytes)

  if (isZip(bytes)) return parseZipBook(bytes, name)

  const sniffed = sniffFormat(bytes)
  if (sniffed) return parseKnownFormat(sniffed, name, bytes)

  throw new ImportError(SUPPORTED_MESSAGE)
}

export { ImportError, IMPORT_LIMITS } from './types'
export type { ImportFormat, ParsedBook, ParsedChapter } from './types'
