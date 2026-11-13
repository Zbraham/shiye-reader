/** Unified entry points for exporting a book to TXT, Markdown, EPUB or DOCX. */

import type { ExportFormat } from '@shared/types'
import { buildDocx } from './docx'
import { buildEpub } from './epub'
import { buildMarkdown, buildTxt } from './plain'
import type { ExportBook, ExportFile } from './types'

export type ExportFileFormat = ExportFormat

const MIME: Record<Exclude<ExportFileFormat, 'pdf'>, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

const EXTENSION: Record<ExportFileFormat, string> = {
  txt: 'txt',
  md: 'md',
  epub: 'epub',
  docx: 'docx',
  pdf: 'pdf'
}

export function exportExtension(format: ExportFormat): string {
  return EXTENSION[format]
}

/** Windows treats these base names (without extension) as device names. */
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?=$|\.)/iu

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/u, '')
  const safe = cleaned.slice(0, 80).trim()
  if (!safe) return '未命名'
  // Prefixing keeps the extension intact while avoiding device-name collisions.
  return WINDOWS_RESERVED_NAME.test(safe) ? `_${safe.slice(0, 79)}` : safe
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function buildExportText(
  book: ExportBook,
  format: 'txt' | 'md'
): string {
  return format === 'md' ? buildMarkdown(book) : buildTxt(book)
}

export async function buildExportFile(
  book: ExportBook,
  format: ExportFormat
): Promise<ExportFile> {
  if (format === 'pdf') throw new Error('PDF 由桌面端生成')

  const baseName = sanitizeFileName(book.title)
  const fileName = `${baseName}.${EXTENSION[format]}`
  if (format === 'txt' || format === 'md') {
    return { fileName, mime: MIME[format], bytes: encode(buildExportText(book, format)) }
  }
  if (format === 'epub') {
    return { fileName, mime: MIME.epub, bytes: await buildEpub(book) }
  }
  return { fileName, mime: MIME.docx, bytes: await buildDocx(book) }
}

export type { ExportBook, ExportChapter, ExportFile } from './types'
