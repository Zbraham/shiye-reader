/** Public data shapes for the shared export module. */

export interface ExportChapter {
  idx: number
  title: string
  content: string
}

export interface ExportBook {
  title: string
  author?: string
  language?: string
  publisher?: string
  series?: string
  description?: string
  tags?: string[]
  genre?: string
  tone?: string
  pov?: string
  synopsis?: string
  coverData?: string // data:image/...;base64,... or empty
  chapters: ExportChapter[]
}

export interface ExportFile {
  fileName: string
  mime: string
  bytes: Uint8Array
}
