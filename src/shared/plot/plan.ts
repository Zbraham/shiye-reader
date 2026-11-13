import type { PlotStartMode } from '../types'

export interface PlotUnit {
  chapterIdx: number
  /** Characters kept verbatim from the start of this chapter (paragraph mode). */
  keepPrefixChars: number
}

export interface PlotPlan {
  units: [PlotUnit, PlotUnit, PlotUnit]
  archived: number[]
  created: number[]
  replaceTo: number
  staleFrom: number
  directive: { starts: number; expires: number }
}

export interface PlanPlotInput {
  fromIdx: number
  startMode: PlotStartMode
  startOffset: number | null
  chapterCount: number
  batchSize: 3
}

const MAX_CHAPTERS = 2000

export class PlotPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlotPlanError'
  }
}

/**
 * Pure range maths for "rewrite the next three chapters". `chapterCount` is the
 * highest existing chapter index (not the reading cursor).
 */
export function planPlot(input: PlanPlotInput): PlotPlan {
  const { fromIdx, startMode, startOffset, chapterCount, batchSize } = input
  if (batchSize !== 3) throw new PlotPlanError('每次只能改写 3 章。')
  if (!Number.isInteger(fromIdx) || fromIdx < 1) {
    throw new PlotPlanError('请选择一个已有的章节作为起点。')
  }
  if (chapterCount < 0 || fromIdx > chapterCount) {
    throw new PlotPlanError('起点章节不存在，请刷新目录后重试。')
  }

  if (startMode === 'paragraph') {
    if (
      startOffset === null ||
      !Number.isInteger(startOffset) ||
      startOffset <= 0
    ) {
      throw new PlotPlanError('请选择本章中的一段文字作为改写起点。')
    }
  } else if (startMode !== 'after' && startMode !== 'include') {
    throw new PlotPlanError('未知的改写起点。')
  } else if (startOffset !== null) {
    throw new PlotPlanError('章节起点不需要段落位置。')
  }

  let indices: [number, number, number]
  let keepPrefix = 0
  if (startMode === 'after') {
    indices = [fromIdx + 1, fromIdx + 2, fromIdx + 3]
  } else if (startMode === 'include') {
    indices = [fromIdx, fromIdx + 1, fromIdx + 2]
  } else {
    indices = [fromIdx, fromIdx + 1, fromIdx + 2]
    keepPrefix = startOffset ?? 0
  }

  const replaceTo = indices[2]
  if (replaceTo > MAX_CHAPTERS) {
    throw new PlotPlanError(
      `书最多 ${MAX_CHAPTERS} 章，当前位置放不下 3 章。请换一个靠前的起点。`
    )
  }

  const units: [PlotUnit, PlotUnit, PlotUnit] = [
    { chapterIdx: indices[0], keepPrefixChars: keepPrefix },
    { chapterIdx: indices[1], keepPrefixChars: 0 },
    { chapterIdx: indices[2], keepPrefixChars: 0 }
  ]
  const archived = units
    .filter((unit) => unit.chapterIdx <= chapterCount)
    .map((unit) => unit.chapterIdx)
  const created = units
    .filter((unit) => unit.chapterIdx > chapterCount)
    .map((unit) => unit.chapterIdx)

  return {
    units,
    archived,
    created,
    replaceTo,
    staleFrom: replaceTo + 1,
    directive: { starts: units[0].chapterIdx, expires: replaceTo }
  }
}
