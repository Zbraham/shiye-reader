/** TXT and Markdown builders. Both use \n line endings. */

import type { ExportBook } from './types'

const CHAPTER_PREFIX =
  /^第\s*[0-9〇零一二三四五六七八九十百千万两]+\s*[章节回卷部篇][：:、.．·\s-]*/u

/** Avoids repeating a leading "第 N 章" inside the generated heading. */
export function chapterHeading(idx: number, title: string, separator: string): string {
  const clean = title.replace(CHAPTER_PREFIX, '').trim()
  return clean ? `第 ${idx} 章${separator}${clean}` : `第 ${idx} 章`
}

function metadataLine(book: ExportBook): string {
  const parts: string[] = []
  const add = (label: string, value?: string): void => {
    const text = value?.trim()
    if (text) parts.push(`${label}：${text}`)
  }
  add('作者', book.author)
  add('类型', book.genre)
  add('基调', book.tone)
  add('视角', book.pov)
  const tags = (book.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  if (tags.length > 0) parts.push(`标签：${tags.join('、')}`)
  add('系列', book.series)
  add('出版社', book.publisher)
  add('语言', book.language)
  return parts.join(' · ')
}

export function buildTxt(book: ExportBook): string {
  const lines: string[] = [`《${book.title}》`, '']
  const synopsis = book.synopsis?.trim()
  if (synopsis) lines.push(synopsis, '')

  for (const chapter of book.chapters) {
    lines.push(chapterHeading(chapter.idx, chapter.title, '　'), '')
    const content = chapter.content.replace(/\r\n?/gu, '\n').trim()
    if (content) lines.push(content, '')
  }
  return lines.join('\n')
}

export function buildMarkdown(book: ExportBook): string {
  const lines: string[] = [`# ${book.title}`, '']
  const metadata = metadataLine(book)
  if (metadata) lines.push(`> ${metadata}`, '')

  const synopsis = book.synopsis?.trim()
  if (synopsis) lines.push(synopsis, '')

  for (const chapter of book.chapters) {
    lines.push(`## ${chapterHeading(chapter.idx, chapter.title, ' ')}`, '')
    const paragraphs = chapter.content
      .replace(/\r\n?/gu, '\n')
      .split(/\n{2,}/u)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
    if (paragraphs.length > 0) lines.push(paragraphs.join('\n\n'), '')
  }
  return lines.join('\n')
}
