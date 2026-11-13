import { afterEach, describe, expect, it } from 'vitest'
import type { AppEvent, ImportBookInput } from '@shared/types'
import { migrate } from '@main/db/schema'
import { openDatabase, type DatabaseHandle } from '@main/db/sqlite'
import {
  activeDirectives,
  createImportedProject,
  getChapterByIndex,
  getVersion,
  lastChapterIdxOf,
  listVersions,
  loadSettings
} from '@main/db/repo'
import { StoryEngine } from '@main/engine'

const open: DatabaseHandle[] = []

afterEach(() => {
  while (open.length > 0) open.pop()?.close()
})

function freshDb(): DatabaseHandle {
  const db = openDatabase(':memory:')
  migrate(db)
  open.push(db)
  return db
}

function chapterText(idx: number): string {
  return [
    `第${idx}章的雨落在瓦上，她把信纸摊平，又从抽屉里取出一支旧笔。`,
    `她听见门外的脚步停了一瞬，随后又远去了。这是第${idx}章留下的悬念。`,
    `灯没有开，信封上的旧邮票在黑暗里看不见，可她记得它的颜色。`
  ].join('\n\n')
}

function makeInput(count = 5): ImportBookInput {
  const chapters = Array.from({ length: count }, (_, index) => {
    const idx = index + 1
    return { title: `第${idx}章 雨`, content: chapterText(idx) }
  })
  return {
    title: '雨夜来信',
    genre: '导入',
    tone: '沿用原文',
    pov: '沿用原文',
    styleSample: chapters[0]?.content.slice(0, 100) ?? '',
    styleGuide: '严格延续原文',
    targetLenPerChapter: 1200,
    sourceFile: '雨夜来信.txt',
    chapters
  }
}

interface Harness {
  engine: StoryEngine
  events: AppEvent[]
  waitFor: (batchId: string, status: 'done' | 'stopped' | 'failed') => Promise<AppEvent>
  waitIdle: () => Promise<void>
}

function harness(db: DatabaseHandle): Harness {
  const events: AppEvent[] = []
  let waiter: ((event: AppEvent) => void) | null = null
  const engine = new StoryEngine({
    db,
    getSettings: () => loadSettings(db),
    emit: (event) => {
      events.push(event)
      waiter?.(event)
    }
  })

  const waitFor: Harness['waitFor'] = (batchId, status) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null
        reject(new Error(`没有等到 plot:batch ${status}`))
      }, 20000)
      waiter = (event) => {
        if (
          event.type === 'plot:batch' &&
          event.batchId === batchId &&
          event.status === status
        ) {
          clearTimeout(timer)
          waiter = null
          resolve(event)
        }
      }
    })

  const waitIdle = async (): Promise<void> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 15000) {
      if (engine.queue.activeJobs().length === 0) return
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw new Error('队列没有在预期时间内停下来')
  }

  return { engine, events, waitFor, waitIdle }
}

describe('plotRewrite', () => {
  it(
    'rewrites the next three chapters and archives the old drafts',
    async () => {
      const db = freshDb()
      const project = createImportedProject(db, makeInput(5))
      const { engine, events, waitFor, waitIdle } = harness(db)
      const originals = new Map(
        [1, 2, 3, 4, 5].map((idx) => [
          idx,
          getChapterByIndex(db, project.id, idx)?.content ?? ''
        ])
      )

      const result = await engine.plotRewrite({
        projectId: project.id,
        fromIdx: 2,
        startMode: 'after',
        startOffset: null,
        direction: '让她在雨夜做出相反的选择，先把信留下。',
        batchSize: 3
      })
      expect(result.units.map((unit) => unit.idx)).toEqual([3, 4, 5])
      expect(result.units.map((unit) => unit.mode)).toEqual([
        'replaced',
        'replaced',
        'replaced'
      ])
      expect(result.units.every((unit) => unit.versionId !== null)).toBe(true)
      expect(result.replaceTo).toBe(5)

      await waitFor(result.batchId, 'done')
      await waitIdle()

      expect(lastChapterIdxOf(db, project.id)).toBe(5)
      for (const idx of [1, 2]) {
        expect(getChapterByIndex(db, project.id, idx)?.content).toBe(originals.get(idx))
      }
      for (const idx of [3, 4, 5]) {
        const chapter = getChapterByIndex(db, project.id, idx)
        expect(chapter?.status).toBe('final')
        expect(chapter?.content).not.toBe(originals.get(idx))
        expect(chapter?.content.length).toBeGreaterThan(0)
        const versions = listVersions(db, chapter?.id ?? '')
        expect(versions[0]?.reason).toContain('改后续')
      }
      expect(activeDirectives(db, project.id, 3)).toHaveLength(0)
      expect(activeDirectives(db, project.id, 4)).toHaveLength(0)
      expect(activeDirectives(db, project.id, 5)).toHaveLength(0)
      expect(
        events.some(
          (event) =>
            event.type === 'plot:batch' &&
            event.batchId === result.batchId &&
            event.status === 'running'
        )
      ).toBe(true)
    },
    30000
  )

  it(
    'keeps the paragraph prefix and marks later chapters stale',
    async () => {
      const db = freshDb()
      const project = createImportedProject(db, makeInput(6))
      const { engine, waitFor, waitIdle } = harness(db)
      const second = getChapterByIndex(db, project.id, 2)
      const original = second?.content ?? ''
      const offset = original.indexOf('\n\n')
      const prefix = original.slice(0, offset)
      const sixth = getChapterByIndex(db, project.id, 6)?.content ?? ''

      const result = await engine.plotRewrite({
        projectId: project.id,
        fromIdx: 2,
        startMode: 'paragraph',
        startOffset: offset,
        direction: '她从门口退回去，把信压在灯下。',
        batchSize: 3
      })
      expect(result.units.map((unit) => unit.idx)).toEqual([2, 3, 4])
      expect(result.units[0]?.mode).toBe('seeded')
      expect(result.staleFrom).toBe(5)

      await waitFor(result.batchId, 'done')
      await waitIdle()

      const rewritten = getChapterByIndex(db, project.id, 2)
      expect(rewritten?.status).toBe('final')
      expect(rewritten?.content.startsWith(prefix)).toBe(true)
      expect(rewritten?.content).not.toBe(original)
      expect(getChapterByIndex(db, project.id, 5)?.status).toBe('stale')
      expect(getChapterByIndex(db, project.id, 6)?.status).toBe('stale')
      expect(getChapterByIndex(db, project.id, 6)?.content).toBe(sixth)
      expect(activeDirectives(db, project.id, 2)).toHaveLength(0)
    },
    30000
  )

  it(
    'rewrites the anchor chapter together with the next two',
    async () => {
      const db = freshDb()
      const project = createImportedProject(db, makeInput(6))
      const { engine, waitFor, waitIdle } = harness(db)
      const originals = new Map(
        [2, 3, 4].map((idx) => [
          idx,
          getChapterByIndex(db, project.id, idx)?.content ?? ''
        ])
      )
      const fifth = getChapterByIndex(db, project.id, 5)?.content ?? ''

      const result = await engine.plotRewrite({
        projectId: project.id,
        fromIdx: 2,
        startMode: 'include',
        startOffset: null,
        direction: '把第2章写成她当场拆开了那封信。',
        batchSize: 3
      })
      expect(result.units.map((unit) => unit.idx)).toEqual([2, 3, 4])
      expect(result.units.every((unit) => unit.versionId !== null)).toBe(true)
      expect(result.staleFrom).toBe(5)

      await waitFor(result.batchId, 'done')
      await waitIdle()

      for (const idx of [2, 3, 4]) {
        const chapter = getChapterByIndex(db, project.id, idx)
        expect(chapter?.status).toBe('final')
        expect(chapter?.content).not.toBe(originals.get(idx))
        const version = listVersions(db, chapter?.id ?? '')[0]
        expect(version ? getVersion(db, version.id)?.content : '').toBe(
          originals.get(idx)
        )
      }
      expect(getChapterByIndex(db, project.id, 5)?.content).toBe(fifth)
      expect(getChapterByIndex(db, project.id, 5)?.status).toBe('stale')
      expect(lastChapterIdxOf(db, project.id)).toBe(6)
    },
    30000
  )

  it(
    'stops the batch and leaves unvisited chapters readable',
    async () => {
      const db = freshDb()
      const project = createImportedProject(db, makeInput(5))
      const { engine, waitFor, waitIdle } = harness(db)
      const third = getChapterByIndex(db, project.id, 3)?.content ?? ''
      const fourth = getChapterByIndex(db, project.id, 4)?.content ?? ''

      const result = await engine.plotRewrite({
        projectId: project.id,
        fromIdx: 2,
        startMode: 'after',
        startOffset: null,
        direction: '换一个方向，让信被雨淋湿。',
        batchSize: 3
      })
      const stopped = waitFor(result.batchId, 'stopped')
      await engine.plotCancel(project.id, result.batchId)
      await stopped
      await waitIdle()

      const firstUnit = getChapterByIndex(db, project.id, 3)
      expect(firstUnit?.content).toBe(third)
      expect(firstUnit?.status).toBe('final')
      const secondUnit = getChapterByIndex(db, project.id, 4)
      expect(secondUnit?.content).toBe(fourth)
      expect(secondUnit?.status).toBe('final')
      expect(getChapterByIndex(db, project.id, 5)?.content).not.toBe('')
      expect(activeDirectives(db, project.id, 3)).toHaveLength(0)
    },
    30000
  )
})
