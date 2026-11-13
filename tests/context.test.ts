import { describe, expect, it } from 'vitest'
import type { Character, ChapterOutline, Directive } from '@shared/types'
import {
  buildWritingContext,
  contextBudget,
  type BuildContextInput,
  type ContextChapter
} from '@main/text/context'

const OUTLINE: ChapterOutline = {
  title: '第9章 北站',
  goals: ['抵达北站', '发现信封的来历'],
  advance: ['旧邮票的线索'],
  forbidden: ['不要揭穿她的身份'],
  hook: '广播里念出了她的名字。'
}

function makeInput(budget = 60000, repeat = 20): BuildContextInput {
  const characters: Character[] = [
    {
      id: 'char-1',
      projectId: 'project-1',
      name: '沈砚',
      aliases: ['阿砚'],
      profile: '替人写信的盲人，耳朵很灵，记得每一个人的脚步。',
      state: { location: '旧宅', condition: '平静', intent: '等一封回信' },
      firstChapter: 1
    }
  ]
  const directives: Directive[] = [
    {
      id: 'directive-1',
      projectId: 'project-1',
      scope: '本章',
      content: '雨停之前不要揭穿她的身份',
      status: 'pending',
      createdAt: 1,
      appliedChapter: null,
      expiresChapter: null
    }
  ]
  const priorChapters: ContextChapter[] = Array.from({ length: 8 }, (_, index) => ({
    idx: index + 1,
    title: `第${index + 1}章 雨`,
    content: '雨落在瓦上，她把信纸摊平，又从抽屉里取出一支旧笔。'.repeat(repeat),
    summaryL1: '她收到一封没有署名的信，决定去北站。',
    summaryL2: '她在门口停下，听见身后有人叫她的名字。',
    outline: null
  }))

  return {
    project: {
      title: '雨夜来信',
      genre: '悬疑',
      tone: '克制',
      pov: '第三人称限知',
      styleGuide: '少用比喻，对话短。',
      styleSample: '雨落在瓦上，声音很轻。',
      targetLenPerChapter: 2200,
      synopsis: '一个替人写信的盲人收到写给自己的旧信。',
      sellingPoint: '一封信把两个人的旧事重新翻开。'
    },
    characters,
    storyState: [
      { key: '地点', value: '旧宅' },
      { key: 'timeline', value: '第三日傍晚' }
    ],
    foreshadow: [{ id: 'f-1', text: '信封上的旧邮票', chapter: 2 }],
    directives,
    priorChapters,
    currentIdx: 9,
    currentTitle: '第9章 北站',
    currentOutline: OUTLINE,
    minWords: 1800,
    maxWords: 2600,
    tokenBudget: budget
  }
}

describe('contextBudget', () => {
  it('reserves output and safety tokens', () => {
    expect(contextBudget(65536)).toBe(65536 - 3000 - 500)
    expect(contextBudget(8000)).toBe(4500)
  })

  it('never drops below the floor', () => {
    expect(contextBudget(1000)).toBe(4000)
  })
})

describe('buildWritingContext', () => {
  it('includes directives, outline and the current chapter number', () => {
    const result = buildWritingContext(makeInput())
    expect(result.user).toContain('雨停之前不要揭穿她的身份')
    expect(result.user).toContain('广播里念出了她的名字')
    expect(result.user).toContain('第9章')
    expect(result.system).toContain('长篇小说作家')
    expect(result.layers.t0).toBeGreaterThan(0)
    expect(result.layers.directives).toBeGreaterThan(0)
    expect(result.dropped).toEqual([])
  })

  it('reports a total that includes system and user', () => {
    const result = buildWritingContext(makeInput())
    expect(result.tokens).toBeGreaterThan(result.layers.t0)
    expect(result.keywords.length).toBeGreaterThan(0)
  })

  it('degrades in the documented order when the budget is tight', () => {
    const result = buildWritingContext(makeInput(4000, 100))
    expect(result.dropped.length).toBeGreaterThan(0)
    expect(result.dropped).toContain('T4 检索片段')
    expect(result.tokens).toBeLessThanOrEqual(6000)
  })

  it('never lets the previous chapter dominate a tiny budget', () => {
    const result = buildWritingContext(makeInput(3000, 120))
    expect(result.layers.t1).toBeLessThan(3000)
    expect(result.tokens).toBeLessThanOrEqual(4500)
  })

  it('keeps the current outline even after degradation', () => {
    const result = buildWritingContext(makeInput(4000, 100))
    expect(result.layers.outline).toBeGreaterThan(0)
    expect(result.user).toContain('北站')
  })
})
