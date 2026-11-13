import { describe, expect, it } from 'vitest'
import { ImportBookSchema } from '@shared/schemas'
import { finalizeChapters, splitPlainText } from '@shared/import/chapters'

describe('import payload contract', () => {
  it('accepts what the import dialog builds from a parsed book', () => {
    const split = splitPlainText(
      [
        `# ${'很长'.repeat(80)}`,
        '',
        '## 第一章 雨',
        '雨落在瓦上。',
        '',
        '## 第二章 北站',
        '广播里念出了她的名字。'
      ].join('\n'),
      { fallbackTitle: '测试书', format: 'md' }
    )
    const chapters = finalizeChapters(split.chapters)
    const payload = {
      title: (split.title || '测试书').slice(0, 60),
      genre: '导入',
      tone: '沿用原文',
      pov: '沿用原文',
      styleSample: chapters[0]?.content.slice(0, 1200) ?? '',
      styleGuide: '严格延续原文的叙述人称、语气与节奏',
      targetLenPerChapter: 2000,
      sourceFile: '测试书.md',
      chapters
    }
    const parsed = ImportBookSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
  })
})
