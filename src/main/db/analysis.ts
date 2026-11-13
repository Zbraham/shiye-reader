import { newId } from '../ids'
import type {
  AnalysisBundle,
  AnalysisForeshadow,
  AnalysisIssue,
  AnalysisIssueType,
  KnowledgeFact,
  TimelineEvent
} from '@shared/types'
import type { DatabaseHandle } from './sqlite'

type Row = Record<string, unknown>

function str(row: Row, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function num(row: Row, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNum(row: Row, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {}
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function rowToEvent(row: Row): TimelineEvent {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    chapterIdx: num(row, 'chapter_idx'),
    storyTime: str(row, 'story_time'),
    title: str(row, 'title'),
    detail: str(row, 'detail'),
    characters: parseStringArray(str(row, 'characters_json')),
    createdAt: num(row, 'created_at')
  }
}

function rowToKnowledge(row: Row): KnowledgeFact {
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    chapterIdx: num(row, 'chapter_idx'),
    character: str(row, 'character'),
    fact: str(row, 'fact'),
    createdAt: num(row, 'created_at')
  }
}

const ISSUE_TYPES: AnalysisIssueType[] = [
  'timeline',
  'name',
  'ability',
  'foreshadow',
  'pov',
  'logic'
]

function rowToIssue(row: Row): AnalysisIssue {
  const type = str(row, 'type') as AnalysisIssueType
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    chapterIdx: num(row, 'chapter_idx'),
    type: ISSUE_TYPES.includes(type) ? type : 'logic',
    detail: str(row, 'detail'),
    quote: str(row, 'quote'),
    status: str(row, 'status') === 'ignored' ? 'ignored' : 'open',
    createdAt: num(row, 'created_at')
  }
}

function rowToForeshadow(row: Row): AnalysisForeshadow {
  const status = str(row, 'status')
  return {
    id: str(row, 'id'),
    projectId: str(row, 'project_id'),
    plantedChapter: num(row, 'planted_chapter'),
    payoffChapter: nullableNum(row, 'payoff_chapter'),
    text: str(row, 'text'),
    status: status === 'paid' || status === 'ignored' ? status : 'open',
    createdAt: num(row, 'created_at')
  }
}

export interface ChapterAnalysisInput {
  events: Omit<TimelineEvent, 'id' | 'projectId' | 'chapterIdx' | 'createdAt'>[]
  knowledge: Omit<KnowledgeFact, 'id' | 'projectId' | 'chapterIdx' | 'createdAt'>[]
  issues: Omit<AnalysisIssue, 'id' | 'projectId' | 'chapterIdx' | 'status' | 'createdAt'>[]
  foreshadows: Omit<
    AnalysisForeshadow,
    'id' | 'projectId' | 'plantedChapter' | 'createdAt'
  >[]
}

export function listAnalyzedChapters(db: DatabaseHandle, projectId: string): number[] {
  return db
    .prepare('SELECT chapter_idx FROM analysis_chapters WHERE project_id = ? ORDER BY chapter_idx ASC')
    .all(projectId)
    .map((row) => num(asRow(row), 'chapter_idx'))
}

export function getAnalysis(db: DatabaseHandle, projectId: string): AnalysisBundle {
  const events = db
    .prepare('SELECT * FROM analysis_events WHERE project_id = ? ORDER BY chapter_idx ASC, created_at ASC')
    .all(projectId)
    .map((row) => rowToEvent(asRow(row)))
  const knowledge = db
    .prepare('SELECT * FROM analysis_knowledge WHERE project_id = ? ORDER BY chapter_idx ASC, created_at ASC')
    .all(projectId)
    .map((row) => rowToKnowledge(asRow(row)))
  const issues = db
    .prepare('SELECT * FROM analysis_issues WHERE project_id = ? ORDER BY chapter_idx ASC, created_at ASC')
    .all(projectId)
    .map((row) => rowToIssue(asRow(row)))
  const foreshadows = db
    .prepare(
      'SELECT * FROM analysis_foreshadows WHERE project_id = ? ORDER BY planted_chapter ASC, created_at ASC'
    )
    .all(projectId)
    .map((row) => rowToForeshadow(asRow(row)))
  const analyzed = listAnalyzedChapters(db, projectId)
  const updated = db
    .prepare('SELECT MAX(created_at) AS at FROM analysis_events WHERE project_id = ?')
    .get(projectId)
  return {
    projectId,
    events,
    knowledge,
    issues,
    foreshadows,
    analyzedChapters: analyzed,
    updatedAt: num(asRow(updated), 'at')
  }
}

export function getAnalysisForChapter(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number
): AnalysisBundle {
  const bundle = getAnalysis(db, projectId)
  return {
    ...bundle,
    events: bundle.events.filter((item) => item.chapterIdx === chapterIdx),
    knowledge: bundle.knowledge.filter((item) => item.chapterIdx === chapterIdx),
    issues: bundle.issues.filter((item) => item.chapterIdx === chapterIdx),
    foreshadows: bundle.foreshadows.filter((item) => item.plantedChapter === chapterIdx)
  }
}

export function replaceChapterAnalysis(
  db: DatabaseHandle,
  projectId: string,
  chapterIdx: number,
  input: ChapterAnalysisInput
): { events: number; knowledge: number; issues: number; foreshadows: number } {
  const now = Date.now()
  let events = 0
  let knowledge = 0
  let issues = 0
  let foreshadows = 0

  db.transaction(() => {
    // Re-analysing a chapter must not erase the reader's manual decisions.
    // Remember ignored issues and paid/ignored foreshadows, then restore them
    // when the model reports the same item again.
    const priorIssues = new Map<string, string>()
    for (const raw of db
      .prepare(
        'SELECT type, detail, status FROM analysis_issues WHERE project_id = ? AND chapter_idx = ?'
      )
      .all(projectId, chapterIdx)) {
      const row = asRow(raw)
      if (str(row, 'status') !== 'ignored') continue
      priorIssues.set(`${str(row, 'type')}\u0000${str(row, 'detail')}`, 'ignored')
    }
    const priorForeshadows = new Map<string, string>()
    for (const raw of db
      .prepare(
        'SELECT text, status FROM analysis_foreshadows WHERE project_id = ? AND planted_chapter = ?'
      )
      .all(projectId, chapterIdx)) {
      const row = asRow(raw)
      const status = str(row, 'status')
      if (status !== 'paid' && status !== 'ignored') continue
      priorForeshadows.set(str(row, 'text'), status)
    }

    db.prepare('DELETE FROM analysis_events WHERE project_id = ? AND chapter_idx = ?').run(
      projectId,
      chapterIdx
    )
    db.prepare('DELETE FROM analysis_knowledge WHERE project_id = ? AND chapter_idx = ?').run(
      projectId,
      chapterIdx
    )
    db.prepare('DELETE FROM analysis_issues WHERE project_id = ? AND chapter_idx = ?').run(
      projectId,
      chapterIdx
    )
    db.prepare(
      'DELETE FROM analysis_foreshadows WHERE project_id = ? AND planted_chapter = ?'
    ).run(projectId, chapterIdx)

    const insertEvent = db.prepare(
      `INSERT INTO analysis_events (id, project_id, chapter_idx, story_time, title, detail, characters_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const event of input.events.slice(0, 40)) {
      const title = event.title.trim()
      const detail = event.detail.trim()
      if (!title && !detail) continue
      insertEvent.run(
        newId(),
        projectId,
        chapterIdx,
        event.storyTime.trim().slice(0, 80),
        (title || detail).slice(0, 200),
        detail.slice(0, 2000),
        JSON.stringify(event.characters.slice(0, 12).map((name) => name.slice(0, 40))),
        now
      )
      events += 1
    }

    const insertKnowledge = db.prepare(
      `INSERT INTO analysis_knowledge (id, project_id, chapter_idx, character, fact, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const fact of input.knowledge.slice(0, 60)) {
      const character = fact.character.trim().slice(0, 40)
      const text = fact.fact.trim().slice(0, 600)
      if (!character || !text) continue
      insertKnowledge.run(newId(), projectId, chapterIdx, character, text, now)
      knowledge += 1
    }

    const insertIssue = db.prepare(
      `INSERT INTO analysis_issues (id, project_id, chapter_idx, type, detail, quote, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const issue of input.issues.slice(0, 30)) {
      const detail = issue.detail.trim().slice(0, 600)
      if (!detail) continue
      const type = ISSUE_TYPES.includes(issue.type) ? issue.type : 'logic'
      insertIssue.run(
        newId(),
        projectId,
        chapterIdx,
        type,
        detail,
        issue.quote.trim().slice(0, 300),
        priorIssues.get(`${type}\u0000${detail}`) ?? 'open',
        now
      )
      issues += 1
    }

    const insertForeshadow = db.prepare(
      `INSERT INTO analysis_foreshadows (id, project_id, planted_chapter, payoff_chapter, text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of input.foreshadows.slice(0, 30)) {
      const text = item.text.trim().slice(0, 400)
      if (!text) continue
      const fromModel =
        item.status === 'paid' || item.status === 'ignored' ? item.status : 'open'
      insertForeshadow.run(
        newId(),
        projectId,
        chapterIdx,
        item.payoffChapter && item.payoffChapter > 0 ? item.payoffChapter : null,
        text,
        priorForeshadows.get(text) ?? fromModel,
        now
      )
      foreshadows += 1
    }

    db.prepare(
      'INSERT OR REPLACE INTO analysis_chapters (project_id, chapter_idx, analyzed_at) VALUES (?, ?, ?)'
    ).run(projectId, chapterIdx, now)
  })

  return { events, knowledge, issues, foreshadows }
}

export function setIssueStatus(
  db: DatabaseHandle,
  issueId: string,
  status: 'open' | 'ignored'
): void {
  db.prepare('UPDATE analysis_issues SET status = ? WHERE id = ?').run(status, issueId)
}

export function setForeshadowStatus(
  db: DatabaseHandle,
  foreshadowId: string,
  status: 'open' | 'paid' | 'ignored'
): void {
  db.prepare('UPDATE analysis_foreshadows SET status = ? WHERE id = ?').run(status, foreshadowId)
}

export function clearAnalysis(db: DatabaseHandle, projectId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM analysis_events WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM analysis_knowledge WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM analysis_issues WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM analysis_foreshadows WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM analysis_chapters WHERE project_id = ?').run(projectId)
  })
}
