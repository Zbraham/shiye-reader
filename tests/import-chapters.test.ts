import { describe, expect, it } from 'vitest'
import { finalizeChapters, splitPlainText } from '@shared/import/chapters'
import { IMPORT_LIMITS } from '@shared/import/types'

const OPTIONS = { fallbackTitle: '测试书', format: 'txt' as const }

describe('splitPlainText', () => {
  it('splits Arabic and Chinese chapter numbers', () => {
    const text = [
      '第1章 雨夜',
      '雨落在瓦上。她把信纸摊平。',
      '',
      '第二章 北站',
      '广播里念出了她的名字。',
      '',
      '第 12 节 旧信',
      '信封上的邮票已经褪色。'
    ].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      '第1章 雨夜',
      '第二章 北站',
      '第 12 节 旧信'
    ])
    expect(result.chapters[0]?.content).toContain('雨落在瓦上')
    expect(result.chapters[2]?.content).toContain('褪色')
  })

  it('recognizes special and volume headings', () => {
    const text = [
      '序章 旧宅',
      '门在身后合上。',
      '',
      '第一章 来客',
      '她听见脚步声。',
      '',
      '番外 一封信',
      '很多年后，信还在。'
    ].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters).toHaveLength(3)
    expect(result.chapters[0]?.title).toContain('序章')
    expect(result.chapters[2]?.title).toContain('番外')
  })

  it('uses the first markdown h1 as the title and h2 as chapters', () => {
    const text = [
      '# 雨夜来信',
      '',
      '## 第一章 雨',
      '雨落在瓦上。',
      '',
      '## 第二章 北站',
      '广播里念出了她的名字。'
    ].join('\n')
    const result = splitPlainText(text, { fallbackTitle: '测试书', format: 'md' })
    expect(result.title).toBe('雨夜来信')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 雨',
      '第二章 北站'
    ])
  })

  it('keeps a short markdown preface with the first chapter', () => {
    const text = [
      '# 雨夜来信',
      '',
      '这是写在故事之前的话。',
      '',
      '## 第一章 雨',
      '雨落在瓦上。'
    ].join('\n')
    const result = splitPlainText(text, { fallbackTitle: '测试书', format: 'md' })
    expect(result.title).toBe('雨夜来信')
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]?.content).toContain('这是写在故事之前的话')
    expect(result.chapters[0]?.content).toContain('雨落在瓦上')
  })

  it('turns a long markdown preface into its own chapter', () => {
    const preface = `这是前言。${'旧事被重新翻开。'.repeat(20)}`
    const text = ['# 雨夜来信', '', preface, '', '## 第一章 雨', '雨落在瓦上。'].join('\n')
    const result = splitPlainText(text, { fallbackTitle: '测试书', format: 'md' })
    expect(result.title).toBe('雨夜来信')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['前言', '第一章 雨'])
    expect(result.chapters[0]?.content).toContain('旧事被重新翻开')
  })

  it('strips h3+ markdown markers from chapter content', () => {
    const text = [
      '# 雨夜来信',
      '',
      '## 第一章 雨',
      '',
      '### 第一节 雨声',
      '',
      '雨落在瓦上。',
      '',
      '#### 更小的标题',
      '',
      '她把信纸摊平。'
    ].join('\n')
    const result = splitPlainText(text, { fallbackTitle: '测试书', format: 'md' })
    const content = result.chapters[0]?.content ?? ''
    expect(content).toContain('第一节 雨声')
    expect(content).toContain('更小的标题')
    expect(content).not.toContain('#')
  })

  it('keeps a short preface with the first chapter', () => {
    const text = [
      '这本书写给雨夜。',
      '',
      '第一章 雨',
      '雨落在瓦上。'
    ].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]?.content).toContain('这本书写给雨夜')
    expect(result.chapters[0]?.content).toContain('雨落在瓦上')
  })

  it('turns a long preface into its own chapter', () => {
    const preface = `这是前言。${'旧事被重新翻开。'.repeat(20)}`
    const text = [preface, '', '第一章 雨', '雨落在瓦上。'].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['前言', '第一章 雨'])
  })

  it('turns TXT volume headings into metadata instead of body text', () => {
    const text = [
      '第一卷 风起',
      '第一章 雨',
      '雨落在瓦上。',
      '第二章 北站',
      '广播里念出了她的名字。',
      '第二卷 云散',
      '第三章 晴',
      '天亮了。'
    ].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 雨',
      '第二章 北站',
      '第三章 晴'
    ])
    expect(result.chapters.map((chapter) => chapter.volume)).toEqual([
      '第一卷 风起',
      '第一卷 风起',
      '第二卷 云散'
    ])
    for (const chapter of result.chapters) {
      expect(chapter.content).not.toContain('第一卷')
      expect(chapter.content).not.toContain('第二卷')
    }
  })

  it('falls back to paragraph-length chapters and warns', () => {
    const paragraph = '雨落在瓦上，她把信纸摊平，又从抽屉里取出一支旧笔。'.repeat(40)
    const text = Array.from({ length: 4 }, () => paragraph).join('\n\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters.length).toBeGreaterThan(1)
    expect(result.warnings.join('')).toContain('自动分章')
  })

  it('splits an oversized chapter at paragraph boundaries', () => {
    const block = '这一行是正文，用来测试超长章节的拆分。'.repeat(20)
    const body = Array.from({ length: 400 }, () => block).join('\n\n')
    const result = splitPlainText(`第一章 长夜\n${body}`, OPTIONS)
    expect(result.chapters.length).toBeGreaterThan(1)
    expect(result.chapters[0]?.title).toContain('第一章 长夜')
    for (const chapter of result.chapters) {
      expect(chapter.content.length).toBeLessThanOrEqual(IMPORT_LIMITS.chapterChars)
    }
  })

  it('removes obvious site ad lines', () => {
    const text = [
      '第一章 雨',
      '雨落在瓦上。',
      '本章未完，请点击下一页继续阅读',
      '最新网址：example.com',
      '（本章完）'
    ].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters[0]?.content).toBe('雨落在瓦上。')
  })

  it('keeps one-paragraph-per-line Chinese text readable', () => {
    const text = ['第一章 雨', '雨落在瓦上。', '她把信纸摊平。'].join('\n')
    const result = splitPlainText(text, OPTIONS)
    expect(result.chapters[0]?.content).toBe('雨落在瓦上。\n\n她把信纸摊平。')
  })

  it('splits a titled markdown story that has no chapter headings', () => {
    const paragraph = '雨落在瓦上，她把信纸摊平。'.repeat(30)
    // Must exceed IMPORT_LIMITS.fallbackChapterChars (3000) so length-based
    // splitting produces more than one chapter.
    const body = Array.from({ length: 10 }, () => paragraph).join('\n\n')
    const result = splitPlainText(`# 雨夜来信\n\n${body}`, {
      fallbackTitle: '测试书',
      format: 'md'
    })
    expect(result.title).toBe('雨夜来信')
    expect(result.chapters.length).toBeGreaterThan(1)
    expect(result.chapters[0]?.content.startsWith('雨落在瓦上')).toBe(true)
    expect(result.warnings.join('')).toContain('自动分章')
  })

  it('caps long chapter titles to the import schema limit', () => {
    const chapters = finalizeChapters([
      { title: '长'.repeat(300), content: '正文。' }
    ])
    expect(chapters[0]?.title).toHaveLength(120)
  })
})
