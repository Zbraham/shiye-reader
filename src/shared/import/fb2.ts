import { finalizeChapters, reflowParagraphs, splitPlainText } from './chapters'
import { decodeDeclaredText, decodeNovelBytes, readAsciiHead } from './decode'
import { cleanInline, decodeEntities } from './sanitize'
import { ImportError, type ParsedChapter } from './types'

export interface Fb2Book {
  title: string
  author?: string
  description?: string
  language?: string
  publisher?: string
  series?: string
  tags?: string[]
  coverData?: string
  chapters: ParsedChapter[]
  warnings: string[]
  encoding: string
}

interface Draft {
  title: string
  paragraphs: string[]
}

function elementText(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'iu')
  const match = pattern.exec(xml)
  return match ? cleanInline(match[1] ?? '') : ''
}

function readAuthors(titleInfo: string): string {
  const names: string[] = []
  for (const match of titleInfo.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/giu)) {
    const block = match[1] ?? ''
    const parts = ['first-name', 'middle-name', 'last-name', 'nickname']
      .map((tag) => elementText(block, tag))
      .filter(Boolean)
    if (parts.length === 0) continue
    const name = parts
      .join(' ')
      .replace(/([㐀-鿿])\s+(?=[㐀-鿿])/gu, '$1')
      .trim()
    if (name) names.push(name)
  }
  return names.join('、').slice(0, 80)
}

function readTags(titleInfo: string): string[] {
  const tags: string[] = []
  for (const match of titleInfo.matchAll(/<genre\b[^>]*>([\s\S]*?)<\/genre>/giu)) {
    const value = cleanInline(match[1] ?? '').slice(0, 24)
    if (value && !tags.includes(value) && tags.length < 12) tags.push(value)
  }
  return tags
}

function extractCover(xml: string): string | undefined {
  const coverpage = /<coverpage\b[^>]*>([\s\S]*?)<\/coverpage>/iu.exec(xml)
  if (!coverpage) return undefined
  const reference = /<image\b[^>]*\b(?:l:href|href)\s*=\s*["']#([^"']+)["']/iu.exec(
    coverpage[1] ?? ''
  )
  const id = reference?.[1] ?? ''
  if (!id) return undefined
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const binary = new RegExp(
    `<binary\\b[^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/binary>`,
    'iu'
  ).exec(xml)
  if (!binary) return undefined
  const tag = /<binary\b[^>]*>/iu.exec(binary[0] ?? '')?.[0] ?? ''
  const media = (
    /content-type\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1] ?? 'image/jpeg'
  ).toLowerCase()
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(media)) {
    return undefined
  }
  const base64 = (binary[1] ?? '').replace(/\s+/gu, '')
  if (!base64 || base64.length > 380_000) return undefined
  return `data:${media};base64,${base64}`
}

/**
 * Extracts <section><title>…</title><p>…</p></section> structure. Title tags
 * inside poems are ignored so verse headings do not become chapters.
 */
function bodyDrafts(bodyXml: string): Draft[] {
  const drafts: Draft[] = []
  let current: Draft | null = null
  let preamble: string[] = []
  let titleText = ''
  let inTitle = false
  let treatTitle = false
  let paragraphText = ''
  let inParagraph = false
  let poemDepth = 0

  const pushParagraph = (raw: string): void => {
    const text = cleanInline(raw)
    if (!text) return
    if (current) current.paragraphs.push(text)
    else preamble.push(text)
  }

  const pattern = /<[^>]*>/gu
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(bodyXml)) !== null) {
    const index = match.index
    const textChunk = decodeEntities(bodyXml.slice(cursor, index))
    cursor = index + (match[0]?.length ?? 0)
    if (inTitle) titleText += textChunk
    else if (inParagraph) paragraphText += textChunk

    const tag = match[0] ?? ''
    const tagMatch = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:._-]*)/u.exec(tag)
    if (!tagMatch) continue
    const closing = (tagMatch[1] ?? '') === '/'
    const name = (tagMatch[2] ?? '').toLowerCase()

    if (name === 'poem') {
      poemDepth = closing ? Math.max(0, poemDepth - 1) : poemDepth + 1
      continue
    }

    if (inTitle) {
      if (name === 'title' && closing) {
        inTitle = false
        if (treatTitle) {
          const title = cleanInline(titleText)
          if (title) {
            current = { title, paragraphs: [] }
            drafts.push(current)
          }
        }
        titleText = ''
      } else if (name === 'p' && closing) {
        // Separate multi-line titles instead of gluing them together.
        titleText += ' '
      }
      continue
    }

    if (name === 'title' && !closing) {
      inTitle = true
      treatTitle = poemDepth === 0
      titleText = ''
      continue
    }

    if (name === 'p' || name === 'subtitle' || name === 'v' || name === 'text' || name === 'cite') {
      if (closing) {
        inParagraph = false
        pushParagraph(paragraphText)
        paragraphText = ''
      } else if (!/\/\s*>$/u.test(tag)) {
        inParagraph = true
        paragraphText = ''
      }
    }
  }

  if (inParagraph) pushParagraph(paragraphText)

  if (preamble.length > 0) {
    if (drafts.length === 0) {
      drafts.push({ title: '', paragraphs: preamble })
    } else {
      drafts.unshift({ title: '前言', paragraphs: preamble })
    }
    preamble = []
  }
  return drafts
}

/** Reads the encoding from the XML declaration. */
function declaredEncoding(bytes: Uint8Array): string {
  const head = readAsciiHead(bytes)
  const match = /<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/iu.exec(head)
  return match?.[1] ?? ''
}

export function parseFb2(bytes: Uint8Array): Fb2Book {
  const decoded =
    decodeDeclaredText(bytes, declaredEncoding(bytes)) ?? decodeNovelBytes(bytes)
  const xml = decoded.text
  if (!/<FictionBook\b/iu.test(xml)) {
    throw new ImportError('这个 FB2 文件缺少 FictionBook 根节点，无法读取。')
  }

  const descriptionBlock = /<description\b[^>]*>([\s\S]*?)<\/description>/iu.exec(xml)
  const description = descriptionBlock?.[1] ?? xml
  const titleInfoBlock = /<title-info\b[^>]*>([\s\S]*?)<\/title-info>/iu.exec(description)
  const titleInfo = titleInfoBlock?.[1] ?? description
  const publishInfoBlock = /<publish-info\b[^>]*>([\s\S]*?)<\/publish-info>/iu.exec(description)

  const title = elementText(titleInfo, 'book-title')
  const author = readAuthors(titleInfo)
  const annotation = elementText(titleInfo, 'annotation')
  const language = elementText(titleInfo, 'lang')
  const publisher = elementText(publishInfoBlock?.[1] ?? '', 'publisher')
  const sequence = /<sequence\b[^>]*\bname\s*=\s*["']([^"']*)["']/iu.exec(titleInfo)
  const series = sequence ? cleanInline(sequence[1] ?? '').slice(0, 80) : ''
  const tags = readTags(titleInfo)
  const coverData = extractCover(xml)

  const bodyBlock = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(xml)
  if (!bodyBlock) throw new ImportError('这个 FB2 文件缺少 <body> 正文。')
  const body = bodyBlock[1] ?? ''
  const drafts = bodyDrafts(body)
  const fallbackTitle = title || '正文'

  let chapters: ParsedChapter[]
  if (!drafts.some((draft) => draft.title)) {
    const text = drafts.flatMap((draft) => draft.paragraphs).join('\n\n')
    chapters = splitPlainText(text, { fallbackTitle, format: 'txt' }).chapters
  } else {
    chapters = drafts
      .map((draft) => ({
        title: draft.title || fallbackTitle,
        content: reflowParagraphs(draft.paragraphs.join('\n\n'))
      }))
      .filter((chapter) => chapter.content.length > 0)
  }

  if (chapters.length === 0) throw new ImportError('这个 FB2 文件里没有可阅读的正文。')
  const clean = finalizeChapters(chapters)
  const warnings: string[] = []
  if (clean.length < chapters.length) warnings.push('部分空白段落已跳过。')

  return {
    title,
    ...(author ? { author } : {}),
    ...(annotation ? { description: annotation.slice(0, 4000) } : {}),
    ...(language ? { language: language.slice(0, 30) } : {}),
    ...(publisher ? { publisher: publisher.slice(0, 80) } : {}),
    ...(series ? { series } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(coverData ? { coverData } : {}),
    chapters: clean,
    warnings,
    encoding: `FB2 XML（${decoded.encoding}）`
  }
}
