import { describe, expect, it } from 'vitest'
import {
  chunkChapter,
  inferRoleTag,
  isSceneSeparator,
  MAX_CHUNK_CHARS
} from '@main/text/chunker'

const SAMPLE = [
  '雨落在瓦上，声音很轻。她把信纸摊平，又从抽屉里取出一支旧笔。',
  '“你还是要走？”他站在门口，没有抬头。',
  '她没有回答。窗外的树影在墙上晃了一下，又安静下来。',
  '＊　＊　＊',
  '第二天清早，邮差把一封信塞进门缝。信封上没有署名，只有一枚旧邮票。',
  '她拆开信，里面只有一句话：别去北站。'
].join('\n\n')

describe('chunkChapter', () => {
  it('keeps exact offsets and text', () => {
    const chunks = chunkChapter(SAMPLE)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(SAMPLE.slice(chunk.startOff, chunk.endOff)).toBe(chunk.text)
      expect(chunk.hash).toHaveLength(8)
    }
  })

  it('keeps chunks ordered and non-overlapping', () => {
    const chunks = chunkChapter(SAMPLE)
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]
      const current = chunks[index]
      expect(previous && current).toBeTruthy()
      if (previous && current) {
        expect(current.startOff).toBeGreaterThanOrEqual(previous.endOff)
        expect(current.idx).toBe(previous.idx + 1)
      }
    }
  })

  it('does not merge across scene separators', () => {
    const chunks = chunkChapter(SAMPLE)
    const separator = chunks.find((chunk) => isSceneSeparator(chunk.text))
    expect(separator).toBeTruthy()
  })

  it('respects the maximum block size', () => {
    const sentence = '她沿着河岸往前走，风把衣角吹得猎猎作响。'
    const content = sentence.repeat(60)
    const chunks = chunkChapter(content)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
    const joined = chunks.map((chunk) => chunk.text).join('')
    expect(joined.replace(/\s/gu, '')).toBe(content.replace(/\s/gu, ''))
  })

  it('merges very short paragraphs into one block', () => {
    const content = Array.from({ length: 6 }, (_, index) => `第${index + 1}句很短。`).join(
      '\n\n'
    )
    const chunks = chunkChapter(content)
    expect(chunks.length).toBeLessThan(6)
    expect(chunks[0]?.text).toContain('第1句很短。')
  })

  it('returns nothing for blank content', () => {
    expect(chunkChapter('')).toEqual([])
    expect(chunkChapter(' \n\n　')).toEqual([])
  })
})

describe('inferRoleTag', () => {
  it('recognises dialogue', () => {
    expect(inferRoleTag('“你来了。”他说。')).toBe('对话')
  })

  it('recognises psychology', () => {
    expect(inferRoleTag('她想，也许这件事从一开始就不对。')).toBe('心理')
  })

  it('recognises turns', () => {
    expect(inferRoleTag('然而门始终没有打开。')).toBe('转折')
  })

  it('falls back to description', () => {
    expect(inferRoleTag('远处的山脊线慢慢暗了下去。')).toBe('描写')
  })
})

describe('isSceneSeparator', () => {
  it('accepts asterisks and dashes, rejects prose', () => {
    expect(isSceneSeparator('＊ ＊ ＊')).toBe(true)
    expect(isSceneSeparator('—— ——')).toBe(true)
    expect(isSceneSeparator('她走了很久。')).toBe(false)
  })
})
