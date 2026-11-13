import { describe, expect, it } from 'vitest'
import { changedRatio, diffSegments, diffSummary } from '@shared/diff'

function rebuild(segments: ReturnType<typeof diffSegments>, keep: 'add' | 'remove'): string {
  return segments
    .filter((segment) => segment.type === 'same' || segment.type === keep)
    .map((segment) => segment.text)
    .join('')
}

describe('diffSegments', () => {
  it('returns a single unchanged segment for identical text', () => {
    expect(diffSegments('雨落在瓦上。', '雨落在瓦上。')).toEqual([
      { type: 'same', text: '雨落在瓦上。' }
    ])
  })

  it('marks inserted and removed characters', () => {
    const segments = diffSegments('她走进屋。', '她走出屋。')
    expect(segments.some((segment) => segment.type === 'add')).toBe(true)
    expect(segments.some((segment) => segment.type === 'remove')).toBe(true)
    expect(rebuild(segments, 'remove')).toBe('她走进屋。')
    expect(rebuild(segments, 'add')).toBe('她走出屋。')
  })

  it('rebuilds both sides for longer prose', () => {
    const before = '他坐在窗前，手里握着一封没有拆开的信。'.repeat(40)
    const after = before.replace('没有拆开', '已经拆开')
    const segments = diffSegments(before, after)
    expect(rebuild(segments, 'remove')).toBe(before)
    expect(rebuild(segments, 'add')).toBe(after)
  })

  it('falls back to paragraph comparison beyond the coarse threshold', () => {
    const paragraph = '雨落在瓦上，声音很轻。'.repeat(500)
    const before = `${paragraph}\n\n第二段。`
    const after = `${paragraph}\n\n改过的第二段。`
    const segments = diffSegments(before, after)
    expect(rebuild(segments, 'remove')).toBe(before)
    expect(rebuild(segments, 'add')).toBe(after)
  })
})

describe('changedRatio', () => {
  it('is zero for identical text', () => {
    expect(changedRatio('同样的一段', '同样的一段')).toBe(0)
  })

  it('is one when one side is empty', () => {
    expect(changedRatio('', '新的内容')).toBe(1)
    expect(changedRatio('旧的内容', '')).toBe(1)
    expect(changedRatio('', '')).toBe(0)
  })

  it('lands between zero and one for partial edits', () => {
    const ratio = changedRatio('她走进屋，把伞收好。', '她走出屋，把伞收好。')
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(1)
  })
})

describe('diffSummary', () => {
  it('counts added and removed characters', () => {
    const summary = diffSummary('她走进屋。', '她走出屋。')
    expect(summary.added).toBe(1)
    expect(summary.removed).toBe(1)
    expect(summary.ratio).toBeGreaterThan(0)
  })
})
