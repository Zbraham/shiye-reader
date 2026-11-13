export type ImportFormat = 'txt' | 'md' | 'epub' | 'html' | 'docx' | 'fb2' | 'rtf'

export interface ParsedChapter {
  title: string
  content: string
  /** Sanitised rich HTML for EPUB/HTML imports. Empty for plain text. */
  html?: string
  /** Volume label parsed from a higher-level heading. */
  volume?: string
  /** Heading depth: 1 = chapter, 2+ = deeper section. */
  level?: number
}

export interface ParsedBook {
  title: string
  author?: string
  description?: string
  language?: string
  publisher?: string
  series?: string
  tags?: string[]
  coverData?: string
  format: ImportFormat
  encoding: string
  chapters: ParsedChapter[]
  words: number
  warnings: string[]
}

export const IMPORT_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  totalChars: 8_000_000,
  chapters: 2000,
  chapterChars: 100_000,
  // Must match the IPC schema; inline illustrations count against this too.
  chapterHtmlChars: 2_000_000,
  fallbackChapterChars: 3000,
  zipEntryBytes: 12 * 1024 * 1024,
  zipTotalBytes: 60 * 1024 * 1024,
  zipRatio: 120
} as const

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}
