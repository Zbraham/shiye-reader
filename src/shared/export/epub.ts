/** EPUB 3 packaging. One XHTML document per chapter, no external resources. */

import { hashText } from '../text'
import { encodeUtf8 } from './bytes'
import { chapterHeading } from './plain'
import type { ExportBook, ExportChapter } from './types'
import { escapeXml, parseCoverData, type CoverImage } from './xml'
import { buildZip, type ZipEntryInput } from './zip'

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

const STYLE_CSS = `body {
  margin: 0 auto;
  max-width: 42em;
  padding: 1.2em;
  color: #222;
  font-family: serif;
  line-height: 1.8;
}
h1 {
  margin: 1em 0 1.2em;
  font-size: 1.5em;
  text-align: center;
}
p {
  margin: 0 0 0.7em;
  text-indent: 2em;
}
`

function languageOf(book: ExportBook): string {
  return book.language?.trim() || 'zh-CN'
}

function stableUuid(title: string): string {
  const seed = title || '未命名'
  const hex =
    hashText(seed) +
    hashText(`book:${seed}`) +
    hashText(`uuid:${seed}`) +
    hashText(`id:${seed}`)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-')
}

function modifiedTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
}

function chapterPath(index: number): string {
  return `text/chapter-${index + 1}.xhtml`
}

function chapterLabel(chapter: ExportChapter): string {
  return chapterHeading(chapter.idx, chapter.title, ' ')
}

function xhtmlDocument(
  language: string,
  title: string,
  body: string,
  stylesheetHref: string
): string {
  const lang = escapeXml(language)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="${stylesheetHref}"/>
</head>
<body>
${body}
</body>
</html>
`
}

function chapterDocument(language: string, chapter: ExportChapter): string {
  const heading = chapterLabel(chapter)
  const paragraphs = chapter.content
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join('\n')
  const body = [`<h1>${escapeXml(heading)}</h1>`, paragraphs].filter(Boolean).join('\n')
  return xhtmlDocument(language, heading, body, '../style.css')
}

function navDocument(language: string, book: ExportBook): string {
  const items = book.chapters
    .map(
      (chapter, index) =>
        `      <li><a href="${chapterPath(index)}">${escapeXml(chapterLabel(chapter))}</a></li>`
    )
    .join('\n')
  const body = `<nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>`
  return xhtmlDocument(language, '目录', body, 'style.css')
}

function metadataXml(book: ExportBook, language: string): string {
  const lines: string[] = [
    `    <dc:identifier id="book-id">urn:uuid:${stableUuid(book.title)}</dc:identifier>`,
    `    <dc:title>${escapeXml(book.title)}</dc:title>`,
    `    <dc:language>${escapeXml(language)}</dc:language>`
  ]
  const author = book.author?.trim()
  if (author) lines.push(`    <dc:creator>${escapeXml(author)}</dc:creator>`)
  const publisher = book.publisher?.trim()
  if (publisher) lines.push(`    <dc:publisher>${escapeXml(publisher)}</dc:publisher>`)
  const description = (book.description ?? book.synopsis ?? '').trim()
  if (description) lines.push(`    <dc:description>${escapeXml(description)}</dc:description>`)

  const subjects: string[] = []
  for (const tag of book.tags ?? []) {
    const text = tag.trim()
    if (text && !subjects.includes(text)) subjects.push(text)
  }
  const genre = book.genre?.trim()
  if (genre && !subjects.includes(genre)) subjects.push(genre)
  for (const subject of subjects) {
    lines.push(`    <dc:subject>${escapeXml(subject)}</dc:subject>`)
  }

  const series = book.series?.trim()
  if (series) {
    lines.push(
      `    <meta property="belongs-to-collection" id="collection">${escapeXml(series)}</meta>`,
      '    <meta refines="#collection" property="collection-type">series</meta>'
    )
  }
  lines.push(`    <meta property="dcterms:modified">${modifiedTime()}</meta>`)
  return lines.join('\n')
}

function contentOpf(book: ExportBook, language: string, cover: CoverImage | null): string {
  const manifest: string[] = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="style" href="style.css" media-type="text/css"/>'
  ]
  if (cover) {
    manifest.push(
      `    <item id="cover-image" href="images/cover.${cover.extension}" media-type="${cover.mediaType}" properties="cover-image"/>`
    )
  }
  for (let index = 0; index < book.chapters.length; index += 1) {
    manifest.push(
      `    <item id="chapter-${index + 1}" href="${chapterPath(index)}" media-type="application/xhtml+xml"/>`
    )
  }
  const spine = book.chapters
    .map((_chapter, index) => `    <itemref idref="chapter-${index + 1}"/>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metadataXml(book, language)}
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`
}

export async function buildEpub(book: ExportBook): Promise<Uint8Array> {
  const language = languageOf(book)
  const cover = parseCoverData(book.coverData, { allowSvg: true })
  const entries: ZipEntryInput[] = [
    { name: 'mimetype', data: encodeUtf8('application/epub+zip'), compress: false },
    { name: 'META-INF/container.xml', data: encodeUtf8(CONTAINER_XML) },
    {
      name: 'OEBPS/content.opf',
      data: encodeUtf8(contentOpf(book, language, cover))
    },
    { name: 'OEBPS/nav.xhtml', data: encodeUtf8(navDocument(language, book)) },
    { name: 'OEBPS/style.css', data: encodeUtf8(STYLE_CSS) }
  ]
  if (cover) {
    entries.push({ name: `OEBPS/images/cover.${cover.extension}`, data: cover.bytes })
  }
  book.chapters.forEach((chapter, index) => {
    entries.push({
      name: `OEBPS/${chapterPath(index)}`,
      data: encodeUtf8(chapterDocument(language, chapter))
    })
  })
  return buildZip(entries)
}
