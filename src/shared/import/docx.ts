import {
  cleanHeadingText,
  finalizeChapters,
  isChapterHeadingLine,
  reflowParagraphs,
  splitPlainText
} from './chapters'
import { decodeEntities } from './sanitize'
import { ImportError, type ParsedChapter } from './types'
import { openZip, type ZipArchive } from './zip'

export interface DocxBook {
  title?: string
  author?: string
  description?: string
  language?: string
  publisher?: string
  tags?: string[]
  chapters: ParsedChapter[]
  warnings: string[]
}

interface DocxParagraph {
  text: string
  headingLevel: number | null
}

function paragraphText(paragraphXml: string): string {
  const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/giu
  let text = ''
  for (const match of paragraphXml.matchAll(pattern)) {
    const token = match[0] ?? ''
    if (/^<w:t\b/iu.test(token)) {
      text += decodeEntities(match[1] ?? '')
    } else if (/^<w:tab\b/iu.test(token)) {
      text += ' '
    } else {
      text += '\n'
    }
  }
  return text.replace(/ /gu, ' ')
}

function headingLevelOf(paragraphXml: string): number | null {
  const style = /<w:pStyle\b[^>]*\bw:val\s*=\s*["']([^"']+)["']/iu.exec(paragraphXml)
  if (style) {
    const value = (style[1] ?? '').replace(/\s+/gu, '').toLowerCase()
    const match = /^heading([1-6])$/u.exec(value)
    if (match) return Number.parseInt(match[1] ?? '1', 10)
  }
  const outline = /<w:outlineLvl\b[^>]*\bw:val\s*=\s*["']([0-9])["']/iu.exec(paragraphXml)
  if (outline) {
    const value = Number.parseInt(outline[1] ?? '0', 10) + 1
    return Math.min(6, Math.max(1, value))
  }
  return null
}

function parseParagraphs(documentXml: string): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = []
  const pattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/giu
  for (const match of documentXml.matchAll(pattern)) {
    const xml = match[0] ?? ''
    const text = paragraphText(xml).trim()
    if (!text) continue
    paragraphs.push({ text, headingLevel: headingLevelOf(xml) })
  }
  return paragraphs
}

function buildChapters(paragraphs: DocxParagraph[], fallbackTitle: string): ParsedChapter[] {
  const chapters: ParsedChapter[] = []
  let currentTitle = ''
  let body: string[] = []
  let sawHeading = false

  const flush = (): void => {
    if (body.length === 0) return
    const content = reflowParagraphs(body.join('\n\n'))
    if (content) {
      chapters.push({ title: currentTitle || fallbackTitle, content })
      currentTitle = ''
    }
    body = []
  }

  for (const paragraph of paragraphs) {
    const heading =
      paragraph.headingLevel !== null ||
      isChapterHeadingLine(paragraph.text)
    if (heading) {
      flush()
      sawHeading = true
      currentTitle = cleanHeadingText(paragraph.text)
      continue
    }
    body.push(paragraph.text)
  }
  flush()

  if (!sawHeading) {
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n\n')
    if (!text.trim()) return []
    const split = splitPlainText(text, { fallbackTitle, format: 'txt' })
    return split.chapters
  }
  return chapters
}

function elementText(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'iu')
  const match = pattern.exec(xml)
  return match ? cleanHeadingText(decodeEntities(match[1] ?? '')) : ''
}

function parseCore(xml: string): Omit<DocxBook, 'chapters' | 'warnings'> {
  const creators = Array.from(
    xml.matchAll(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/giu),
    (match) => cleanHeadingText(decodeEntities(match[1] ?? ''))
  ).filter(Boolean)

  const tags: string[] = []
  for (const match of xml.matchAll(/<dc:subject\b[^>]*>([\s\S]*?)<\/dc:subject>/giu)) {
    const value = cleanHeadingText(decodeEntities(match[1] ?? '')).slice(0, 24)
    if (value && !tags.includes(value) && tags.length < 12) tags.push(value)
  }

  const title = elementText(xml, 'dc:title')
  const description = elementText(xml, 'dc:description')
  const language = elementText(xml, 'dc:language')
  const publisher = elementText(xml, 'dc:publisher')
  return {
    ...(title ? { title: title.slice(0, 60) } : {}),
    ...(creators.length > 0 ? { author: creators.join('、').slice(0, 80) } : {}),
    ...(description ? { description: description.slice(0, 4000) } : {}),
    ...(language ? { language: language.slice(0, 30) } : {}),
    ...(publisher ? { publisher: publisher.slice(0, 80) } : {}),
    ...(tags.length > 0 ? { tags } : {})
  }
}

async function readOptionalText(archive: ZipArchive, path: string | null): Promise<string> {
  if (!path) return ''
  try {
    return await archive.readText(path)
  } catch {
    return ''
  }
}

/** Reads a DOCX package: word/document.xml plus optional core properties. */
export async function parseDocx(bytes: Uint8Array): Promise<DocxBook> {
  let archive: ZipArchive
  try {
    archive = await openZip(bytes)
  } catch (error) {
    if (error instanceof ImportError) {
      if (/ZIP64|过大|数量异常/u.test(error.message)) throw error
      throw new ImportError(`这个 DOCX 无法读取：${error.message}`)
    }
    throw error
  }

  const documentPath = archive.has('word/document.xml')
    ? 'word/document.xml'
    : archive.find((name) => name.toLowerCase() === 'word/document.xml')
  if (!documentPath) {
    throw new ImportError('这个 DOCX 缺少 word/document.xml，无法读取正文。')
  }

  let documentXml: string
  try {
    documentXml = await archive.readText(documentPath)
  } catch {
    throw new ImportError('这个 DOCX 文件已加密或损坏，无法读取正文。')
  }

  const corePath = archive.has('docProps/core.xml')
    ? 'docProps/core.xml'
    : archive.find((name) => name.toLowerCase() === 'docprops/core.xml')
  const coreXml = await readOptionalText(archive, corePath)
  const metadata = coreXml ? parseCore(coreXml) : {}

  const paragraphs = parseParagraphs(documentXml)
  const fallbackTitle = metadata.title || '正文'
  const chapters = buildChapters(paragraphs, fallbackTitle)
  const clean = finalizeChapters(chapters)
  const warnings: string[] = []
  if (clean.length < chapters.length) warnings.push('部分空白段落已跳过。')

  return { ...metadata, chapters: clean, warnings }
}
