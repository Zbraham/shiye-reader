import { finalizeChapters } from './chapters'
import { decodeDeclaredText, decodeNovelBytes, readAsciiHead } from './decode'
import { splitHtmlChapters } from './html-chapters'
import { cleanInline } from './sanitize'
import { ImportError, type ParsedChapter } from './types'

export interface HtmlBook {
  title: string
  author?: string
  description?: string
  language?: string
  chapters: ParsedChapter[]
  warnings: string[]
  encoding: string
}

function metaContent(html: string, name: string): string {
  const pattern = new RegExp(
    `<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
    'iu'
  )
  const match = pattern.exec(html)
  if (!match) return ''
  const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(match[0])
  return content ? cleanInline(content[1] ?? content[2] ?? '') : ''
}

/** Reads a charset declared by <meta charset> or an http-equiv content-type. */
function declaredCharset(bytes: Uint8Array): string {
  const head = readAsciiHead(bytes)
  const match = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([a-zA-Z0-9._:-]+)/iu.exec(
    head
  )
  return match?.[1] ?? ''
}

/** Parses a standalone HTML file, splitting chapters at h1-h6 headings. */
export function parseHtml(bytes: Uint8Array): HtmlBook {
  const decoded =
    decodeDeclaredText(bytes, declaredCharset(bytes)) ?? decodeNovelBytes(bytes)
  const html = decoded.text

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
  const title = titleMatch ? cleanInline(titleMatch[1] ?? '') : ''
  const author = metaContent(html, 'author')
  const description = metaContent(html, 'description')
  const language = metaContent(html, 'language')

  const chapters = splitHtmlChapters(html, {
    fallbackTitle: title || '正文'
  })
  if (chapters.length === 0) throw new ImportError('这个 HTML 里没有可阅读的正文。')

  const clean = finalizeChapters(chapters)
  const warnings: string[] = []
  if (clean.length < chapters.length) warnings.push('部分空白页已跳过。')

  return {
    title,
    ...(author ? { author: author.slice(0, 80) } : {}),
    ...(description ? { description: description.slice(0, 4000) } : {}),
    ...(language ? { language: language.slice(0, 30) } : {}),
    chapters: clean,
    warnings,
    encoding: `HTML（${decoded.encoding}）`
  }
}
