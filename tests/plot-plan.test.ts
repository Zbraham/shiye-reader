import { describe, expect, it } from 'vitest'
import { planPlot, PlotPlanError } from '@shared/plot/plan'

describe('planPlot', () => {
  it('keeps the anchor chapter and targets the next three', () => {
    const plan = planPlot({
      fromIdx: 5,
      startMode: 'after',
      startOffset: null,
      chapterCount: 5,
      batchSize: 3
    })
    expect(plan.units.map((unit) => unit.chapterIdx)).toEqual([6, 7, 8])
    expect(plan.archived).toEqual([])
    expect(plan.created).toEqual([6, 7, 8])
    expect(plan.replaceTo).toBe(8)
    expect(plan.staleFrom).toBe(9)
    expect(plan.directive).toEqual({ starts: 6, expires: 8 })
  })

  it('includes the anchor chapter and archives it', () => {
    const plan = planPlot({
      fromIdx: 5,
      startMode: 'include',
      startOffset: null,
      chapterCount: 10,
      batchSize: 3
    })
    expect(plan.units.map((unit) => unit.chapterIdx)).toEqual([5, 6, 7])
    expect(plan.archived).toEqual([5, 6, 7])
    expect(plan.created).toEqual([])
    expect(plan.replaceTo).toBe(7)
    expect(plan.staleFrom).toBe(8)
    expect(plan.directive).toEqual({ starts: 5, expires: 7 })
  })

  it('keeps a paragraph prefix on the first unit only', () => {
    const plan = planPlot({
      fromIdx: 5,
      startMode: 'paragraph',
      startOffset: 120,
      chapterCount: 10,
      batchSize: 3
    })
    expect(plan.units).toEqual([
      { chapterIdx: 5, keepPrefixChars: 120 },
      { chapterIdx: 6, keepPrefixChars: 0 },
      { chapterIdx: 7, keepPrefixChars: 0 }
    ])
    expect(plan.archived).toEqual([5, 6, 7])
    expect(plan.replaceTo).toBe(7)
  })

  it('mixes existing and new chapters at the end of a book', () => {
    const plan = planPlot({
      fromIdx: 1997,
      startMode: 'after',
      startOffset: null,
      chapterCount: 1999,
      batchSize: 3
    })
    expect(plan.units.map((unit) => unit.chapterIdx)).toEqual([1998, 1999, 2000])
    expect(plan.archived).toEqual([1998, 1999])
    expect(plan.created).toEqual([2000])
    expect(plan.replaceTo).toBe(2000)
  })

  it('allows the last two positions but rejects overflow', () => {
    expect(() =>
      planPlot({
        fromIdx: 1997,
        startMode: 'after',
        startOffset: null,
        chapterCount: 2000,
        batchSize: 3
      })
    ).not.toThrow()
    expect(() =>
      planPlot({
        fromIdx: 1998,
        startMode: 'after',
        startOffset: null,
        chapterCount: 2000,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
    expect(() =>
      planPlot({
        fromIdx: 1998,
        startMode: 'include',
        startOffset: null,
        chapterCount: 2000,
        batchSize: 3
      })
    ).not.toThrow()
    expect(() =>
      planPlot({
        fromIdx: 1999,
        startMode: 'include',
        startOffset: null,
        chapterCount: 2000,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
  })

  it('rejects a start beyond the existing chapters', () => {
    expect(() =>
      planPlot({
        fromIdx: 6,
        startMode: 'after',
        startOffset: null,
        chapterCount: 5,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
    expect(() =>
      planPlot({
        fromIdx: 0,
        startMode: 'after',
        startOffset: null,
        chapterCount: 5,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
  })

  it('validates the paragraph offset and mode pairing', () => {
    expect(() =>
      planPlot({
        fromIdx: 5,
        startMode: 'paragraph',
        startOffset: null,
        chapterCount: 5,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
    expect(() =>
      planPlot({
        fromIdx: 5,
        startMode: 'paragraph',
        startOffset: 0,
        chapterCount: 5,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
    expect(() =>
      planPlot({
        fromIdx: 5,
        startMode: 'after',
        startOffset: 10,
        chapterCount: 5,
        batchSize: 3
      })
    ).toThrow(PlotPlanError)
  })
})
