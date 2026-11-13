import type {
  ChapterOutline,
  Chunk,
  ConsistencyIssue,
  RewriteAction,
  RewriteTarget,
  StorySkeleton
} from '@shared/types'
import { extractJson } from '@shared/text'
import type { ChapterSummary } from './types'
import { displayChunkId } from './prompts'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, limit)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeSkeleton(
  raw: unknown,
  fallbackTitle: string,
  genre: string
): StorySkeleton {
  const record = asRecord(raw)
  const titles = asStringArray(record.titles, 5)
  if (titles.length === 0) titles.push(fallbackTitle)
  while (titles.length < 3) titles.push(`${fallbackTitle}·${titles.length + 1}`)

  const charactersRaw = Array.isArray(record.characters) ? record.characters : []
  const characters = charactersRaw
    .map((item) => {
      const character = asRecord(item)
      return {
        name: asString(character.name),
        identity: asString(character.identity),
        desire: asString(character.desire),
        secret: asString(character.secret)
      }
    })
    .filter((character) => character.name.length > 0)
    .slice(0, 6)
  if (characters.length === 0) {
    characters.push({ name: '沈砚', identity: '记者', desire: '查清旧事', secret: '知情不报' })
  }

  const worlds = asStringArray(record.world, 6)
  if (worlds.length === 0) worlds.push(`${genre}故事，世界规则从人物处境中自然显露。`)

  const chaptersRaw = Array.isArray(record.chapters) ? record.chapters : []
  const chapters = chaptersRaw
    .map((item, index) => {
      const chapter = asRecord(item)
      return {
        title: asString(chapter.title, `第${index + 1}章`),
        goals: asStringArray(chapter.goals, 6),
        hook: asString(chapter.hook)
      }
    })
    .filter((chapter) => chapter.title.length > 0)
    .slice(0, 3)
  while (chapters.length < 3) {
    chapters.push({
      title: `第${chapters.length + 1}章`,
      goals: ['推进主线，并靠近核心秘密'],
      hook: '留下一个具体而紧迫的悬念。'
    })
  }

  return {
    titles,
    sellingPoint: asString(record.sellingPoint),
    synopsis: asString(record.synopsis),
    characters,
    world: worlds,
    chapters
  }
}

export function normalizeOutline(raw: unknown, fallbackTitle: string): ChapterOutline {
  const record = asRecord(raw)
  const goals = asStringArray(record.goals, 6)
  if (goals.length === 0) goals.push('推进主线，并承接上一章结尾')
  return {
    title: asString(record.title, fallbackTitle).slice(0, 40),
    goals,
    advance: asStringArray(record.advance, 6),
    forbidden: asStringArray(record.forbidden, 4),
    hook: asString(record.hook, '留下一个让读者想翻页的悬念。').slice(0, 120)
  }
}

export function normalizeSummary(raw: unknown): ChapterSummary {
  const record = asRecord(raw)
  return {
    who_did_what: asString(record.who_did_what).slice(0, 300),
    relationship_change: asString(record.relationship_change).slice(0, 160),
    new_info: asString(record.new_info).slice(0, 160),
    foreshadow_planted: asStringArray(record.foreshadow_planted, 5),
    foreshadow_paid: asStringArray(record.foreshadow_paid, 5),
    ending_hook: asString(record.ending_hook).slice(0, 80)
  }
}

export function normalizeBeats(raw: unknown): string[] {
  const record = asRecord(raw)
  const beats = asStringArray(record.beats, 3)
  return beats.length > 0 ? beats : []
}

const ACTIONS: RewriteAction[] = ['rewrite', 'delete', 'insert_after']

export function normalizeTargets(
  raw: unknown,
  chunks: Chunk[],
  chapterIdx: number,
  maxTargets: number
): { targets: RewriteTarget[]; globalNote: string } {
  const record = asRecord(raw)
  const globalNote = asString(record.global_note).slice(0, 200)
  const rawTargets = Array.isArray(record.targets) ? record.targets : []
  const byDisplay = new Map<string, Chunk>()
  const byId = new Map<string, Chunk>()
  for (const chunk of chunks) {
    byDisplay.set(displayChunkId(chapterIdx, chunk.idx), chunk)
    byId.set(chunk.id, chunk)
  }

  const targets: RewriteTarget[] = []
  const seen = new Set<string>()
  for (const item of rawTargets) {
    const target = asRecord(item)
    const rawId = asString(target.id)
    const chunk = byDisplay.get(rawId) ?? byId.get(rawId)
    if (!chunk || seen.has(chunk.id)) continue
    const actionRaw = asString(target.action, 'rewrite') as RewriteAction
    const action = ACTIONS.includes(actionRaw) ? actionRaw : 'rewrite'
    seen.add(chunk.id)
    targets.push({
      chunkId: chunk.id,
      displayId: displayChunkId(chapterIdx, chunk.idx),
      idx: chunk.idx,
      text: chunk.text,
      roleTag: chunk.roleTag,
      action,
      reason: asString(target.reason).slice(0, 160),
      hint: asString(target.hint).slice(0, 160)
    })
    if (targets.length >= maxTargets) break
  }
  return { targets, globalNote }
}

export function normalizeConfirmed(raw: unknown, chunks: Chunk[], chapterIdx: number): string[] {
  const record = asRecord(raw)
  const ids = asStringArray(record.confirmed, 20)
  const byDisplay = new Map<string, string>()
  const byId = new Set<string>()
  for (const chunk of chunks) {
    byDisplay.set(displayChunkId(chapterIdx, chunk.idx), chunk.id)
    byId.add(chunk.id)
  }
  const result: string[] = []
  for (const id of ids) {
    const chunkId = byDisplay.get(id) ?? (byId.has(id) ? id : null)
    if (chunkId && !result.includes(chunkId)) result.push(chunkId)
  }
  return result
}

const ISSUE_TYPES = ['name', 'timeline', 'ability', 'foreshadow', 'pov'] as const

export function normalizeIssues(raw: unknown): ConsistencyIssue[] {
  const record = asRecord(raw)
  const issues = Array.isArray(record.issues) ? record.issues : []
  return issues
    .map((item) => {
      const issue = asRecord(item)
      const typeRaw = asString(issue.type)
      const type = (ISSUE_TYPES as readonly string[]).includes(typeRaw)
        ? (typeRaw as ConsistencyIssue['type'])
        : 'name'
      return {
        type,
        detail: asString(issue.detail).slice(0, 240),
        chunkHint: asString(issue.chunk_hint).slice(0, 80)
      }
    })
    .filter((issue) => issue.detail.length > 0)
    .slice(0, 6)
}

export function parseJsonLoose<T = unknown>(raw: string): T {
  return extractJson<T>(raw)
}

export function cleanRewriteOutput(raw: string): string {
  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```[a-zA-Z]*\s*\n/, '')
    .replace(/\n```\s*$/, '')
    .trim()
  text = text.replace(
    /^(改写后(?:的)?(?:正文|段落)?|修改后(?:的)?(?:正文|段落)?)[：:]\s*/u,
    ''
  )
  text = text.replace(/^【[^】]{1,12}】\s*/u, '')
  if (
    (text.startsWith('“') && text.endsWith('”')) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    const inner = text.slice(1, -1)
    if (!inner.includes(text[0] ?? '')) text = inner
  }
  return text.trim()
}
