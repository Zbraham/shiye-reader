import { describe, expect, it } from 'vitest'
import { snapParagraphEnd } from '@shared/plot/select'

const CONTENT = '第一段。\n\n第二段更长一些。\n\n第三段。'

describe('snapParagraphEnd', () => {
  it('returns zero for an empty offset or content', () => {
    expect(snapParagraphEnd(CONTENT, 0)).toBe(0)
    expect(snapParagraphEnd(CONTENT, -4)).toBe(0)
    expect(snapParagraphEnd('', 12)).toBe(0)
  })

  it('snaps to the end of the containing paragraph', () => {
    expect(snapParagraphEnd(CONTENT, 1)).toBe(4)
    expect(snapParagraphEnd(CONTENT, 4)).toBe(4)
    expect(snapParagraphEnd(CONTENT, 6)).toBe(CONTENT.indexOf('\n\n第三段'))
    expect(snapParagraphEnd(CONTENT, 20)).toBe(CONTENT.length)
  })

  it('keeps a one-line chapter as one paragraph', () => {
    const text = '雨落在瓦上，她把信纸摊平。'
    expect(snapParagraphEnd(text, 3)).toBe(text.length)
  })

  it('returns the chapter length when the selection is in the last paragraph', () => {
    expect(snapParagraphEnd(CONTENT, CONTENT.length)).toBe(CONTENT.length)
    expect(snapParagraphEnd(CONTENT, CONTENT.length + 40)).toBe(CONTENT.length)
  })

  it('ignores leading whitespace inside the first paragraph', () => {
    const text = '  第一段。\n\n第二段。'
    expect(snapParagraphEnd(text, 4)).toBe(6)
  })
})
