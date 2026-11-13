import type { RoleTag } from '@shared/types'
import { hashText } from '@shared/text'

export const MIN_CHUNK_CHARS = 120
export const MAX_CHUNK_CHARS = 800

export interface ChunkDraft {
  idx: number
  startOff: number
  endOff: number
  text: string
  roleTag: RoleTag
  hash: string
}

interface Piece {
  start: number
  end: number
  text: string
}

const SEPARATOR_PATTERN = /^[\s*＊—–\-_=·]{2,}$/u
const QUOTED_PATTERN = /[“"「『][^”"」』\n]*[”"」』]/gu
const PSYCHOLOGY_PATTERN =
  /(她想|他想|她觉得|他觉得|心想|暗想|心里|心底|意识到|明白过来|回忆起|不由得想|暗自)/u
const TURN_PATTERN = /^(但是|但|然而|可是|忽然|突然|却|直到|没想到|不料|偏偏|只是)/u
const ACTION_PATTERN =
  /(走|跑|冲|停|站|坐|转身|回头|抬手|伸手|抓住|握住|推|拉|打开|关上|低头|抬头|看向|望向|落下|退后|靠近)/gu
const INFO_PATTERN = /(据说|原来|所谓|这意味着|是因为|规则|传说|传闻|据说|记载|来历)/u

export function isSceneSeparator(text: string): boolean {
  return SEPARATOR_PATTERN.test(text.trim()) && text.trim().length <= 12
}

function quoteRatio(text: string): number {
  if (!text) return 0
  let quotedLength = 0
  for (const match of text.matchAll(QUOTED_PATTERN)) {
    quotedLength += match[0].length
  }
  return quotedLength / Math.max(text.length, 1)
}

export function inferRoleTag(text: string): RoleTag {
  const trimmed = text.trim()
  if (!trimmed) return '信息'
  const ratio = quoteRatio(trimmed)
  const startsWithQuote = /^[“「『"]/u.test(trimmed)
  if (ratio > 0.3 || startsWithQuote) return '对话'
  if (PSYCHOLOGY_PATTERN.test(trimmed)) return '心理'
  if (TURN_PATTERN.test(trimmed)) return '转折'
  const actions = trimmed.match(ACTION_PATTERN)?.length ?? 0
  if (actions >= 3 && actions / Math.max(trimmed.length, 1) > 0.02) return '动作'
  if (INFO_PATTERN.test(trimmed)) return '信息'
  return '描写'
}

function trimPiece(content: string, start: number, end: number): Piece | null {
  let left = start
  let right = end
  while (left < right && /\s/.test(content[left] ?? '')) left += 1
  while (right > left && /\s/.test(content[right - 1] ?? '')) right -= 1
  if (right <= left) return null
  return { start: left, end: right, text: content.slice(left, right) }
}

/** Splits content on newline runs, keeping exact offsets. */
function collectPieces(content: string): Piece[] {
  const pieces: Piece[] = []
  const newlineRun = /\n+/g
  let cursor = 0
  let match = newlineRun.exec(content)
  while (match) {
    const piece = trimPiece(content, cursor, match.index)
    if (piece) pieces.push(piece)
    cursor = newlineRun.lastIndex
    match = newlineRun.exec(content)
  }
  const tail = trimPiece(content, cursor, content.length)
  if (tail) pieces.push(tail)
  return pieces
}

/** Sentence groups for a single over-long paragraph. Never cuts mid-sentence. */
function splitLongPiece(content: string, piece: Piece): Piece[] {
  if (piece.text.length <= MAX_CHUNK_CHARS) return [piece]
  const sentencePattern = /[^。！？!?…；;]*[。！？!?…；;]+[”’」』）)】]*/gu
  const sentences: { start: number; end: number }[] = []
  let match = sentencePattern.exec(piece.text)
  let consumed = 0
  while (match) {
    const raw = match[0]
    if (raw.length > 0) {
      sentences.push({ start: consumed, end: consumed + raw.length })
      consumed += raw.length
    }
    match = sentencePattern.exec(piece.text)
  }
  if (consumed < piece.text.length) {
    sentences.push({ start: consumed, end: piece.text.length })
  }

  const groups: Piece[] = []
  let groupStart: number | null = null
  let groupEnd = 0
  const flush = (): void => {
    if (groupStart === null) return
    const trimmed = trimPiece(content, piece.start + groupStart, piece.start + groupEnd)
    if (trimmed) groups.push(trimmed)
    groupStart = null
  }
  for (const sentence of sentences) {
    const length = sentence.end - sentence.start
    if (groupStart === null) {
      groupStart = sentence.start
      groupEnd = sentence.end
    } else if (sentence.end - groupStart > MAX_CHUNK_CHARS) {
      flush()
      groupStart = sentence.start
      groupEnd = sentence.end
    } else {
      groupEnd = sentence.end
    }
    if (length > MAX_CHUNK_CHARS) flush()
  }
  flush()
  return groups.length > 0 ? groups : [piece]
}

function makeChunk(content: string, piece: Piece, idx: number): ChunkDraft {
  const text = content.slice(piece.start, piece.end)
  return {
    idx,
    startOff: piece.start,
    endOff: piece.end,
    text,
    roleTag: inferRoleTag(text),
    hash: hashText(text)
  }
}

/**
 * Chunky: paragraphs first, short neighbours merged up to 120 chars, scene
 * separators force a break, blocks capped around 800 chars at sentence ends.
 */
export function chunkChapter(content: string): ChunkDraft[] {
  const pieces = collectPieces(content)
  if (pieces.length === 0) return []

  const blocks: Piece[] = []
  let group: Piece[] = []
  let groupChars = 0

  const flush = (): void => {
    const first = group[0]
    const last = group[group.length - 1]
    if (first && last) {
      const start = first.start
      const end = last.end
      const text = content.slice(start, end)
      blocks.push({ start, end, text })
    }
    group = []
    groupChars = 0
  }

  for (const piece of pieces) {
    if (isSceneSeparator(piece.text)) {
      flush()
      blocks.push(piece)
      continue
    }

    if (piece.text.length > MAX_CHUNK_CHARS) {
      flush()
      blocks.push(...splitLongPiece(content, piece))
      continue
    }

    const wouldExceed = groupChars + piece.text.length + 2 > MAX_CHUNK_CHARS
    if (wouldExceed && group.length > 0) flush()

    const previous = group[group.length - 1]
    if (
      previous &&
      groupChars >= 60 &&
      Math.abs(quoteRatio(previous.text) - quoteRatio(piece.text)) > 0.3
    ) {
      flush()
    }

    group.push(piece)
    groupChars += piece.text.length + 2

    if (groupChars >= MIN_CHUNK_CHARS) flush()
  }
  flush()

  return blocks.map((block, idx) => makeChunk(content, block, idx + 1))
}

/** Joins chunk texts back into chapter prose. Used after a rewrite. */
export function joinChunks(texts: string[]): string {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}
