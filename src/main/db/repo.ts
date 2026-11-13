import { newId as randomUUID } from '../ids'
import type {
  AppSettings,
  Chapter,
  ChapterMeta,
  ChapterOutline,
  ChapterStatus,
  Character,
  CharacterState,
  ConsistencyIssue,
  CreateProjectInput,
  Directive,
  DirectiveScope,
  DirectiveStatus,
  ForeshadowItem,
  ImportBookInput,
  JobInfo,
  JobStatus,
  JobType,
  Project,
  ProjectBrief,
  RoleTag,
  StoryStateEntry,
  UsageSummary,
  VersionDetail,
  VersionDiff,
  VersionMeta
} from '@shared/types'
import {
  DEFAULT_SETTINGS,
  DIRECTIVE_RANGE,
  assertTransition
} from '@shared/constants'
import { countWords, hashText } from '@shared/text'
import { AppError } from '../errors'
import type { DatabaseHandle } from './sqlite'

type Row = Record<string, unknown>

function str(row: Row, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function num(row: Row, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNum(row: Row, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {}
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function parseState(raw: string): CharacterState {
  try {
    const parsed = JSON.parse(raw) as Partial<CharacterState>
    return {
      location: typeof parsed.location === 'string' ? parsed.location : '',
      condition: typeof parsed.condition === 'string' ? parsed.condition : '',
      intent: typeof parsed.intent === 'string' ? parsed.intent : ''
    }
  } catch {
    return { location: '', condition: '', intent: '' }
  }
}

function parseOutline(raw: string): ChapterOutline | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ChapterOutline>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      goals: Array.isArray(parsed.goals)
        ? parsed.goals.filter((item): item is string => typeof item === 'string')
        : [],
      advance: Array.isArray(parsed.advance)
        ? parsed.advance.filter((item): item is string => typeof item === 'string')
        : [],
      forbidden: Array.isArray(parsed.forbidden)
        ? parsed.forbidden.filter((item): item is string => typeof item === 'string')
        : [],
      hook: typeof parsed.hook === 'string' ? parsed.hook : ''
    }
  } catch {
    return null
  }
}

function parseIssues(raw: string): ConsistencyIssue[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const record = asRow(item)
        const type = str(record, 'type')
        const valid = ['name', 'timeline', 'ability', 'foreshadow', 'pov']
        return {
          type: (valid.includes(type) ? type : 'name') as ConsistencyIssue['type'],
          detail: str(record, 'detail'),
          chunkHint: str(record, 'chunkHint') || str(record, 'chunk_hint')
        }
      })
      .filter((issue) => issue.detail.length > 0)
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

export function rowToProject(row: Row): Project {
  return {
    id: str(row, 'id'),
    title: str(row, 'title'),
    themePrompt: str(row, 'theme_prompt'),
    genre: str(row, 'genre'),
    tone: str(row, 'tone'),
    pov: str(row, 'pov'),
    styleGuide: str(row, 'style_guide'),
    styleSample: str(row, 'style_sample'),
    targetLenPerChapter: num(row, 'target_len_per_chapter'),
    synopsis: str(row, 'synopsis'),
    sellingPoint: str(row, 'selling_point'),
    createdAt: num(row, 'created_at'),
    updatedAt: num(row, 'updated_at'),
    lastChapterIdx: Math.max(1, num(row, 'last_chapter_idx')),
    lastOffsetRatio: num(row, 'last_offset_ratio'),
    buffer: Math.min(3, Math.max(1, num(row, 'buffer') || 2)),
    chapterMin: num(row, 'chapter_min') || 1800,
    chapterMax: num(row, 'chapter_max') || 2600,
    source: str(row, 'source') === 'imported' ? 'imported' : 'generated',
    importedAt: nullableNum(row, 'imported_at'),
    originalFile: str(row, 'original_file'),
    author: str(row, 'author'),
    series: str(row, 'series'),
    publisher: str(row, 'publisher'),
    language: str(row, 'language'),
    description: str(row, 'description'),
    tags: parseStringArray(str(row, 'tags_json')),
    rating: Math.min(5, Math.max(0, num(row, 'rating'))),
    readStatus: parseReadStatus(str(row, 'read_status')),
    coverData: str(row, 'cover_data')
  }
}

export function parseReadStatus(raw: string): Project['readStatus'] {
  return raw === 'want' || raw === 'reading' || raw === 'done' || raw === 'dropped'
    ? raw
    : 'none'
}

export function rowToChapter(row: Row): Chapter {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    idx: num(row, 'idx'),
    title: str(row, 'title'),
    status: (str(row, 'status') || 'outline') as ChapterStatus,
    content: str(row, 'content'),
    html: str(row, 'html'),
    volume: str(row, 'volume'),
    level: Math.max(1, num(row, 'level') || 1),
    wordCount: num(row, 'word_count'),
    summaryL1: str(row, 'summary_l1'),
    summaryL2: str(row, 'summary_l2'),
    outline: parseOutline(str(row, 'outline_json')),
    version: num(row, 'version'),
    generatedAt: nullableNum(row, 'generated_at'),
    staleReason: str(row, 'stale_reason'),
    error: str(row, 'error'),
    issues: parseIssues(str(row, 'issues_json')),
    updatedAt: num(row, 'updated_at'),
    lastOffsetRatio: num(row, 'last_offset_ratio')
  }
}

export function rowToChapterMeta(row: Row): ChapterMeta {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    idx: num(row, 'idx'),
    title: str(row, 'title'),
    status: (str(row, 'status') || 'outline') as ChapterStatus,
    wordCount: num(row, 'word_count'),
    summaryL2: str(row, 'summary_l2'),
    version: num(row, 'version'),
    staleReason: str(row, 'stale_reason'),
    error: str(row, 'error'),
    updatedAt: num(row, 'updated_at'),
    volume: str(row, 'volume'),
    level: Math.max(1, num(row, 'level') || 1),
    lastOffsetRatio: num(row, 'last_offset_ratio')
  }
}

function rowToCharacter(row: Row): Character {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    name: str(row, 'name'),
    aliases: parseStringArray(str(row, 'aliases_json')),
    profile: str(row, 'profile'),
    state: parseState(str(row, 'state_json')),
    firstChapter: num(row, 'first_chapter') || 1
  }
}

function rowToDirective(row: Row): Directive {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    scope: str(row, 'scope') as DirectiveScope,
    content: str(row, 'content'),
    status: (str(row, 'status') || 'pending') as DirectiveStatus,
    createdAt: num(row, 'created_at'),
    appliedChapter: nullableNum(row, 'applied_chapter'),
    expiresChapter: nullableNum(row, 'expires_chapter'),
    startsChapter: nullableNum(row, 'starts_chapter'),
    origin: str(row, 'origin') === 'plot' ? 'plot' : 'user'
  }
}

function rowToVersionMeta(row: Row): VersionMeta {
  return {
    id: str(row, 'id'),
    chapterId: str(row, 'chapter_id'),
    seq: num(row, 'seq'),
    reason: str(row, 'reason'),
    createdAt: num(row, 'created_at'),
    beforeWordCount: num(row, 'before_word_count'),
    afterWordCount: num(row, 'after_word_count')
  }
}

function parseDiff(raw: string): VersionDiff | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as VersionDiff
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export function listProjects(db: DatabaseHandle): ProjectBrief[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.genre, p.source, p.last_chapter_idx, p.updated_at, p.created_at,
        p.last_offset_ratio, p.author, p.series, p.tags_json, p.rating, p.read_status, p.cover_data,
        (SELECT COUNT(*) FROM chapters c WHERE c.project_id = p.id) AS chapter_count,
        (SELECT COALESCE(SUM(c.word_count), 0) FROM chapters c WHERE c.project_id = p.id) AS word_count,
        (SELECT COUNT(*) FROM chapters c WHERE c.project_id = p.id AND c.status IN ('draft','generating')) AS partial,
        (SELECT COUNT(*) FROM chapters c WHERE c.project_id = p.id AND c.content <> '') AS content_count
       FROM projects p
       ORDER BY p.updated_at DESC`
    )
    .all()

  return rows.map((raw) => {
    const row = asRow(raw)
    const id = str(row, 'id')
    return {
      id,
      title: str(row, 'title'),
      genre: str(row, 'genre'),
      source: str(row, 'source') === 'imported' ? 'imported' : 'generated',
      chapterCount: num(row, 'chapter_count'),
      readChapter: Math.max(1, num(row, 'last_chapter_idx')),
      wordCount: num(row, 'word_count'),
      updatedAt: num(row, 'updated_at'),
      createdAt: num(row, 'created_at'),
      coverIndex: Number.parseInt(hashText(id).slice(0, 4), 16) % 5,
      hasPartial: num(row, 'partial') > 0,
      author: str(row, 'author'),
      series: str(row, 'series'),
      tags: parseStringArray(str(row, 'tags_json')),
      rating: Math.min(5, Math.max(0, num(row, 'rating'))),
      readStatus: parseReadStatus(str(row, 'read_status')),
      coverData: str(row, 'cover_data'),
      lastOffsetRatio: num(row, 'last_offset_ratio')
    }
  })
}

export function getProject(db: DatabaseHandle, projectId: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
  return row ? rowToProject(asRow(row)) : null
}

export function requireProject(db: DatabaseHandle, projectId: string): Project {
  const project = getProject(db, projectId)
  if (!project) throw new AppError('not_found', '这本书不存在或已被删除。')
  return project
}

export function createProject(
  db: DatabaseHandle,
  input: CreateProjectInput
): Project {
  const id = randomUUID()
  const now = Date.now()
  const chapterMin = Math.max(600, Math.round(input.targetLenPerChapter * 0.9))
  const chapterMax = Math.max(chapterMin + 120, Math.round(input.targetLenPerChapter * 1.3))

  db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (
        id, title, theme_prompt, genre, tone, pov, style_guide, style_sample,
        target_len_per_chapter, synopsis, selling_point, created_at, updated_at,
        last_chapter_idx, last_offset_ratio, buffer, chapter_min, chapter_max
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 2, ?, ?)`
    ).run(
      id,
      input.title,
      input.themePrompt,
      input.genre,
      input.tone,
      input.pov,
      input.styleGuide,
      input.styleSample,
      input.targetLenPerChapter,
      input.skeleton.synopsis,
      input.skeleton.sellingPoint,
      now,
      now,
      chapterMin,
      chapterMax
    )

    const insertCharacter = db.prepare(
      `INSERT INTO characters (id, project_id, name, aliases_json, profile, state_json, first_chapter)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    for (const character of input.skeleton.characters) {
      const profile = [character.identity, character.desire, character.secret]
        .filter(Boolean)
        .join('；')
      insertCharacter.run(
        randomUUID(),
        id,
        character.name,
        '[]',
        profile,
        JSON.stringify({ location: '', condition: '', intent: '' })
      )
    }

    const insertState = db.prepare(
      `INSERT INTO story_state (project_id, key, value, updated_at) VALUES (?, ?, ?, ?)`
    )
    insertState.run(id, '世界观', input.skeleton.world.join('\n'), now)
    insertState.run(id, '时间线', '', now)
    insertState.run(id, '地点', '', now)
    insertState.run(id, '伏笔', '[]', now)
    insertState.run(id, '禁忌', '', now)

    const insertChapter = db.prepare(
      `INSERT INTO chapters (
        id, project_id, idx, title, status, content, word_count,
        summary_l1, summary_l2, outline_json, version, generated_at,
        stale_reason, error, issues_json, updated_at
      ) VALUES (?, ?, ?, ?, 'outline', '', 0, '', '', ?, 0, NULL, '', '', '[]', ?)`
    )
    for (let index = 1; index <= 3; index += 1) {
      const planned = input.skeleton.chapters[index - 1]
      const title = planned?.title ?? `第${index}章`
      const outline: ChapterOutline = {
        title,
        goals: planned?.goals ?? [],
        advance: [],
        forbidden: [],
        hook: planned?.hook ?? ''
      }
      insertChapter.run(
        randomUUID(),
        id,
        index,
        title,
        JSON.stringify(outline),
        now
      )
    }
  })

  return requireProject(db, id)
}

function excerptSummary(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (clean.length <= 170) return clean
  return `${clean.slice(0, 80)}……${clean.slice(-80)}`
}

function medianWordCount(chapters: ImportBookInput['chapters']): number {
  const lengths = chapters
    .map((chapter) => countWords(chapter.content))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)
  if (lengths.length === 0) return 2000
  const middle = Math.floor(lengths.length / 2)
  const value =
    lengths.length % 2 === 0
      ? ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2
      : (lengths[middle] ?? 0)
  return Math.min(6000, Math.max(600, Math.round(value)))
}

export function createImportedProject(
  db: DatabaseHandle,
  input: ImportBookInput
): Project {
  if (input.chapters.length === 0 || input.chapters.length > 2000) {
    throw new AppError('invalid', '导入章节数需要在 1 到 2000 之间。')
  }
  const id = randomUUID()
  const now = Date.now()
  const targetLen = medianWordCount(input.chapters)
  const chapterMin = Math.max(400, Math.round(targetLen * 0.9))
  const chapterMax = Math.max(chapterMin + 120, Math.round(targetLen * 1.3))
  const styleSample =
    input.styleSample.trim() || input.chapters[0]?.content.slice(0, 1200) || ''

  db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (
        id, title, theme_prompt, genre, tone, pov, style_guide, style_sample,
        target_len_per_chapter, synopsis, selling_point, created_at, updated_at,
        last_chapter_idx, last_offset_ratio, buffer, chapter_min, chapter_max,
        source, imported_at, original_file, author, series, publisher, language,
        description, tags_json, rating, read_status, cover_data
      ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 1, 0, 2, ?, ?, 'imported', ?, ?,
        ?, ?, ?, ?, ?, ?, 0, 'reading', ?)`
    ).run(
      id,
      input.title,
      input.genre,
      input.tone,
      input.pov,
      input.styleGuide,
      styleSample,
      targetLen,
      input.description ?? '',
      now,
      now,
      chapterMin,
      chapterMax,
      now,
      input.sourceFile,
      input.author ?? '',
      input.series ?? '',
      input.publisher ?? '',
      input.language ?? '',
      input.description ?? '',
      JSON.stringify(input.tags ?? []),
      input.coverData ?? ''
    )

    const insertChapter = db.prepare(
      `INSERT INTO chapters (
        id, project_id, idx, title, status, content, html, volume, level, word_count,
        summary_l1, summary_l2, outline_json, version, generated_at,
        stale_reason, error, issues_json, updated_at, seed_prefix
      ) VALUES (?, ?, ?, ?, 'final', ?, ?, ?, ?, ?, '', ?, '', 1, NULL, '', '', '[]', ?, '')`
    )
    input.chapters.forEach((chapter, index) => {
      const idx = index + 1
      insertChapter.run(
        randomUUID(),
        id,
        idx,
        chapter.title.trim() || `第${idx}章`,
        chapter.content,
        chapter.html ?? '',
        chapter.volume ?? '',
        Math.max(1, chapter.level ?? 1),
        countWords(chapter.content),
        excerptSummary(chapter.content),
        now
      )
    })
  })

  return requireProject(db, id)
}

export function updateProject(
  db: DatabaseHandle,
  projectId: string,
  patch: {
    title?: string
    styleSample?: string
    styleGuide?: string
    buffer?: number
    chapterMin?: number
    chapterMax?: number
    author?: string
    series?: string
    publisher?: string
    language?: string
    description?: string
    tags?: string[]
    rating?: number
    readStatus?: Project['readStatus']
    coverData?: string
  }
): Project {
  const project = requireProject(db, projectId)
  db.prepare(
    `UPDATE projects SET title = ?, style_sample = ?, style_guide = ?,
      buffer = ?, chapter_min = ?, chapter_max = ?, author = ?, series = ?,
      publisher = ?, language = ?, description = ?, tags_json = ?, rating = ?,
      read_status = ?, cover_data = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.title ?? project.title,
    patch.styleSample ?? project.styleSample,
    patch.styleGuide ?? project.styleGuide,
    patch.buffer ?? project.buffer,
    patch.chapterMin ?? project.chapterMin,
    patch.chapterMax ?? project.chapterMax,
    patch.author ?? project.author,
    patch.series ?? project.series,
    patch.publisher ?? project.publisher,
    patch.language ?? project.language,
    patch.description ?? project.description,
    JSON.stringify(patch.tags ?? project.tags),
    Math.min(5, Math.max(0, patch.rating ?? project.rating)),
    patch.readStatus ?? project.readStatus,
    patch.coverData ?? project.coverData,
    Date.now(),
    projectId
  )
  return requireProject(db, projectId)
}

export function updateReadCursor(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number,
  ratio: number
): void {
  const safe = Math.min(1, Math.max(0, ratio))
  // Reading position is local state. Touching updated_at here would make a
  // device that merely scrolled look newer than one that actually edited the
  // book, and sync would overwrite newer content. Position is merged
  // separately and never decides the conflict.
  db.prepare(
    'UPDATE projects SET last_chapter_idx = ?, last_offset_ratio = ? WHERE id = ?'
  ).run(chapterIdx, safe, projectId)
  db.prepare(
    'UPDATE chapters SET last_offset_ratio = ? WHERE project_id = ? AND idx = ?'
  ).run(safe, projectId, chapterIdx)
}

/**
 * Move the book's "continue reading" pointer without claiming a position
 * inside the destination chapter. The chapter keeps its own saved ratio.
 */
export function setReadChapter(db: DatabaseHandle, projectId: string, chapterIdx: number): void {
  db.prepare('UPDATE projects SET last_chapter_idx = ?, last_offset_ratio = 0 WHERE id = ?').run(
    chapterIdx,
    projectId
  )
}

export function deleteProject(db: DatabaseHandle, projectId: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
}

export function touchProject(db: DatabaseHandle, projectId: string): void {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
}

export function projectWordCount(db: DatabaseHandle, projectId: string): number {
  const row = asRow(
    db
      .prepare('SELECT COALESCE(SUM(word_count), 0) AS total FROM chapters WHERE project_id = ?')
      .get(projectId)
  )
  return num(row, 'total')
}

/* ------------------------------------------------------------------ */
/* Chapters                                                            */
/* ------------------------------------------------------------------ */

export function listChapterMetas(db: DatabaseHandle, projectId: string): ChapterMeta[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, idx, title, status, word_count, summary_l2,
        version, stale_reason, error, updated_at, volume, level, last_offset_ratio
       FROM chapters WHERE project_id = ? ORDER BY idx ASC`
    )
    .all(projectId)
  return rows.map((row) => rowToChapterMeta(asRow(row)))
}

export function getChapterById(db: DatabaseHandle, chapterId: string): Chapter | null {
  const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId)
  return row ? rowToChapter(asRow(row)) : null
}

export function requireChapter(db: DatabaseHandle, chapterId: string): Chapter {
  const chapter = getChapterById(db, chapterId)
  if (!chapter) throw new AppError('not_found', '这一章不存在或已被删除。')
  return chapter
}

export function getChapterByIndex(
  db: DatabaseHandle,
  projectId: string,
  idx: number
): Chapter | null {
  const row = db
    .prepare('SELECT * FROM chapters WHERE project_id = ? AND idx = ?')
    .get(projectId, idx)
  return row ? rowToChapter(asRow(row)) : null
}

export function ensureChapterRange(db: DatabaseHandle, projectId: string, upto: number): void {
  requireProject(db, projectId)
  const limit = Math.min(2000, Math.max(1, Math.floor(upto)))
  const rows = db
    .prepare('SELECT idx FROM chapters WHERE project_id = ? ORDER BY idx ASC')
    .all(projectId)
  const existing = new Set(rows.map((row) => num(asRow(row), 'idx')))
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO chapters (
      id, project_id, idx, title, status, content, word_count,
      summary_l1, summary_l2, outline_json, version, generated_at,
      stale_reason, error, issues_json, updated_at
    ) VALUES (?, ?, ?, ?, 'outline', '', 0, '', '', '', 0, NULL, '', '', '[]', ?)`
  )
  db.transaction(() => {
    for (let index = 1; index <= limit; index += 1) {
      if (!existing.has(index)) {
        insert.run(randomUUID(), projectId, index, `第${index}章`, now)
      }
    }
  })
}

export function ensureChapter(
  db: DatabaseHandle,
  projectId: string,
  idx: number
): Chapter {
  ensureChapterRange(db, projectId, idx)
  const chapter = getChapterByIndex(db, projectId, idx)
  if (!chapter) throw new AppError('not_found', '无法创建章节。')
  return chapter
}

export function updateChapterStatus(
  db: DatabaseHandle,
  chapterId: string,
  next: ChapterStatus
): Chapter {
  const chapter = requireChapter(db, chapterId)
  assertTransition(chapter.status, next)
  const clearError = next === 'queued' || next === 'generating' || next === 'final'
  const clearStale = next === 'queued' || next === 'generating' || next === 'final'
  db.prepare(
    `UPDATE chapters SET status = ?, error = ?, stale_reason = ?, updated_at = ? WHERE id = ?`
  ).run(
    next,
    clearError ? '' : chapter.error,
    clearStale ? '' : chapter.staleReason,
    Date.now(),
    chapterId
  )
  return requireChapter(db, chapterId)
}

export function savePartial(
  db: DatabaseHandle,
  chapterId: string,
  content: string
): void {
  db.prepare(
    `UPDATE chapters SET content = ?, word_count = ?, html = '', updated_at = ? WHERE id = ?`
  ).run(content, countWords(content), Date.now(), chapterId)
}

export function finishChapter(
  db: DatabaseHandle,
  chapterId: string,
  content: string
): Chapter {
  const chapter = requireChapter(db, chapterId)
  assertTransition(chapter.status, 'final')
  const now = Date.now()
  db.prepare(
    `UPDATE chapters SET status = 'final', content = ?, word_count = ?, html = '', version = version + 1,
      generated_at = ?, error = '', stale_reason = '', updated_at = ? WHERE id = ?`
  ).run(content, countWords(content), now, now, chapterId)
  return requireChapter(db, chapterId)
}

export function failChapter(
  db: DatabaseHandle,
  chapterId: string,
  content: string,
  message: string
): Chapter {
  const chapter = requireChapter(db, chapterId)
  const next: ChapterStatus = chapter.status === 'generating' ? 'draft' : chapter.status
  if (next !== chapter.status) assertTransition(chapter.status, next)
  db.prepare(
    `UPDATE chapters SET status = ?, content = ?, word_count = ?, html = '', error = ?, version = version + 1, updated_at = ? WHERE id = ?`
  ).run(next, content, countWords(content), message, Date.now(), chapterId)
  return requireChapter(db, chapterId)
}

export function interruptChapter(
  db: DatabaseHandle,
  chapterId: string,
  content: string
): Chapter {
  const chapter = requireChapter(db, chapterId)
  if (chapter.status === 'generating') {
    assertTransition('generating', 'draft')
  }
  db.prepare(
    `UPDATE chapters SET status = 'draft', content = ?, word_count = ?, html = '', version = version + 1, updated_at = ? WHERE id = ?`
  ).run(content, countWords(content), Date.now(), chapterId)
  return requireChapter(db, chapterId)
}

export function updateChapterContent(
  db: DatabaseHandle,
  chapterId: string,
  content: string,
  nextStatus?: ChapterStatus
): Chapter {
  const chapter = requireChapter(db, chapterId)
  const next =
    nextStatus ??
    (chapter.status === 'stale' ? 'final' : chapter.status === 'final' ? 'final' : chapter.status)
  if (next !== chapter.status) assertTransition(chapter.status, next)
  db.prepare(
    `UPDATE chapters SET status = ?, content = ?, word_count = ?, html = '', version = version + 1,
      error = '', stale_reason = '', updated_at = ? WHERE id = ?`
  ).run(next, content, countWords(content), Date.now(), chapterId)
  return requireChapter(db, chapterId)
}

export function markChapterStale(
  db: DatabaseHandle,
  chapterId: string,
  reason: string
): void {
  const chapter = requireChapter(db, chapterId)
  if (chapter.status !== 'final' && chapter.status !== 'draft') return
  db.prepare(
    `UPDATE chapters SET status = 'stale', stale_reason = ?, updated_at = ? WHERE id = ?`
  ).run(reason, Date.now(), chapterId)
}

export function markSubsequentStale(
  db: DatabaseHandle,
  projectId: string,
  fromIdx: number,
  reason: string
): number[] {
  const rows = db
    .prepare(
      `SELECT id, idx FROM chapters WHERE project_id = ? AND idx > ? AND status IN ('final','draft')
       ORDER BY idx ASC`
    )
    .all(projectId, fromIdx)
  if (rows.length === 0) return []
  const update = db.prepare(
    `UPDATE chapters SET status = 'stale', stale_reason = ?, updated_at = ? WHERE id = ?`
  )
  const indices: number[] = []
  db.transaction(() => {
    for (const raw of rows) {
      const row = asRow(raw)
      update.run(reason, Date.now(), str(row, 'id'))
      indices.push(num(row, 'idx'))
    }
  })
  return indices
}

export function updateChapterOutline(
  db: DatabaseHandle,
  chapterId: string,
  outline: ChapterOutline
): Chapter {
  const chapter = requireChapter(db, chapterId)
  db.prepare(
    'UPDATE chapters SET outline_json = ?, title = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(outline), outline.title || chapter.title, Date.now(), chapterId)
  return requireChapter(db, chapterId)
}

export function clearChapterOutline(db: DatabaseHandle, chapterId: string): void {
  db.prepare("UPDATE chapters SET outline_json = '', updated_at = ? WHERE id = ?").run(
    Date.now(),
    chapterId
  )
}

export function getChapterSeed(db: DatabaseHandle, chapterId: string): string {
  const row = asRow(
    db.prepare('SELECT seed_prefix FROM chapters WHERE id = ?').get(chapterId)
  )
  return str(row, 'seed_prefix')
}

export function setChapterSeed(
  db: DatabaseHandle,
  chapterId: string,
  seed: string
): void {
  db.prepare('UPDATE chapters SET seed_prefix = ?, updated_at = ? WHERE id = ?').run(
    seed,
    Date.now(),
    chapterId
  )
}

export function clearChapterSeed(db: DatabaseHandle, chapterId: string): void {
  db.prepare("UPDATE chapters SET seed_prefix = '', updated_at = ? WHERE id = ?").run(
    Date.now(),
    chapterId
  )
}

export function updateChapterSummary(
  db: DatabaseHandle,
  chapterId: string,
  summaryL1: string,
  summaryL2: string
): void {
  db.prepare(
    'UPDATE chapters SET summary_l1 = ?, summary_l2 = ?, updated_at = ? WHERE id = ?'
  ).run(summaryL1, summaryL2, Date.now(), chapterId)
}

export function updateChapterIssues(
  db: DatabaseHandle,
  chapterId: string,
  issues: ConsistencyIssue[]
): void {
  db.prepare('UPDATE chapters SET issues_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(issues),
    Date.now(),
    chapterId
  )
}

/** Rolls back to a captured in-memory state after an aborted regeneration. */
export function restoreChapterSnapshot(
  db: DatabaseHandle,
  chapterId: string,
  content: string,
  status: ChapterStatus,
  error: string
): Chapter {
  db.prepare(
    `UPDATE chapters SET status = ?, content = ?, word_count = ?, html = '', error = ?, updated_at = ? WHERE id = ?`
  ).run(status, content, countWords(content), error, Date.now(), chapterId)
  return requireChapter(db, chapterId)
}

export function setChapterError(
  db: DatabaseHandle,
  chapterId: string,
  error: string
): void {
  db.prepare('UPDATE chapters SET error = ?, updated_at = ? WHERE id = ?').run(
    error,
    Date.now(),
    chapterId
  )
}

export function acceptStaleChapter(
  db: DatabaseHandle,
  chapterId: string
): Chapter {
  const chapter = requireChapter(db, chapterId)
  if (chapter.status !== 'stale') return chapter
  assertTransition('stale', 'final')
  db.prepare(
    "UPDATE chapters SET status = 'final', stale_reason = '', updated_at = ? WHERE id = ?"
  ).run(Date.now(), chapterId)
  return requireChapter(db, chapterId)
}

export function deleteChapterAndShift(
  db: DatabaseHandle,
  chapterId: string
): { projectId: string; removedIdx: number } {
  const chapter = requireChapter(db, chapterId)
  const project = requireProject(db, chapter.projectId)
  db.transaction(() => {
    db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId)
    const rows = db
      .prepare(
        'SELECT id, idx FROM chapters WHERE project_id = ? AND idx > ? ORDER BY idx ASC'
      )
      .all(chapter.projectId, chapter.idx)
    const update = db.prepare('UPDATE chapters SET idx = ? WHERE id = ?')
    for (const raw of rows) {
      const row = asRow(raw)
      update.run(num(row, 'idx') - 1, str(row, 'id'))
    }
    const nextCursor =
      project.lastChapterIdx >= chapter.idx
        ? Math.max(1, project.lastChapterIdx - 1)
        : project.lastChapterIdx
    db.prepare('UPDATE projects SET last_chapter_idx = ?, updated_at = ? WHERE id = ?').run(
      nextCursor,
      Date.now(),
      chapter.projectId
    )
  })
  return { projectId: chapter.projectId, removedIdx: chapter.idx }
}

export function getPriorChapters(
  db: DatabaseHandle,
  projectId: string,
  beforeIdx: number,
  fullRecent = 8
): Chapter[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, idx, title, status, word_count,
        summary_l1, summary_l2, outline_json, version, generated_at,
        stale_reason, error, issues_json, updated_at, seed_prefix
       FROM chapters
       WHERE project_id = ? AND idx < ?
         AND (content <> '' OR summary_l1 <> '' OR summary_l2 <> '')
       ORDER BY idx ASC`
    )
    .all(projectId, beforeIdx)
  const chapters = rows.map((row) => rowToChapter(asRow(row)))
  const recent = db
    .prepare(
      `SELECT id, content FROM chapters
       WHERE project_id = ? AND idx < ? AND content <> ''
       ORDER BY idx DESC LIMIT ?`
    )
    .all(projectId, beforeIdx, Math.max(0, Math.floor(fullRecent)))
  const byId = new Map(
    recent.map((raw) => {
      const row = asRow(raw)
      return [str(row, 'id'), str(row, 'content')] as const
    })
  )
  for (const chapter of chapters) {
    chapter.content = byId.get(chapter.id) ?? ''
  }
  return chapters
}

export function lastChapterIdxOf(db: DatabaseHandle, projectId: string): number {
  const row = asRow(
    db
      .prepare('SELECT COALESCE(MAX(idx), 0) AS max_idx FROM chapters WHERE project_id = ?')
      .get(projectId)
  )
  return num(row, 'max_idx')
}

export function chapterContents(
  db: DatabaseHandle,
  projectId: string
): { idx: number; title: string; content: string }[] {
  const rows = db
    .prepare(
      'SELECT idx, title, content FROM chapters WHERE project_id = ? ORDER BY idx ASC'
    )
    .all(projectId)
  return rows.map((raw) => {
    const row = asRow(raw)
    return { idx: num(row, 'idx'), title: str(row, 'title'), content: str(row, 'content') }
  })
}

/* ------------------------------------------------------------------ */
/* Chunks                                                              */
/* ------------------------------------------------------------------ */

export interface ChunkInsert {
  idx: number
  startOff: number
  endOff: number
  text: string
  roleTag: RoleTag
  hash: string
}

export function replaceChunks(
  db: DatabaseHandle,
  chapter: Chapter,
  chunks: ChunkInsert[]
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE chapter_id = ?').run(chapter.id)
    const insert = db.prepare(
      `INSERT INTO chunks (id, chapter_id, idx, start_off, end_off, text, role_tag, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const chunk of chunks) {
      insert.run(
        `${chapter.id}:${String(chunk.idx).padStart(3, '0')}:${chunk.hash}`,
        chapter.id,
        chunk.idx,
        chunk.startOff,
        chunk.endOff,
        chunk.text,
        chunk.roleTag,
        chunk.hash
      )
    }
  })
}

export function listChunks(
  db: DatabaseHandle,
  chapterId: string
): import('@shared/types').Chunk[] {
  const rows = db
    .prepare('SELECT * FROM chunks WHERE chapter_id = ? ORDER BY idx ASC')
    .all(chapterId)
  return rows.map((raw) => {
    const row = asRow(raw)
    return {
      id: str(row, 'id'),
      chapterId: str(row, 'chapter_id'),
      idx: num(row, 'idx'),
      startOff: num(row, 'start_off'),
      endOff: num(row, 'end_off'),
      text: str(row, 'text'),
      roleTag: str(row, 'role_tag') as RoleTag,
      hash: str(row, 'hash')
    }
  })
}

export function updateChunkRole(
  db: DatabaseHandle,
  chunkId: string,
  roleTag: RoleTag
): void {
  db.prepare('UPDATE chunks SET role_tag = ? WHERE id = ?').run(roleTag, chunkId)
}

export function getChunk(db: DatabaseHandle, chunkId: string): import('@shared/types').Chunk | null {
  const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(chunkId)
  if (!row) return null
  const data = asRow(row)
  return {
    id: str(data, 'id'),
    chapterId: str(data, 'chapter_id'),
    idx: num(data, 'idx'),
    startOff: num(data, 'start_off'),
    endOff: num(data, 'end_off'),
    text: str(data, 'text'),
    roleTag: str(data, 'role_tag') as RoleTag,
    hash: str(data, 'hash')
  }
}

/* ------------------------------------------------------------------ */
/* Characters and story state                                          */
/* ------------------------------------------------------------------ */

export function listCharacters(db: DatabaseHandle, projectId: string): Character[] {
  const rows = db
    .prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY first_chapter ASC, rowid ASC')
    .all(projectId)
  return rows.map((row) => rowToCharacter(asRow(row)))
}

export function listStoryState(
  db: DatabaseHandle,
  projectId: string
): StoryStateEntry[] {
  const rows = db
    .prepare('SELECT key, value FROM story_state WHERE project_id = ? ORDER BY key ASC')
    .all(projectId)
  return rows.map((raw) => {
    const row = asRow(raw)
    return { key: str(row, 'key'), value: str(row, 'value') }
  })
}

export function getStoryValue(
  db: DatabaseHandle,
  projectId: string,
  key: string
): string {
  const row = asRow(
    db
      .prepare('SELECT value FROM story_state WHERE project_id = ? AND key = ?')
      .get(projectId, key)
  )
  return str(row, 'value')
}

export function setStoryValue(
  db: DatabaseHandle,
  projectId: string,
  key: string,
  value: string
): void {
  db.prepare(
    `INSERT INTO story_state (project_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(projectId, key, value, Date.now())
}

export function getForeshadow(db: DatabaseHandle, projectId: string): ForeshadowItem[] {
  const raw = getStoryValue(db, projectId, '伏笔')
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const record = asRow(item)
        return {
          id: str(record, 'id') || randomUUID(),
          text: str(record, 'text'),
          chapter: num(record, 'chapter')
        }
      })
      .filter((item) => item.text.length > 0)
  } catch {
    return []
  }
}

export function saveForeshadow(
  db: DatabaseHandle,
  projectId: string,
  items: ForeshadowItem[]
): void {
  setStoryValue(db, projectId, '伏笔', JSON.stringify(items.slice(-30)))
}

export function addForeshadow(
  db: DatabaseHandle,
  projectId: string,
  text: string,
  chapter: number
): void {
  const clean = text.trim()
  if (!clean) return
  const items = getForeshadow(db, projectId)
  if (items.some((item) => item.text.includes(clean) || clean.includes(item.text))) {
    return
  }
  items.push({ id: randomUUID(), text: clean.slice(0, 80), chapter })
  saveForeshadow(db, projectId, items)
}

export function resolveForeshadow(
  db: DatabaseHandle,
  projectId: string,
  text: string
): void {
  const clean = text.trim()
  if (!clean) return
  const items = getForeshadow(db, projectId)
  const next = items.filter(
    (item) => !(item.text.includes(clean) || clean.includes(item.text))
  )
  if (next.length !== items.length) saveForeshadow(db, projectId, next)
}

export function addNewFact(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number,
  key: string,
  value: string
): void {
  const cleanKey = key.trim().slice(0, 20)
  const cleanValue = value.trim().slice(0, 200)
  if (!cleanKey || !cleanValue) return
  if (cleanKey.includes('伏笔')) {
    addForeshadow(db, projectId, cleanValue, chapterIdx)
    return
  }
  if (cleanKey === '地点') {
    const current = getStoryValue(db, projectId, '地点')
    const lines = current
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.includes(cleanValue)) {
      lines.push(cleanValue)
      setStoryValue(db, projectId, '地点', lines.slice(-24).join('\n'))
    }
    return
  }
  const current = getStoryValue(db, projectId, cleanKey)
  const lines = current
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const entry = `${cleanValue}（第${chapterIdx}章）`
  if (!lines.includes(entry) && !lines.includes(cleanValue)) {
    lines.push(entry)
    setStoryValue(db, projectId, cleanKey, lines.slice(-20).join('\n'))
  }
}

export function appendTimeline(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number,
  text: string
): void {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return
  const entry = `第${chapterIdx}章：${clean.slice(0, 90)}`
  const current = getStoryValue(db, projectId, '时间线')
  const lines = current
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  lines.push(entry)
  setStoryValue(db, projectId, '时间线', lines.slice(-12).join('\n'))
}

/* ------------------------------------------------------------------ */
/* Directives                                                          */
/* ------------------------------------------------------------------ */

export function listDirectives(db: DatabaseHandle, projectId: string): Directive[] {
  const rows = db
    .prepare('SELECT * FROM directives WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId)
  return rows.map((row) => rowToDirective(asRow(row)))
}

export function activeDirectives(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number
): Directive[] {
  const rows = db
    .prepare(
      `SELECT * FROM directives
       WHERE project_id = ? AND status IN ('pending','applied')
         AND (expires_chapter IS NULL OR expires_chapter >= ?)
         AND (starts_chapter IS NULL OR starts_chapter <= ?)
       ORDER BY created_at ASC`
    )
    .all(projectId, chapterIdx, chapterIdx)
  return rows.map((row) => rowToDirective(asRow(row)))
}

export function createDirective(
  db: DatabaseHandle,
  projectId: string,
  scope: DirectiveScope,
  content: string,
  targetChapter: number,
  options: {
    startChapter?: number
    expiresChapter?: number | null
    origin?: 'user' | 'plot'
  } = {}
): Directive {
  requireProject(db, projectId)
  const range = DIRECTIVE_RANGE[scope]
  const starts = options.startChapter ?? targetChapter
  const expires =
    options.expiresChapter !== undefined
      ? options.expiresChapter
      : range < 0
        ? null
        : targetChapter + range
  const id = randomUUID()
  db.prepare(
    `INSERT INTO directives (
      id, project_id, scope, content, status, created_at, applied_chapter,
      expires_chapter, starts_chapter, origin
    ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?)`
  ).run(
    id,
    projectId,
    scope,
    content.trim(),
    Date.now(),
    expires,
    starts,
    options.origin ?? 'user'
  )
  const row = asRow(db.prepare('SELECT * FROM directives WHERE id = ?').get(id))
  return rowToDirective(row)
}

export function deactivateDirective(
  db: DatabaseHandle,
  projectId: string,
  directiveId: string
): void {
  db.prepare(
    "UPDATE directives SET status = 'expired' WHERE id = ? AND project_id = ?"
  ).run(directiveId, projectId)
}

export function deactivatePlotDirectives(db: DatabaseHandle, projectId: string): void {
  db.prepare(
    "UPDATE directives SET status = 'expired' WHERE project_id = ? AND origin = 'plot' AND status IN ('pending','applied')"
  ).run(projectId)
}

export function markDirectivesApplied(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number
): void {
  db.prepare(
    `UPDATE directives SET status = 'applied', applied_chapter = ?
     WHERE project_id = ? AND status = 'pending'
       AND (expires_chapter IS NULL OR expires_chapter >= ?)
       AND (starts_chapter IS NULL OR starts_chapter <= ?)`
  ).run(chapterIdx, projectId, chapterIdx, chapterIdx)
}

export function expireDirectives(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number
): void {
  db.prepare(
    `UPDATE directives SET status = 'expired'
     WHERE project_id = ? AND status != 'expired'
       AND expires_chapter IS NOT NULL AND expires_chapter < ?`
  ).run(projectId, chapterIdx)
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

export function createVersion(
  db: DatabaseHandle,
  chapterId: string,
  content: string,
  diff: VersionDiff | null,
  reason: string,
  beforeWordCount: number,
  afterWordCount: number
): VersionMeta {
  const row = asRow(
    db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM versions WHERE chapter_id = ?')
      .get(chapterId)
  )
  const seq = num(row, 'max_seq') + 1
  const id = randomUUID()
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO versions (id, chapter_id, seq, content, diff_json, reason, created_at, before_word_count, after_word_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    chapterId,
    seq,
    content,
    diff ? JSON.stringify(diff) : '',
    reason,
    createdAt,
    beforeWordCount,
    afterWordCount
  )
  return {
    id,
    chapterId,
    seq,
    reason,
    createdAt,
    beforeWordCount,
    afterWordCount
  }
}

export function listVersions(db: DatabaseHandle, chapterId: string): VersionMeta[] {
  const rows = db
    .prepare('SELECT * FROM versions WHERE chapter_id = ? ORDER BY seq DESC')
    .all(chapterId)
  return rows.map((row) => rowToVersionMeta(asRow(row)))
}

export function getVersion(db: DatabaseHandle, versionId: string): VersionDetail | null {
  const raw = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId)
  if (!raw) return null
  const row = asRow(raw)
  return {
    ...rowToVersionMeta(row),
    content: str(row, 'content'),
    diff: parseDiff(str(row, 'diff_json'))
  }
}

export function pruneVersions(db: DatabaseHandle, chapterId: string, keep = 40): void {
  db.prepare(
    `DELETE FROM versions WHERE chapter_id = ? AND id NOT IN (
      SELECT id FROM versions WHERE chapter_id = ? ORDER BY seq DESC LIMIT ?
    )`
  ).run(chapterId, chapterId, keep)
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export function createJob(
  db: DatabaseHandle,
  type: JobType,
  projectId: string,
  chapterId: string | null,
  label: string
): JobInfo {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO jobs (id, type, project_id, chapter_id, payload_json, status, progress, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, '', ?, ?)`
  ).run(id, type, projectId, chapterId, JSON.stringify({ label }), now, now)
  return {
    id,
    type,
    chapterId,
    projectId,
    label,
    status: 'queued',
    progress: 0,
    error: '',
    createdAt: now
  }
}

export function updateJobStatus(
  db: DatabaseHandle,
  jobId: string,
  status: JobStatus,
  progress = 0,
  error = ''
): void {
  db.prepare(
    'UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?'
  ).run(status, progress, error, Date.now(), jobId)
}

export function pruneJobs(db: DatabaseHandle): void {
  db.prepare(
    `DELETE FROM jobs WHERE status IN ('done','error','cancelled') AND created_at < ?`
  ).run(Date.now() - 7 * 24 * 60 * 60 * 1000)
}

/* ------------------------------------------------------------------ */
/* Settings and usage                                                  */
/* ------------------------------------------------------------------ */

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]

export function loadSettings(db: DatabaseHandle): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all()
  const settings: AppSettings = { ...DEFAULT_SETTINGS }
  for (const raw of rows) {
    const row = asRow(raw)
    const key = str(row, 'key') as keyof AppSettings
    if (!SETTING_KEYS.includes(key)) continue
    try {
      const value = JSON.parse(str(row, 'value')) as unknown
      ;(settings as unknown as Record<string, unknown>)[key] = value
    } catch {
      // Ignore malformed values and fall back to defaults.
    }
  }
  return settings
}

export function saveSettings(
  db: DatabaseHandle,
  patch: Partial<AppSettings>
): AppSettings {
  const insert = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!SETTING_KEYS.includes(key as keyof AppSettings)) continue
      if (value === undefined) continue
      insert.run(key, JSON.stringify(value))
    }
  })
  return loadSettings(db)
}

export function recordUsage(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number,
  task: string,
  promptTokens: number,
  completionTokens: number
): void {
  db.prepare(
    `INSERT INTO usage_log (project_id, chapter_idx, task, prompt_tokens, completion_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(projectId, chapterIdx, task, promptTokens, completionTokens, Date.now())
}

export function usageSummary(db: DatabaseHandle): UsageSummary {
  const row = asRow(
    db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END), 0) AS recent
         FROM usage_log`
      )
      .get(Date.now() - 30 * 24 * 60 * 60 * 1000)
  )
  return {
    requests: num(row, 'requests'),
    promptTokens: num(row, 'prompt_tokens'),
    completionTokens: num(row, 'completion_tokens'),
    last30DaysRequests: num(row, 'recent')
  }
}

export function hasUnfinishedChapters(db: DatabaseHandle): boolean {
  const row = asRow(
    db
      .prepare("SELECT COUNT(*) AS total FROM chapters WHERE status IN ('generating','queued')")
      .get()
  )
  return num(row, 'total') > 0
}

export function recoverInterruptedChapters(db: DatabaseHandle): number {
  const now = Date.now()
  const generating = asRow(
    db.prepare("SELECT COUNT(*) AS total FROM chapters WHERE status = 'generating'").get()
  )
  const total = num(generating, 'total')
  db.prepare(
    "UPDATE chapters SET status = 'draft', seed_prefix = '', updated_at = ? WHERE status = 'generating'"
  ).run(now)
  db.prepare(
    `UPDATE chapters SET status = CASE WHEN content <> '' THEN 'final' ELSE 'outline' END,
      seed_prefix = '', updated_at = ?
     WHERE status = 'queued'`
  ).run(now)
  return total
}

export function findChapterContainingHint(
  db: DatabaseHandle,
  chapterId: string,
  hint: string
): string {
  const chunks = listChunks(db, chapterId)
  const clean = hint.trim()
  if (!clean) return ''
  const found = chunks.find((chunk) => chunk.text.includes(clean))
  return found?.id ?? ''
}
