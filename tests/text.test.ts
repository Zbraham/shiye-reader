import { describe, expect, it } from 'vitest'
import {
  countWords,
  estimateTokens,
  extractJson,
  hashText,
  normalizeProse,
  splitParagraphs,
  stripMetaTrailer,
  stripModelMarkers,
  truncateByTokens
} from '@shared/text'

describe('countWords', () => {
  it('counts every CJK character as one', () => {
    expect(countWords('雨落在瓦上')).toBe(5)
  })

  it('counts latin words and digit runs', () => {
    expect(countWords('the quick brown fox 2024 年')).toBe(6)
    expect(countWords('')).toBe(0)
  })

  it('mixes scripts without double counting punctuation', () => {
    expect(countWords('她说："OK，明天见。"')).toBe(6)
  })
})

describe('token helpers', () => {
  it('grows with text and errs high for Chinese', () => {
    const short = estimateTokens('雨落在瓦上')
    const long = estimateTokens('雨落在瓦上。'.repeat(20))
    expect(short).toBeGreaterThanOrEqual(5)
    expect(long).toBeGreaterThan(short)
  })

  it('truncates from the requested end', () => {
    const text = '甲乙丙丁戊己庚辛壬癸'
    const head = truncateByTokens(text, 4, 'head')
    const tail = truncateByTokens(text, 4, 'tail')
    expect(estimateTokens(head)).toBeLessThanOrEqual(4)
    expect(estimateTokens(tail)).toBeLessThanOrEqual(4)
    expect(head.startsWith('甲')).toBe(true)
    expect(tail.endsWith('癸')).toBe(true)
  })

  it('leaves short text untouched', () => {
    expect(truncateByTokens('短句', 100)).toBe('短句')
    expect(truncateByTokens('短句', 0)).toBe('')
  })

  it('hashes stably', () => {
    expect(hashText('同一段文字')).toBe(hashText('同一段文字'))
    expect(hashText('同一段文字')).not.toBe(hashText('同一段文字。'))
  })
})

describe('model markers', () => {
  it('removes comments and collects facts', () => {
    const raw =
      '她关上门。\n\n<!--NEW_FACT: {"key":"地点","value":"旧宅"}-->\n\n<!-- 普通注释 -->\n（本章完）'
    const result = stripModelMarkers(raw)
    expect(result.text).not.toContain('NEW_FACT')
    expect(result.text).not.toContain('普通注释')
    expect(result.text).not.toContain('本章完')
    expect(result.facts).toEqual([{ key: '地点', value: '旧宅' }])
  })

  it('ignores malformed facts', () => {
    const result = stripModelMarkers('正文\n<!--NEW_FACT: nope-->')
    expect(result.facts).toEqual([])
    expect(result.text).toBe('正文')
  })

  it('strips repeated trailers', () => {
    expect(stripMetaTrailer('正文（本章完）（未完待续）')).toBe('正文')
  })
})

describe('normalizeProse', () => {
  it('turns line breaks into blank-line paragraphs', () => {
    const result = normalizeProse('第一段\n第二段\n\n\n第三段')
    expect(result).toBe('第一段\n\n第二段\n\n第三段')
  })

  it('drops a leading chapter heading and fences', () => {
    const result = normalizeProse('```\n第一章 雨夜\n\n雨落在瓦上。\n```')
    expect(result.startsWith('第一章')).toBe(false)
    expect(result).toContain('雨落在瓦上。')
    expect(result).not.toContain('```')
  })
})

describe('extractJson', () => {
  it('reads fenced JSON with surrounding prose', () => {
    const value = extractJson<{ ok: boolean }>('说明：\n```json\n{"ok": true}\n```')
    expect(value.ok).toBe(true)
  })

  it('repairs trailing commas and curly quotes', () => {
    const value = extractJson<{ title: string }>('{“title”: “雨夜”,}')
    expect(value.title).toBe('雨夜')
  })

  it('throws when there is no JSON', () => {
    expect(() => extractJson('没有结构的一段话')).toThrow()
  })
})

describe('splitParagraphs', () => {
  it('trims and drops empty lines', () => {
    expect(splitParagraphs(' 一 \n\n 二 \n')).toEqual(['一', '二'])
  })
})
