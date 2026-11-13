import { newId } from '../ids'
import type {
  Bookmark,
  BookmarkInput,
  Project,
  ProjectMetadataPatch,
  ReadingStats,
  SearchHit,
  SearchInput,
  SearchResult,
  Shelf
} from '@shared/types'
import { AppError } from '../errors'
import { requireProject } from './repo'
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

/* ------------------------------------------------------------------ */
/* Full-text search                                                     */
/* ------------------------------------------------------------------ */

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`)
}

function snippetAround(content: string, query: string): { snippet: string; offset: number } {
  const lower = content.toLowerCase()
  const needle = query.toLowerCase()
  const index = lower.indexOf(needle)
  if (index < 0) {
    const clean = content.replace(/\s+/gu, ' ').trim()
    return { snippet: clean.slice(0, 120), offset: 0 }
  }
  const start = Math.max(0, index - 48)
  const end = Math.min(content.length, index + query.length + 72)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  return {
    snippet: `${prefix}${content.slice(start, end).replace(/\s+/gu, ' ').trim()}${suffix}`,
    offset: index
  }
}

function countOccurrences(content: string, query: string): number {
  const lower = content.toLowerCase()
  const needle = query.toLowerCase()
  if (!needle) return 0
  let count = 0
  let cursor = 0
  while (count < 20) {
    const index = lower.indexOf(needle, cursor)
    if (index < 0) break
    count += 1
    cursor = index + needle.length
  }
  return count
}

export function searchChapters(db: DatabaseHandle, input: SearchInput): SearchResult {
  const started = Date.now()
  const query = input.query.trim()
  const limit = Math.min(120, Math.max(1, input.limit ?? 60))
  if (!query) {
    return { hits: [], total: 0, tookMs: 0, truncated: false }
  }

  const clauses = [`c.content LIKE ? ESCAPE '\\'`]
  const params: unknown[] = [`%${escapeLike(query)}%`]
  if (input.projectId) {
    clauses.push('c.project_id = ?')
    params.push(input.projectId)
  }
  if (input.beforeIdx && input.beforeIdx > 0) {
    clauses.push('c.idx < ?')
    params.push(input.beforeIdx)
  }
  params.push(Math.min(600, limit * 8))

  const rows = db
    .prepare(
      `SELECT c.id, c.project_id, c.idx, c.title, c.content, p.title AS project_title
       FROM chapters c JOIN projects p ON p.id = c.project_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.project_id, c.idx
       LIMIT ?`
    )
    .all(...params)

  const hits: SearchHit[] = []
  let total = 0
  for (const raw of rows) {
    const row = asRow(raw)
    const content = str(row, 'content')
    const occurrences = countOccurrences(content, query)
    if (occurrences === 0) continue
    total += occurrences
    if (hits.length >= limit) continue
    const snippet = snippetAround(content, query)
    const title = str(row, 'title')
    const titleBoost = title.toLowerCase().includes(query.toLowerCase()) ? 6 : 0
    hits.push({
      projectId: str(row, 'project_id'),
      projectTitle: str(row, 'project_title'),
      chapterId: str(row, 'id'),
      chapterIdx: num(row, 'idx'),
      chapterTitle: title,
      snippet: snippet.snippet,
      matchOffset: snippet.offset,
      score: occurrences * 10 + titleBoost
    })
  }
  hits.sort((left, right) => right.score - left.score)
  return {
    hits,
    total,
    tookMs: Date.now() - started,
    truncated: total > hits.length
  }
}

/* ------------------------------------------------------------------ */
/* Bookmarks                                                            */
/* ------------------------------------------------------------------ */

function rowToBookmark(row: Row): Bookmark {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    chapterId: str(row, 'chapter_id'),
    chapterIdx: num(row, 'chapter_idx'),
    ratio: num(row, 'ratio'),
    label: str(row, 'label'),
    excerpt: str(row, 'excerpt'),
    createdAt: num(row, 'created_at')
  }
}

export function listBookmarks(db: DatabaseHandle, projectId: string): Bookmark[] {
  const rows = db
    .prepare(
      'SELECT * FROM bookmarks WHERE project_id = ? ORDER BY chapter_idx ASC, ratio ASC, created_at DESC'
    )
    .all(projectId)
  return rows.map((row) => rowToBookmark(asRow(row)))
}

export function addBookmark(db: DatabaseHandle, input: BookmarkInput): Bookmark {
  requireProject(db, input.projectId)
  const id = newId()
  db.prepare(
    `INSERT INTO bookmarks (id, project_id, chapter_id, chapter_idx, ratio, label, excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.chapterId,
    input.chapterIdx,
    Math.min(1, Math.max(0, input.ratio)),
    input.label.slice(0, 120),
    input.excerpt.slice(0, 300),
    Date.now()
  )
  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id)
  return rowToBookmark(asRow(row))
}

export function removeBookmark(db: DatabaseHandle, bookmarkId: string): void {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId)
}

/* ------------------------------------------------------------------ */
/* Reading statistics                                                   */
/* ------------------------------------------------------------------ */

function dayKey(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function recordReading(
  db: DatabaseHandle,
  projectId: string,
  seconds: number,
  words: number
): void {
  const safeSeconds = Math.min(3600, Math.max(1, Math.round(seconds)))
  const safeWords = Math.min(2_000_000, Math.max(0, Math.round(words)))
  const day = dayKey(new Date())
  const now = Date.now()
  const existing = db
    .prepare('SELECT id, seconds, words FROM reading_log WHERE project_id = ? AND day = ?')
    .get(projectId, day)
  if (existing) {
    const row = asRow(existing)
    db.prepare(
      'UPDATE reading_log SET seconds = ?, words = ?, updated_at = ? WHERE id = ?'
    ).run(num(row, 'seconds') + safeSeconds, num(row, 'words') + safeWords, now, num(row, 'id'))
    return
  }
  db.prepare(
    'INSERT INTO reading_log (project_id, day, seconds, words, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(projectId, day, safeSeconds, safeWords, now)
}

function addDays(base: Date, delta: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + delta)
  return next
}

export function readingStats(db: DatabaseHandle, projectId?: string | null): ReadingStats {
  const dayRows = projectId
    ? db
        .prepare(
          'SELECT day, SUM(seconds) AS seconds, SUM(words) AS words FROM reading_log WHERE project_id = ? GROUP BY day ORDER BY day ASC'
        )
        .all(projectId)
    : db
        .prepare(
          'SELECT day, SUM(seconds) AS seconds, SUM(words) AS words FROM reading_log GROUP BY day ORDER BY day ASC'
        )
        .all()
  const scoped = dayRows.map((raw) => {
    const row = asRow(raw)
    return { day: str(row, 'day'), seconds: num(row, 'seconds'), words: num(row, 'words') }
  })
  const today = dayKey(new Date())
  const byDay = new Map(scoped.map((entry) => [entry.day, entry]))
  const days: ReadingStats['days'] = []
  for (let offset = 29; offset >= 0; offset -= 1) {
    const key = dayKey(addDays(new Date(), -offset))
    const entry = byDay.get(key)
    days.push({ day: key, seconds: entry?.seconds ?? 0, words: entry?.words ?? 0 })
  }

  let totalSeconds = 0
  let totalWords = 0
  for (const entry of scoped) {
    totalSeconds += entry.seconds
    totalWords += entry.words
  }

  // Book scope also scopes "today" and the streak; otherwise a book the reader
  // never opened would show another book's time.
  const daySeconds = projectId
    ? db.prepare(
        'SELECT COALESCE(SUM(seconds),0) AS seconds FROM reading_log WHERE day = ? AND project_id = ?'
      )
    : db.prepare(
        'SELECT COALESCE(SUM(seconds),0) AS seconds FROM reading_log WHERE day = ?'
      )

  let streakDays = 0
  for (let offset = 0; offset < 400; offset += 1) {
    const key = dayKey(addDays(new Date(), -offset))
    const entry = projectId ? daySeconds.get(key, projectId) : daySeconds.get(key)
    const seconds = num(asRow(entry), 'seconds')
    if (seconds > 30) {
      streakDays += 1
    } else if (offset === 0) {
      // Today is not over yet; do not break the streak before any reading.
      continue
    } else {
      break
    }
  }

  const bookRows = projectId
    ? db
        .prepare(
          `SELECT l.project_id AS project_id, p.title AS title, SUM(l.seconds) AS seconds
           FROM reading_log l JOIN projects p ON p.id = l.project_id
           WHERE l.project_id = ? GROUP BY l.project_id ORDER BY seconds DESC LIMIT 12`
        )
        .all(projectId)
    : db
        .prepare(
          `SELECT l.project_id AS project_id, p.title AS title, SUM(l.seconds) AS seconds
           FROM reading_log l JOIN projects p ON p.id = l.project_id
           GROUP BY l.project_id ORDER BY seconds DESC LIMIT 12`
        )
        .all()
  const bookSeconds = bookRows.map((raw) => {
    const row = asRow(raw)
    return {
      projectId: str(row, 'project_id'),
      title: str(row, 'title'),
      seconds: num(row, 'seconds')
    }
  })

  const todayEntry = projectId ? daySeconds.get(today, projectId) : daySeconds.get(today)

  return {
    totalSeconds,
    todaySeconds: num(asRow(todayEntry), 'seconds'),
    streakDays,
    totalWords,
    days,
    bookSeconds
  }
}

/* ------------------------------------------------------------------ */
/* Shelves                                                              */
/* ------------------------------------------------------------------ */

function shelvesWithProjects(db: DatabaseHandle): Shelf[] {
  const rows = db.prepare('SELECT * FROM shelves ORDER BY created_at ASC').all()
  const links = db
    .prepare('SELECT shelf_id, project_id FROM shelf_books ORDER BY added_at ASC')
    .all()
  const map = new Map<string, string[]>()
  for (const raw of links) {
    const row = asRow(raw)
    const shelfId = str(row, 'shelf_id')
    const list = map.get(shelfId) ?? []
    list.push(str(row, 'project_id'))
    map.set(shelfId, list)
  }
  return rows.map((raw) => {
    const row = asRow(raw)
    const id = str(row, 'id')
    return {
      id,
      name: str(row, 'name'),
      createdAt: num(row, 'created_at'),
      projectIds: map.get(id) ?? []
    }
  })
}

export function listShelves(db: DatabaseHandle): Shelf[] {
  return shelvesWithProjects(db)
}

function requireShelf(db: DatabaseHandle, shelfId: string): Shelf {
  const shelf = shelvesWithProjects(db).find((item) => item.id === shelfId)
  if (!shelf) throw new AppError('not_found', '这个书架分组不存在。')
  return shelf
}

export function createShelf(db: DatabaseHandle, name: string): Shelf {
  const clean = name.trim()
  if (!clean) throw new AppError('invalid', '分组名称不能为空。')
  const existing = shelvesWithProjects(db).find((item) => item.name === clean)
  if (existing) return existing
  const id = newId()
  db.prepare('INSERT INTO shelves (id, name, created_at) VALUES (?, ?, ?)').run(
    id,
    clean,
    Date.now()
  )
  return requireShelf(db, id)
}

export function renameShelf(db: DatabaseHandle, shelfId: string, name: string): Shelf {
  requireShelf(db, shelfId)
  const clean = name.trim()
  if (!clean) throw new AppError('invalid', '分组名称不能为空。')
  db.prepare('UPDATE shelves SET name = ? WHERE id = ?').run(clean, shelfId)
  return requireShelf(db, shelfId)
}

export function deleteShelf(db: DatabaseHandle, shelfId: string): void {
  db.prepare('DELETE FROM shelf_books WHERE shelf_id = ?').run(shelfId)
  db.prepare('DELETE FROM shelves WHERE id = ?').run(shelfId)
}

export function addToShelf(db: DatabaseHandle, shelfId: string, projectIds: string[]): void {
  requireShelf(db, shelfId)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO shelf_books (shelf_id, project_id, added_at) VALUES (?, ?, ?)'
  )
  const now = Date.now()
  db.transaction(() => {
    for (const projectId of projectIds) {
      try {
        requireProject(db, projectId)
        insert.run(shelfId, projectId, now)
      } catch {
        // A book may have been deleted on another device.
      }
    }
  })
}

export function removeFromShelf(db: DatabaseHandle, shelfId: string, projectIds: string[]): void {
  const remove = db.prepare('DELETE FROM shelf_books WHERE shelf_id = ? AND project_id = ?')
  db.transaction(() => {
    for (const projectId of projectIds) remove.run(shelfId, projectId)
  })
}

/* ------------------------------------------------------------------ */
/* Library management                                                   */
/* ------------------------------------------------------------------ */

export function updateProjectMetadata(
  db: DatabaseHandle,
  projectId: string,
  patch: ProjectMetadataPatch
): Project {
  const project = requireProject(db, projectId)
  const tags = patch.tags ?? project.tags
  const cleanTags = tags
    .map((tag) => tag.trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 12)

  const assignments: string[] = []
  const params: unknown[] = []
  const setIf = (column: string, value: unknown): void => {
    assignments.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.title !== undefined) setIf('title', patch.title.trim() || project.title)
  if (patch.author !== undefined) setIf('author', patch.author.trim().slice(0, 80))
  if (patch.series !== undefined) setIf('series', patch.series.trim().slice(0, 80))
  if (patch.publisher !== undefined) setIf('publisher', patch.publisher.trim().slice(0, 80))
  if (patch.language !== undefined) setIf('language', patch.language.trim().slice(0, 30))
  if (patch.description !== undefined) {
    setIf('description', patch.description.trim().slice(0, 4000))
  }
  if (patch.tags !== undefined) setIf('tags_json', JSON.stringify(cleanTags))
  if (patch.rating !== undefined) {
    setIf('rating', Math.min(5, Math.max(0, Math.round(patch.rating))))
  }
  if (patch.readStatus !== undefined) setIf('read_status', patch.readStatus)
  if (patch.coverData !== undefined) setIf('cover_data', patch.coverData.slice(0, 400_000))
  if (assignments.length === 0) return project

  setIf('updated_at', Date.now())
  params.push(projectId)
  db.prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`).run(...params)
  return requireProject(db, projectId)
}

export function deleteProjects(db: DatabaseHandle, projectIds: string[]): void {
  const remove = db.prepare('DELETE FROM projects WHERE id = ?')
  db.transaction(() => {
    for (const projectId of projectIds) remove.run(projectId)
  })
}

function normalizeTitle(title: string): string {
  return title
    .trim()
    .replace(/^《(.*)》$/u, '$1')
    .replace(/[\s_·:：,，.。!！?？'"“”‘’()（）\[\]【】-]+/gu, '')
    .toLowerCase()
}

export function findDuplicateProjects(db: DatabaseHandle): Record<string, string[]> {
  const groups = new Map<string, string[]>()
  const rows = db.prepare('SELECT id, title FROM projects ORDER BY created_at ASC').all()
  for (const raw of rows) {
    const row = asRow(raw)
    const key = normalizeTitle(str(row, 'title'))
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(str(row, 'id'))
    groups.set(key, list)
  }
  const duplicates: Record<string, string[]> = {}
  for (const [key, ids] of groups) {
    if (ids.length > 1) duplicates[key] = ids
  }
  return duplicates
}

export function projectTags(db: DatabaseHandle, projectId: string): string[] {
  const row = db.prepare('SELECT tags_json FROM projects WHERE id = ?').get(projectId)
  return parseStringArray(str(asRow(row), 'tags_json'))
}
