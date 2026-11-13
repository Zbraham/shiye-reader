import { newId } from '../ids'
import type { Bookmark, Chapter, Project } from '@shared/types'
import { AppError } from '../errors'
import { listBookmarks } from '../db/reading'
import { rowToChapter, rowToProject } from '../db/repo'
import type { DatabaseHandle } from '../db/sqlite'

type Row = Record<string, unknown>

function asRow(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {}
}

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

export interface SyncProject {
  project: Project
  chapters: Chapter[]
  bookmarks: Bookmark[]
}

export interface SyncSnapshot {
  version: 1
  exportedAt: number
  projects: SyncProject[]
  shelves: { name: string; projectIds: string[] }[]
  reading: { projectId: string; day: string; seconds: number; words: number }[]
}

export const SNAPSHOT_VERSION = 1
export const SNAPSHOT_MAX_BYTES = 96 * 1024 * 1024

export function buildSnapshot(db: DatabaseHandle): SyncSnapshot {
  const projectRows = db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all()
  const projects: SyncProject[] = projectRows.map((raw) => {
    const project = rowToProject(asRow(raw))
    const chapters = db
      .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY idx ASC')
      .all(project.id)
      .map((row) => rowToChapter(asRow(row)))
    return { project, chapters, bookmarks: listBookmarks(db, project.id) }
  })
  const shelves = db
    .prepare('SELECT * FROM shelves ORDER BY created_at ASC')
    .all()
    .map((raw) => {
      const row = asRow(raw)
      const shelfId = str(row, 'id')
      const projectIds = db
        .prepare('SELECT project_id FROM shelf_books WHERE shelf_id = ? ORDER BY added_at ASC')
        .all(shelfId)
        .map((link) => str(asRow(link), 'project_id'))
      return { name: str(row, 'name'), projectIds }
    })
  const reading = db
    .prepare('SELECT project_id, day, seconds, words FROM reading_log ORDER BY day ASC')
    .all()
    .map((raw) => {
      const row = asRow(raw)
      return {
        projectId: str(row, 'project_id'),
        day: str(row, 'day'),
        seconds: num(row, 'seconds'),
        words: num(row, 'words')
      }
    })
  return { version: SNAPSHOT_VERSION, exportedAt: Date.now(), projects, shelves, reading }
}

export function snapshotBytes(snapshot: SyncSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length
}

function insertProject(db: DatabaseHandle, project: Project): void {
  db.prepare(
    `INSERT OR REPLACE INTO projects (
      id, title, theme_prompt, genre, tone, pov, style_guide, style_sample,
      target_len_per_chapter, synopsis, selling_point, created_at, updated_at,
      last_chapter_idx, last_offset_ratio, buffer, chapter_min, chapter_max,
      source, imported_at, original_file, author, series, publisher, language,
      description, tags_json, rating, read_status, cover_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    project.id,
    project.title,
    project.themePrompt,
    project.genre,
    project.tone,
    project.pov,
    project.styleGuide,
    project.styleSample,
    project.targetLenPerChapter,
    project.synopsis,
    project.sellingPoint,
    project.createdAt,
    project.updatedAt,
    project.lastChapterIdx,
    project.lastOffsetRatio,
    project.buffer,
    project.chapterMin,
    project.chapterMax,
    project.source,
    project.importedAt,
    project.originalFile,
    project.author,
    project.series,
    project.publisher,
    project.language,
    project.description,
    JSON.stringify(project.tags),
    project.rating,
    project.readStatus,
    project.coverData
  )
}

function updateProjectContent(db: DatabaseHandle, project: Project): void {
  db.prepare(
    `UPDATE projects SET title = ?, theme_prompt = ?, genre = ?, tone = ?, pov = ?,
      style_guide = ?, style_sample = ?, target_len_per_chapter = ?, synopsis = ?,
      selling_point = ?, updated_at = ?, buffer = ?, chapter_min = ?, chapter_max = ?,
      source = ?, imported_at = ?, original_file = ?, author = ?, series = ?,
      publisher = ?, language = ?, description = ?, tags_json = ?, rating = ?,
      read_status = ?, cover_data = ?
     WHERE id = ?`
  ).run(
    project.title,
    project.themePrompt,
    project.genre,
    project.tone,
    project.pov,
    project.styleGuide,
    project.styleSample,
    project.targetLenPerChapter,
    project.synopsis,
    project.sellingPoint,
    project.updatedAt,
    project.buffer,
    project.chapterMin,
    project.chapterMax,
    project.source,
    project.importedAt,
    project.originalFile,
    project.author,
    project.series,
    project.publisher,
    project.language,
    project.description,
    JSON.stringify(project.tags),
    project.rating,
    project.readStatus,
    project.coverData,
    project.id
  )
}

/**
 * A snapshot can be captured while another device is mid-generation. Those
 * transient states must not survive the merge, or the chapter would look
 * "writing" forever on this device.
 */
function normalizeStatus(chapter: Chapter): Chapter['status'] {
  const status = chapter.status as string
  const hasContent = typeof chapter.content === 'string' && chapter.content.trim().length > 0
  if (status === 'generating') return 'draft'
  if (status === 'queued') return hasContent ? 'final' : 'outline'
  if (status === 'outline' || status === 'draft' || status === 'final' || status === 'stale') {
    return status
  }
  return hasContent ? 'final' : 'outline'
}

function upsertChapter(db: DatabaseHandle, chapter: Chapter): void {
  chapter = { ...chapter, status: normalizeStatus(chapter) }
  const existing = db
    .prepare('SELECT id FROM chapters WHERE project_id = ? AND idx = ?')
    .get(chapter.projectId, chapter.idx)
  if (existing) {
    db.prepare(
      `UPDATE chapters SET title = ?, status = ?, content = ?, html = ?, volume = ?, level = ?,
        word_count = ?, summary_l1 = ?, summary_l2 = ?, outline_json = ?, version = ?,
        generated_at = ?, stale_reason = ?, error = ?, issues_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      chapter.title,
      chapter.status,
      chapter.content,
      chapter.html,
      chapter.volume,
      chapter.level,
      chapter.wordCount,
      chapter.summaryL1,
      chapter.summaryL2,
      chapter.outline ? JSON.stringify(chapter.outline) : '',
      chapter.version,
      chapter.generatedAt,
      chapter.staleReason,
      chapter.error,
      JSON.stringify(chapter.issues),
      chapter.updatedAt,
      str(asRow(existing), 'id')
    )
    return
  }
  db.prepare(
    `INSERT INTO chapters (
      id, project_id, idx, title, status, content, html, volume, level, word_count,
      summary_l1, summary_l2, outline_json, version, generated_at, stale_reason,
      error, issues_json, updated_at, seed_prefix, last_offset_ratio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  ).run(
    chapter.id || newId(),
    chapter.projectId,
    chapter.idx,
    chapter.title,
    chapter.status,
    chapter.content,
    chapter.html,
    chapter.volume,
    chapter.level,
    chapter.wordCount,
    chapter.summaryL1,
    chapter.summaryL2,
    chapter.outline ? JSON.stringify(chapter.outline) : '',
    chapter.version,
    chapter.generatedAt,
    chapter.staleReason,
    chapter.error,
    JSON.stringify(chapter.issues),
    chapter.updatedAt,
    chapter.lastOffsetRatio
  )
}

function mergeBookmarks(
  db: DatabaseHandle,
  projectId: string,
  bookmarks: Bookmark[]
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO bookmarks (id, project_id, chapter_id, chapter_idx, ratio, label, excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const bookmark of bookmarks.slice(0, 2000)) {
    if (!bookmark || typeof bookmark !== 'object') continue
    const chapterIdx = Math.max(1, Math.floor(Number(bookmark.chapterIdx) || 1))
    const chapter = db
      .prepare('SELECT id FROM chapters WHERE project_id = ? AND idx = ?')
      .get(projectId, chapterIdx)
    const chapterId = chapter
      ? str(asRow(chapter), 'id')
      : typeof bookmark.chapterId === 'string'
        ? bookmark.chapterId
        : ''
    if (!chapterId) continue
    const label = typeof bookmark.label === 'string' ? bookmark.label : ''
    const excerpt = typeof bookmark.excerpt === 'string' ? bookmark.excerpt : ''
    const ratio = Number(bookmark.ratio)
    const createdAt = Number(bookmark.createdAt)
    insert.run(
      typeof bookmark.id === 'string' && bookmark.id ? bookmark.id : newId(),
      projectId,
      chapterId,
      chapterIdx,
      Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0,
      label.slice(0, 120),
      excerpt.slice(0, 300),
      Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now()
    )
  }
}

function isValidSnapshot(value: unknown): value is SyncSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SyncSnapshot>
  return (
    record.version === SNAPSHOT_VERSION &&
    Array.isArray(record.projects) &&
    Array.isArray(record.shelves) &&
    Array.isArray(record.reading)
  )
}

export function parseSnapshot(raw: string): SyncSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError('bad_sync_file', '云端备份不是有效的 JSON，已停止同步。')
  }
  if (!isValidSnapshot(parsed)) {
    throw new AppError('bad_sync_file', '云端备份的格式不认识，已停止同步。')
  }
  return parsed
}

export function mergeSnapshot(
  db: DatabaseHandle,
  remote: SyncSnapshot
): { pulled: number; pushed: number; skipped: number } {
  let pulled = 0
  let pushed = 0
  let skipped = 0

  db.transaction(() => {
    for (const item of remote.projects) {
      if (!item || !item.project || typeof item.project.id !== 'string') continue
      const localRow = db
        .prepare('SELECT id, updated_at, last_chapter_idx, last_offset_ratio FROM projects WHERE id = ?')
        .get(item.project.id)
      if (!localRow) {
        insertProject(db, item.project)
        for (const chapter of Array.isArray(item.chapters) ? item.chapters : []) {
          if (chapter && typeof chapter.idx === 'number') upsertChapter(db, chapter)
        }
        mergeBookmarks(db, item.project.id, Array.isArray(item.bookmarks) ? item.bookmarks : [])
        pulled += 1
        continue
      }
      const local = asRow(localRow)
      const localUpdated = num(local, 'updated_at')
      const remoteUpdated =
        typeof item.project.updatedAt === 'number' && Number.isFinite(item.project.updatedAt)
          ? item.project.updatedAt
          : 0
      if (remoteUpdated > localUpdated) {
        // Keep the local reading position; merge the authored content.
        updateProjectContent(db, item.project)
        db.prepare(
          'UPDATE projects SET last_chapter_idx = ?, last_offset_ratio = ? WHERE id = ?'
        ).run(
          Math.max(1, num(local, 'last_chapter_idx')),
          num(local, 'last_offset_ratio'),
          item.project.id
        )
        for (const chapter of Array.isArray(item.chapters) ? item.chapters : []) {
          if (chapter && typeof chapter.idx === 'number') upsertChapter(db, chapter)
        }
        pulled += 1
      } else if (remoteUpdated < localUpdated) {
        pushed += 1
      } else {
        skipped += 1
      }
      // Bookmarks are additive and keyed by id, so merge them no matter which
      // side wins on content. Losing a bookmark because the other device
      // edited a chapter would be silent data loss.
      mergeBookmarks(db, item.project.id, Array.isArray(item.bookmarks) ? item.bookmarks : [])
    }

    for (const shelf of remote.shelves) {
      if (!shelf || typeof shelf !== 'object') continue
      const name = (typeof shelf.name === 'string' ? shelf.name : '').trim().slice(0, 40)
      if (!name) continue
      let shelfRow = db.prepare('SELECT id FROM shelves WHERE name = ?').get(name)
      if (!shelfRow) {
        const id = newId()
        db.prepare('INSERT INTO shelves (id, name, created_at) VALUES (?, ?, ?)').run(
          id,
          name,
          Date.now()
        )
        shelfRow = { id }
      }
      const shelfId = str(asRow(shelfRow), 'id')
      const insert = db.prepare(
        'INSERT OR IGNORE INTO shelf_books (shelf_id, project_id, added_at) VALUES (?, ?, ?)'
      )
      const projectIds = Array.isArray(shelf.projectIds) ? shelf.projectIds : []
      for (const projectId of projectIds.slice(0, 2000)) {
        if (typeof projectId !== 'string' || !projectId) continue
        const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
        if (exists) insert.run(shelfId, projectId, Date.now())
      }
    }

    for (const entry of remote.reading) {
      if (!entry || typeof entry !== 'object') continue
      if (typeof entry.projectId !== 'string' || !entry.projectId) continue
      if (typeof entry.day !== 'string' || !entry.day) continue
      const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(entry.projectId)
      if (!exists) continue
      const row = db
        .prepare('SELECT id, seconds, words FROM reading_log WHERE project_id = ? AND day = ?')
        .get(entry.projectId, entry.day)
      const seconds = Math.max(0, Math.round(Number(entry.seconds) || 0))
      const words = Math.max(0, Math.round(Number(entry.words) || 0))
      if (row) {
        const record = asRow(row)
        db.prepare('UPDATE reading_log SET seconds = ?, words = ?, updated_at = ? WHERE id = ?').run(
          Math.max(num(record, 'seconds'), seconds),
          Math.max(num(record, 'words'), words),
          Date.now(),
          num(record, 'id')
        )
      } else {
        db.prepare(
          'INSERT INTO reading_log (project_id, day, seconds, words, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(entry.projectId, entry.day, seconds, words, Date.now())
      }
    }
  })

  return { pulled, pushed, skipped }
}
