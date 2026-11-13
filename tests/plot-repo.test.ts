import { afterEach, describe, expect, it } from 'vitest'
import type { ImportBookInput } from '@shared/types'
import { migrate } from '@main/db/schema'
import {
  activeDirectives,
  createDirective,
  createImportedProject,
  deactivatePlotDirectives,
  getChapterById,
  getChapterByIndex,
  getChapterSeed,
  getPriorChapters,
  lastChapterIdxOf,
  listChapterMetas,
  recoverInterruptedChapters,
  setChapterSeed
} from '@main/db/repo'
import { openDatabase, type DatabaseHandle } from '@main/db/sqlite'

const open: DatabaseHandle[] = []

function freshDb(): DatabaseHandle {
  const db = openDatabase(':memory:')
  migrate(db)
  open.push(db)
  return db
}

function makeInput(count = 10): ImportBookInput {
  const chapters = Array.from({ length: count }, (_, index) => {
    const idx = index + 1
    return {
      title: `第${idx}章 雨`,
      content: `这是第 ${idx} 章。${'雨落在瓦上，她把信纸摊平。'.repeat(20)}`
    }
  })
  return {
    title: '雨夜来信',
    genre: '导入',
    tone: '沿用原文',
    pov: '沿用原文',
    styleSample: chapters[0]?.content.slice(0, 100) ?? '',
    styleGuide: '严格延续原文',
    targetLenPerChapter: 2000,
    sourceFile: '雨夜来信.txt',
    chapters
  }
}

afterEach(() => {
  while (open.length > 0) {
    open.pop()?.close()
  }
})

describe('imported projects in the repository', () => {
  it('writes final, readable chapters without AI metadata', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput())
    expect(project.source).toBe('imported')
    expect(project.originalFile).toBe('雨夜来信.txt')
    expect(project.importedAt).toBeGreaterThan(0)

    const metas = listChapterMetas(db, project.id)
    expect(metas).toHaveLength(10)
    expect(metas.every((meta) => meta.status === 'final')).toBe(true)
    expect(metas.every((meta) => meta.wordCount > 0)).toBe(true)
    expect(lastChapterIdxOf(db, project.id)).toBe(10)

    const first = getChapterByIndex(db, project.id, 1)
    expect(first?.content).toContain('这是第 1 章')
    expect(first?.summaryL2).toContain('……')
    expect(first?.summaryL1).toBe('')
    expect(first?.generatedAt).toBeNull()
  })

  it('does not load chapter bodies into the table of contents', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput())
    const metas = listChapterMetas(db, project.id)
    expect(Object.prototype.hasOwnProperty.call(metas[0], 'content')).toBe(false)
  })

  it('loads only recent chapter bodies as prior context', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput())
    const prior = getPriorChapters(db, project.id, 11, 3)
    expect(prior).toHaveLength(10)
    expect(prior[0]?.content).toBe('')
    expect(prior[6]?.content).toBe('')
    expect(prior[7]?.content).toContain('第 8 章')
    expect(prior[9]?.content).toContain('第 10 章')
    expect(prior[0]?.summaryL2.length).toBeGreaterThan(0)
  })
})

describe('directive scopes', () => {
  it('starts a directive on its own chapter', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput())
    createDirective(db, project.id, '本章', '停在雨里', 5)
    expect(activeDirectives(db, project.id, 4)).toHaveLength(0)
    expect(activeDirectives(db, project.id, 5)).toHaveLength(1)
    expect(activeDirectives(db, project.id, 6)).toHaveLength(0)
    expect(activeDirectives(db, project.id, 7)).toHaveLength(0)
  })

  it('honours explicit plot starts/expiry and clears only plot directives', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput())
    createDirective(db, project.id, '本章', '用户方向', 2)
    createDirective(db, project.id, '后续3章', '改后续方向', 7, {
      startChapter: 7,
      expiresChapter: 9,
      origin: 'plot'
    })
    expect(activeDirectives(db, project.id, 6)).toHaveLength(0)
    expect(activeDirectives(db, project.id, 7)).toHaveLength(1)
    expect(activeDirectives(db, project.id, 10)).toHaveLength(0)

    deactivatePlotDirectives(db, project.id)
    const remaining = activeDirectives(db, project.id, 7)
    expect(remaining).toHaveLength(0)
    expect(activeDirectives(db, project.id, 2)).toHaveLength(1)
  })
})

describe('crash recovery', () => {
  it('restores queued chapters by whether they have text', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput(4))
    const [first, second, third] = listChapterMetas(db, project.id)

    db.prepare(
      "UPDATE chapters SET status = 'queued', seed_prefix = '保留' WHERE id = ?"
    ).run(first?.id)
    db.prepare(
      "UPDATE chapters SET status = 'queued', content = '', word_count = 0 WHERE id = ?"
    ).run(second?.id)
    db.prepare(
      "UPDATE chapters SET status = 'generating', seed_prefix = '保留' WHERE id = ?"
    ).run(third?.id)

    const recovered = recoverInterruptedChapters(db)
    expect(recovered).toBe(1)

    const metas = listChapterMetas(db, project.id)
    expect(metas[0]?.status).toBe('final')
    expect(metas[1]?.status).toBe('outline')
    expect(metas[2]?.status).toBe('draft')
    expect(first ? getChapterSeed(db, first.id) : '').toBe('')
    expect(third ? getChapterSeed(db, third.id) : '').toBe('')
  })

  it('stores and clears a paragraph seed', () => {
    const db = freshDb()
    const project = createImportedProject(db, makeInput(2))
    const chapter = getChapterByIndex(db, project.id, 1)
    expect(chapter).not.toBeNull()
    if (!chapter) return
    setChapterSeed(db, chapter.id, '保留的开头')
    expect(getChapterSeed(db, chapter.id)).toBe('保留的开头')
    db.prepare("UPDATE chapters SET seed_prefix = '' WHERE id = ?").run(chapter.id)
    expect(getChapterSeed(db, chapter.id)).toBe('')
    expect(getChapterById(db, chapter.id)?.content).toContain('这是第 1 章')
  })
})
