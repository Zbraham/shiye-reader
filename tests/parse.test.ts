import { describe, expect, it } from 'vitest'
import type { Chunk } from '@shared/types'
import {
  cleanRewriteOutput,
  normalizeBeats,
  normalizeIssues,
  normalizeOutline,
  normalizeSkeleton,
  normalizeSummary,
  normalizeTargets,
  parseJsonLoose
} from '@main/llm/parse'

function makeChunk(idx: number, text: string): Chunk {
  return {
    id: `chunk-${idx}`,
    chapterId: 'chapter-1',
    idx,
    startOff: idx * 10,
    endOff: idx * 10 + text.length,
    text,
    roleTag: '描写',
    hash: '00000000'
  }
}

describe('normalizeSkeleton', () => {
  it('fills a usable skeleton from nothing', () => {
    const skeleton = normalizeSkeleton({}, '雨夜来信', '悬疑')
    expect(skeleton.titles.length).toBeGreaterThanOrEqual(3)
    expect(skeleton.titles[0]).toBe('雨夜来信')
    expect(skeleton.characters.length).toBeGreaterThanOrEqual(1)
    expect(skeleton.world.length).toBeGreaterThanOrEqual(1)
    expect(skeleton.chapters.length).toBe(3)
    expect(skeleton.chapters[0]?.title).toBeTruthy()
  })

  it('keeps supplied material and trims it', () => {
    const skeleton = normalizeSkeleton(
      {
        titles: [' 雨夜 ', '北站'],
        sellingPoint: '  一封信  ',
        synopsis: '旧事重提。',
        characters: [{ name: '沈砚', identity: '写信人' }, { name: '  ' }],
        world: ['规矩：夜里不点灯'],
        chapters: [{ title: '第一章', goals: ['等信'], hook: '门外有脚步。' }]
      },
      '备用名',
      '悬疑'
    )
    expect(skeleton.titles[0]).toBe('雨夜')
    expect(skeleton.sellingPoint).toBe('一封信')
    expect(skeleton.characters).toHaveLength(1)
    expect(skeleton.characters[0]?.identity).toBe('写信人')
    expect(skeleton.chapters[0]?.goals).toEqual(['等信'])
  })
})

describe('normalizeOutline', () => {
  it('provides defaults for an empty object', () => {
    const outline = normalizeOutline({}, '第2章')
    expect(outline.title).toBe('第2章')
    expect(outline.goals.length).toBe(1)
    expect(outline.hook.length).toBeGreaterThan(0)
    expect(outline.advance).toEqual([])
  })

  it('trims and caps every field', () => {
    const outline = normalizeOutline(
      {
        title: ' 夜行 ',
        goals: [' 一 ', '二', '  '],
        advance: ['推进'],
        forbidden: ['别下雨'],
        hook: '门外有人。'
      },
      '第2章'
    )
    expect(outline.title).toBe('夜行')
    expect(outline.goals).toEqual(['一', '二'])
    expect(outline.advance).toEqual(['推进'])
    expect(outline.forbidden).toEqual(['别下雨'])
  })
})

describe('normalizeTargets', () => {
  const chunks = [makeChunk(1, '雨落在瓦上。'), makeChunk(2, '她走进屋。')]

  it('matches display ids and chunk ids', () => {
    const result = normalizeTargets(
      {
        global_note: '只改两处',
        targets: [
          { id: 'c01-01', action: 'rewrite', reason: '太慢' },
          { id: 'chunk-2', action: 'delete', hint: '删掉' }
        ]
      },
      chunks,
      1,
      10
    )
    expect(result.globalNote).toBe('只改两处')
    expect(result.targets).toHaveLength(2)
    expect(result.targets[0]?.chunkId).toBe('chunk-1')
    expect(result.targets[0]?.displayId).toBe('c01-01')
    expect(result.targets[1]?.action).toBe('delete')
  })

  it('deduplicates and caps the list', () => {
    const result = normalizeTargets(
      {
        targets: [
          { id: 'c01-01' },
          { id: 'c01-01' },
          { id: 'c01-02' },
          { id: 'c01-09' }
        ]
      },
      chunks,
      1,
      1
    )
    expect(result.targets).toHaveLength(1)
  })

  it('falls back to rewrite for unknown actions', () => {
    const result = normalizeTargets(
      { targets: [{ id: 'c01-01', action: 'explode' }] },
      chunks,
      1,
      10
    )
    expect(result.targets[0]?.action).toBe('rewrite')
  })
})

describe('normalizeIssues and summary', () => {
  it('filters unknown or empty issues', () => {
    const issues = normalizeIssues({
      issues: [
        { type: 'name', detail: '沈砚的眼睛在第三章是好的' },
        { type: 'nonsense', detail: '门的位置变了' },
        { type: 'timeline', detail: '   ' }
      ]
    })
    expect(issues).toHaveLength(2)
    expect(issues[0]?.type).toBe('name')
    expect(issues[1]?.type).toBe('name')
  })

  it('builds a summary with empty defaults', () => {
    const summary = normalizeSummary({ who_did_what: '她去了北站' })
    expect(summary.who_did_what).toBe('她去了北站')
    expect(summary.foreshadow_planted).toEqual([])
  })

  it('keeps at most three beats', () => {
    expect(normalizeBeats({ beats: ['一', '二', '三', '四'] })).toHaveLength(3)
    expect(normalizeBeats({})).toEqual([])
  })
})

describe('cleanRewriteOutput', () => {
  it('strips prefixes, fences and wrapping quotes', () => {
    expect(cleanRewriteOutput('改写后的正文：她推开门。')).toBe('她推开门。')
    expect(cleanRewriteOutput('```\n她推开门。\n```')).toBe('她推开门。')
    expect(cleanRewriteOutput('“她推开门。”')).toBe('她推开门。')
  })
})

describe('parseJsonLoose', () => {
  it('reads loose JSON', () => {
    const value = parseJsonLoose<{ ok: number }>('结果如下 {"ok": 1}')
    expect(value.ok).toBe(1)
  })
})
