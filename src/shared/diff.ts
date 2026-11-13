import { diffArrays, diffChars } from 'diff'

export interface DiffSegment {
  type: 'same' | 'add' | 'remove'
  text: string
}

const COARSE_THRESHOLD = 6000

/**
 * Character-level diff for prose up to a few thousand characters. Longer
 * passages are compared paragraph by paragraph to keep the UI responsive.
 */
export function diffSegments(before: string, after: string): DiffSegment[] {
  if (before === after) return [{ type: 'same', text: before }]

  if (before.length > COARSE_THRESHOLD || after.length > COARSE_THRESHOLD) {
    const beforeParts = before.split(/(\n+)/)
    const afterParts = after.split(/(\n+)/)
    return diffArrays(beforeParts, afterParts).map((part) => ({
      type: part.added ? 'add' : part.removed ? 'remove' : 'same',
      text: part.value.join('')
    }))
  }

  return diffChars(before, after).map((part) => ({
    type: part.added ? 'add' : part.removed ? 'remove' : 'same',
    text: part.value
  }))
}

export function changedRatio(before: string, after: string): number {
  if (before === after) return 0
  if (!before && !after) return 0
  if (!before || !after) return 1
  const segments = diffSegments(before, after)
  let changed = 0
  for (const segment of segments) {
    if (segment.type !== 'same') changed += segment.text.length
  }
  return changed / Math.max(before.length, after.length, 1)
}

export function diffSummary(before: string, after: string): {
  added: number
  removed: number
  ratio: number
} {
  if (before === after) return { added: 0, removed: 0, ratio: 0 }
  const segments = diffSegments(before, after)
  let added = 0
  let removed = 0
  for (const segment of segments) {
    if (segment.type === 'add') added += segment.text.length
    if (segment.type === 'remove') removed += segment.text.length
  }
  return {
    added,
    removed,
    ratio: (added + removed) / Math.max(before.length, after.length, 1)
  }
}
