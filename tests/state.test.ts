import { describe, expect, it } from 'vitest'
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isActiveStatus,
  isReadableStatus
} from '@shared/constants'

describe('chapter state machine', () => {
  it('allows the normal generation path', () => {
    expect(canTransition('outline', 'queued')).toBe(true)
    expect(canTransition('queued', 'generating')).toBe(true)
    expect(canTransition('generating', 'draft')).toBe(true)
    expect(canTransition('draft', 'final')).toBe(true)
  })

  it('allows edits to mark a finished chapter stale', () => {
    expect(canTransition('final', 'stale')).toBe(true)
    expect(canTransition('stale', 'final')).toBe(true)
    expect(canTransition('stale', 'queued')).toBe(true)
  })

  it('rejects skipping the queue', () => {
    expect(canTransition('outline', 'generating')).toBe(false)
    expect(canTransition('outline', 'final')).toBe(false)
  })

  it('treats same-state calls as no-ops', () => {
    expect(canTransition('draft', 'draft')).toBe(true)
  })

  it('throws a typed error on an illegal transition', () => {
    expect(() => assertTransition('outline', 'final')).toThrow(InvalidTransitionError)
  })

  it('classifies active and readable statuses', () => {
    expect(isActiveStatus('queued')).toBe(true)
    expect(isActiveStatus('generating')).toBe(true)
    expect(isActiveStatus('draft')).toBe(false)
    expect(isReadableStatus('draft')).toBe(true)
    expect(isReadableStatus('final')).toBe(true)
    expect(isReadableStatus('stale')).toBe(true)
    expect(isReadableStatus('outline')).toBe(false)
  })
})
