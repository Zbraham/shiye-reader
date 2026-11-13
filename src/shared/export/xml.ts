/** XML escaping and cover data URL parsing for EPUB and DOCX. */

import { decodeBase64 } from './bytes'

export type CoverMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'

export type CoverExtension = 'jpeg' | 'png' | 'gif' | 'webp' | 'svg'

export interface CoverImage {
  mediaType: CoverMediaType
  extension: CoverExtension
  bytes: Uint8Array
}

export interface ParseCoverOptions {
  /** EPUB 3 accepts SVG covers; some DOCX consumers do not. */
  allowSvg?: boolean
}

interface CoverFormat {
  mediaType: CoverMediaType
  extension: CoverExtension
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}

/** Drops code points that are not legal in XML 1.0, then escapes markup. */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/gu, '')
    .replace(/[&<>"']/gu, (char) => XML_ESCAPES[char] ?? char)
}

const COVER_DATA_PATTERN =
  /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,([\s\S]*)$/iu

const COVER_FORMATS: Readonly<Record<string, CoverFormat>> = {
  png: { mediaType: 'image/png', extension: 'png' },
  jpg: { mediaType: 'image/jpeg', extension: 'jpeg' },
  jpeg: { mediaType: 'image/jpeg', extension: 'jpeg' },
  gif: { mediaType: 'image/gif', extension: 'gif' },
  webp: { mediaType: 'image/webp', extension: 'webp' },
  'svg+xml': { mediaType: 'image/svg+xml', extension: 'svg' }
}

/** Returns the decoded cover, or null when the data URL is absent/unsupported. */
export function parseCoverData(
  data?: string,
  options: ParseCoverOptions = {}
): CoverImage | null {
  if (!data) return null
  const match = COVER_DATA_PATTERN.exec(data.trim())
  if (!match) return null
  const format = COVER_FORMATS[(match[1] ?? '').toLowerCase()]
  if (!format) return null
  if (format.mediaType === 'image/svg+xml' && !options.allowSvg) return null
  const bytes = decodeBase64(match[2] ?? '')
  if (!bytes || bytes.length === 0) return null
  return { mediaType: format.mediaType, extension: format.extension, bytes }
}
