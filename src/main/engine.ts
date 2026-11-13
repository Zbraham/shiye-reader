import { newId as randomUUID } from './ids'
import type {
  AppEvent,
  AppSettings,
  ApplyRewriteResult,
  BeatsResult,
  Chapter,
  ChapterMeta,
  ChapterOutline,
  ChapterStatus,
  Chunk,
  CreateProjectInput,
  Directive,
  DirectiveScope,
  ImportBookInput,
  JobInfo,
  ManualRewriteInput,
  PlotBeatsInput,
  PlotRewriteInput,
  PlotRewriteResult,
  PlotUnitResult,
  Project,
  RewriteEdit,
  RewritePreview,
  RewriteTarget,
  SelectTargetsResult,
  SetupDraft,
  StorySkeleton,
  TestModelResult
} from '@shared/types'
import { SETTINGS_LIMITS, isReadableStatus } from '@shared/constants'
import {
  countWords,
  estimateTokens,
  normalizeProse,
  stripMetaTrailer,
  stripModelMarkers,
  truncateByTokens
} from '@shared/text'
import { changedRatio } from '@shared/diff'
import { PlotPlanError, planPlot, type PlotPlan } from '@shared/plot/plan'
import { snapParagraphEnd } from '@shared/plot/select'
import { chunkChapter } from './text/chunker'
import { buildWritingContext, contextBudget } from './text/context'
import type { Writer } from './llm'
import { createWriter } from './llm'
import { AppError, CancelledError, EmptyResponseError, toReadableMessage } from './errors'
import { logError } from './logger'
import { TaskQueue } from './jobs/queue'
import type { DatabaseHandle } from './db/sqlite'
import {
  acceptStaleChapter,
  activeDirectives,
  addForeshadow,
  addNewFact,
  appendTimeline,
  clearChapterOutline,
  clearChapterSeed,
  createDirective,
  createImportedProject,
  createProject,
  deactivateDirective as deactivateDirectiveRepo,
  deactivatePlotDirectives,
  createVersion,
  deleteChapterAndShift,
  deleteProject,
  ensureChapter,
  ensureChapterRange,
  expireDirectives,
  failChapter,
  finishChapter,
  getChapterById,
  getChapterByIndex,
  getChapterSeed,
  getForeshadow,
  getPriorChapters,
  getProject,
  getVersion,
  interruptChapter,
  lastChapterIdxOf,
  listChapterMetas,
  listCharacters,
  listChunks,
  listStoryState,
  markDirectivesApplied,
  markSubsequentStale,
  pruneVersions,
  recordUsage,
  replaceChunks,
  requireChapter,
  requireProject,
  resolveForeshadow,
  restoreChapterSnapshot,
  savePartial,
  setChapterError,
  setChapterSeed,
  touchProject,
  updateChapterContent,
  updateChapterIssues,
  updateChapterOutline,
  updateChapterStatus,
  updateChapterSummary,
  setReadChapter,
  updateProject,
  updateReadCursor as saveReadCursor,
  usageSummary
} from './db/repo'

export interface EngineDeps {
  db: DatabaseHandle
  getSettings: () => AppSettings
  emit: (event: AppEvent) => void
}

interface ChapterSnapshot {
  content: string
  status: Chapter['status']
  wordCount: number
}

interface ChunkSnapshot {
  startOff: number
  endOff: number
  text: string
  hash: string
}

interface PendingPreview {
  id: string
  chapterId: string
  projectId: string
  chapterIdx: number
  chapterVersion: number
  instruction: string
  globalNote: string
  origin: 'model' | 'manual'
  baseContent: string
  beforeWordCount: number
  afterWordCount: number
  edits: RewriteEdit[]
  chunks: Map<string, ChunkSnapshot>
  manualRange: { start: number; end: number } | null
  createdAt: number
}

interface PlotBatchState {
  batchId: string
  projectId: string
  direction: string
  plan: PlotPlan
  directiveId: string
  /** Index into plan.units of the next unit to prepare. */
  nextIndex: number
  stopped: boolean
  chapterIds: Map<number, string>
  versions: Map<number, string | null>
}

interface EnqueueChapterOptions {
  urgent?: boolean
  regenerate?: boolean
  batchId?: string
  useSeed?: boolean
  skipArchive?: boolean
  originalStatus?: ChapterStatus
}

const PREVIEW_TTL = 30 * 60 * 1000
const TASK_TIMEOUT = 180_000
const STALE_THRESHOLD = 0.2

/** Hides model-only markers from the streaming view. */
function visibleStream(text: string): string {
  let result = ''
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('<!--', cursor)
    if (start < 0) {
      result += text.slice(cursor)
      break
    }
    result += text.slice(cursor, start)
    const end = text.indexOf('-->', start + 4)
    if (end < 0) break
    cursor = end + 3
  }
  return stripMetaTrailer(result)
}

function cleanProse(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toMeta(chapter: Chapter): ChapterMeta {
  return {
    id: chapter.id,
    projectId: chapter.projectId,
    idx: chapter.idx,
    title: chapter.title,
    status: chapter.status,
    wordCount: chapter.wordCount,
    summaryL2: chapter.summaryL2,
    version: chapter.version,
    staleReason: chapter.staleReason,
    error: chapter.error,
    updatedAt: chapter.updatedAt,
    volume: chapter.volume,
    level: chapter.level,
    lastOffsetRatio: chapter.lastOffsetRatio
  }
}

function displayIdOf(chapterIdx: number, chunkIdx: number): string {
  return `c${String(chapterIdx).padStart(2, '0')}-${String(chunkIdx).padStart(2, '0')}`
}

export class StoryEngine {
  readonly queue: TaskQueue
  private readonly previews = new Map<string, PendingPreview>()
  private readonly plotBatches = new Map<string, PlotBatchState>()
  private readonly chapterBatch = new Map<string, string>()

  constructor(private readonly deps: EngineDeps) {
    this.queue = new TaskQueue(
      deps.db,
      (jobs) => deps.emit({ type: 'jobs:changed', jobs }),
      (message) => deps.emit({ type: 'notice', tone: 'error', message })
    )
  }

  private get db(): DatabaseHandle {
    return this.deps.db
  }

  private get settings(): AppSettings {
    return this.deps.getSettings()
  }

  private writer(): Writer {
    return createWriter(this.settings)
  }

  /** Used by reader Q&A and book analysis, which need a plain completion. */
  get writerMode(): 'builtin' | 'openai' {
    return this.settings.provider === 'openai' ? 'openai' : 'builtin'
  }

  complete(system: string, user: string, signal: AbortSignal): Promise<string> {
    return this.writer().complete(system, user, signal)
  }

  private emit(event: AppEvent): void {
    this.deps.emit(event)
  }

  private emitChapterChanged(chapterId: string): ChapterMeta | null {
    const chapter = getChapterById(this.db, chapterId)
    if (!chapter) return null
    const meta = toMeta(chapter)
    this.emit({ type: 'chapter:changed', chapter: meta })
    return meta
  }

  private emitChapterContent(chapter: Chapter): void {
    this.emit({ type: 'chapter:content', chapter: toMeta(chapter), content: chapter.content })
  }

  private emitProjectsChanged(): void {
    this.emit({ type: 'projects:changed' })
  }

  private recordUsage(projectId: string, chapterIdx: number, task: string, promptTokens: number, completionTokens: number): void {
    recordUsage(this.db, projectId, chapterIdx, task, promptTokens, completionTokens)
    this.emit({ type: 'usage:changed', usage: usageSummary(this.db) })
  }

  /* ---------------------------------------------------------------- */
  /* Project lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  createBook(input: CreateProjectInput): Project {
    const project = createProject(this.db, input)
    this.emitProjectsChanged()
    this.ensureBuffer(project.id, 1)
    return requireProject(this.db, project.id)
  }

  /** Imports an already-written novel. Never calls the model or writes ahead. */
  importBook(input: ImportBookInput): Project {
    const project = createImportedProject(this.db, input)
    this.emitProjectsChanged()
    this.emit({ type: 'project:changed', project })
    return project
  }

  async createSkeleton(draft: SetupDraft): Promise<StorySkeleton> {
    return this.writer().writeSkeleton(draft, AbortSignal.timeout(TASK_TIMEOUT))
  }

  async testModel(baseUrl: string, apiKey: string, model: string): Promise<TestModelResult> {
    const writer = createWriter({
      ...this.settings,
      provider: 'openai',
      baseUrl,
      apiKey,
      model
    })
    return writer.test(AbortSignal.timeout(45_000))
  }

  async deleteBook(projectId: string): Promise<void> {
    await this.queue.cancelProjectWriters(projectId)
    deleteProject(this.db, projectId)
    this.emitProjectsChanged()
  }

  updateBookProject(
    projectId: string,
    patch: {
      title?: string
      styleSample?: string
      styleGuide?: string
      buffer?: number
      chapterMin?: number
      chapterMax?: number
    }
  ): Project {
    const project = updateProject(this.db, projectId, patch)
    this.emit({ type: 'project:changed', project })
    this.emitProjectsChanged()
    this.ensureBuffer(project.id, project.lastChapterIdx)
    return project
  }

  updateOutline(chapterId: string, outline: ChapterOutline): ChapterMeta {
    updateChapterOutline(this.db, chapterId, outline)
    updateChapterIssues(this.db, chapterId, [])
    this.emitChapterChanged(chapterId)
    this.emitProjectsChanged()
    return toMeta(requireChapter(this.db, chapterId))
  }

  /* ---------------------------------------------------------------- */
  /* Generation                                                        */
  /* ---------------------------------------------------------------- */

  enqueueChapter(
    projectId: string,
    idx: number,
    options: EnqueueChapterOptions = {}
  ): void {
    requireProject(this.db, projectId)
    const chapter = ensureChapter(this.db, projectId, idx)
    const key = `chapter:${chapter.id}`
    if (this.queue.hasKey(key)) return

    const originalStatus = options.originalStatus ?? chapter.status
    if (!options.regenerate) {
      if (chapter.status !== 'outline' && chapter.status !== 'queued') return
      if (chapter.status === 'outline') {
        updateChapterStatus(this.db, chapter.id, 'queued')
      }
    } else if (chapter.status !== 'queued' && chapter.status !== 'generating') {
      updateChapterStatus(this.db, chapter.id, 'queued')
    }

    this.emitChapterChanged(chapter.id)
    this.queue.enqueue({
      key,
      lane: 'writer',
      urgent: options.urgent ?? false,
      title: `第${idx}章 · ${chapter.title}`,
      type: 'chapter',
      projectId,
      chapterId: chapter.id,
      run: async (signal) => {
        try {
          await this.runChapter(chapter.id, signal, {
            regenerate: options.regenerate ?? false,
            originalStatus,
            batchId: options.batchId,
            useSeed: options.useSeed ?? false,
            skipArchive: options.skipArchive ?? false
          })
          if (options.batchId) this.advancePlotBatch(options.batchId, chapter.id)
        } catch (error) {
          if (options.batchId) {
            this.failPlotBatch(
              options.batchId,
              error instanceof Error ? error.message : '这一批改写没有完成。'
            )
          }
          throw error
        }
      }
    })
  }

  /** Keeps the read window and its buffer written ahead. */
  ensureBuffer(projectId: string, readIdx: number): void {
    const project = getProject(this.db, projectId)
    if (!project || project.source === 'imported') return
    const buffer = Math.min(3, Math.max(1, project.buffer))
    const upto = Math.min(SETTINGS_LIMITS.chaptersMax, Math.max(1, readIdx) + buffer)
    ensureChapterRange(this.db, projectId, upto)
    for (let idx = Math.max(1, readIdx); idx <= upto; idx += 1) {
      const chapter = getChapterByIndex(this.db, projectId, idx)
      if (!chapter) continue
      if (chapter.status === 'outline' || chapter.status === 'queued') {
        this.enqueueChapter(projectId, idx, { urgent: idx <= readIdx })
      }
    }
  }

  enterReader(projectId: string, chapterIdx: number): void {
    const project = requireProject(this.db, projectId)
    if (project.source !== 'imported') {
      const buffer = Math.min(3, Math.max(1, project.buffer))
      ensureChapterRange(
        this.db,
        projectId,
        Math.min(SETTINGS_LIMITS.chaptersMax, chapterIdx + buffer)
      )
      this.ensureBuffer(projectId, chapterIdx)
    }
    // Navigation only moves the "continue reading" pointer. Writing the
    // previous chapter's ratio onto the destination row made the next chapter
    // open near its end, and would also overwrite the position the reader had
    // already saved for it.
    if (project.lastChapterIdx !== chapterIdx) {
      setReadChapter(this.db, projectId, chapterIdx)
    }
    this.emit({ type: 'project:changed', project: requireProject(this.db, projectId) })
  }

  updateReadCursor(projectId: string, chapterIdx: number, ratio: number): void {
    const project = requireProject(this.db, projectId)
    saveReadCursor(this.db, projectId, chapterIdx, ratio)
    if (project.source !== 'imported') this.ensureBuffer(projectId, chapterIdx)
    this.emit({ type: 'project:changed', project: requireProject(this.db, projectId) })
  }

  private async runChapter(
    chapterId: string,
    signal: AbortSignal,
    options: {
      regenerate: boolean
      originalStatus?: ChapterStatus
      batchId?: string
      useSeed?: boolean
      skipArchive?: boolean
    }
  ): Promise<void> {
    let chapter = requireChapter(this.db, chapterId)
    const project = requireProject(this.db, chapter.projectId)
    const writer = this.writer()
    const originalStatus =
      options.originalStatus && isReadableStatus(options.originalStatus)
        ? options.originalStatus
        : chapter.content
          ? 'final'
          : 'outline'
    const snapshot: ChapterSnapshot | null = chapter.content
      ? { content: chapter.content, status: originalStatus, wordCount: chapter.wordCount }
      : null

    if (snapshot && options.regenerate && !options.skipArchive) {
      createVersion(
        this.db,
        chapterId,
        snapshot.content,
        null,
        '重写前存档',
        snapshot.wordCount,
        snapshot.wordCount
      )
      pruneVersions(this.db, chapterId)
    }

    const seed =
      options.useSeed && chapter.content
        ? getChapterSeed(this.db, chapterId).trim()
        : ''
    const seedBase = seed ? `${seed.replace(/\s+$/u, '')}\n\n` : ''
    const seedWords = countWords(seed)

    chapter = this.markGenerating(chapter)
    this.emitChapterChanged(chapterId)

    // Cancelling while the outline is still being written never reaches the
    // streaming try/catch below, so put the chapter back explicitly.
    const recoverBeforeStream = (): void => {
      if (snapshot) {
        const restored = restoreChapterSnapshot(
          this.db,
          chapterId,
          snapshot.content,
          snapshot.status,
          ''
        )
        this.emitChapterContent(restored)
        this.emitChapterChanged(chapterId)
      } else {
        const draft = interruptChapter(this.db, chapterId, '')
        this.emitChapterChanged(draft.id)
        this.emitChapterContent(draft)
      }
      clearChapterSeed(this.db, chapterId)
    }

    const prior = getPriorChapters(this.db, project.id, chapter.idx)
    const characters = listCharacters(this.db, project.id)
    const storyState = listStoryState(this.db, project.id)
    const foreshadow = getForeshadow(this.db, project.id)
    const directives = activeDirectives(this.db, project.id, chapter.idx)

    let outline = chapter.outline
    if (!outline || outline.goals.length === 0) {
      try {
        outline = await writer.writeOutline(
          {
            project,
            characters: characters.map((character) => ({
              name: character.name,
              profile: character.profile,
              state: [character.state.location, character.state.condition, character.state.intent]
                .filter(Boolean)
                .join('；')
            })),
            idx: chapter.idx,
            recentSummaries: prior.slice(-4).map(
              (item) =>
                `第${item.idx}章：${truncateByTokens(item.summaryL1 || item.content, 130)}`
            ),
            previousHook: prior[prior.length - 1]?.summaryL2 ?? '',
            directives: directives.map((directive) => directive.content),
            planned: chapter.outline
              ? {
                  title: chapter.outline.title,
                  goals: chapter.outline.goals,
                  hook: chapter.outline.hook
                }
              : null
          },
          signal
        )
        chapter = updateChapterOutline(this.db, chapterId, outline)
      } catch (error) {
        if (signal.aborted) {
          recoverBeforeStream()
          throw new CancelledError()
        }
        logError('outline', error)
        outline = null
      }
    }

    if (signal.aborted) {
      recoverBeforeStream()
      throw new CancelledError()
    }

    const minWords = Math.max(400, project.chapterMin - seedWords)
    const maxWords = Math.max(minWords + 100, project.chapterMax - seedWords)
    const previous = prior[prior.length - 1]
    const prompt = buildWritingContext({
      project: {
        title: project.title,
        genre: project.genre,
        tone: project.tone,
        pov: project.pov,
        styleGuide: project.styleGuide,
        styleSample: project.styleSample,
        targetLenPerChapter: project.targetLenPerChapter,
        synopsis: project.synopsis,
        sellingPoint: project.sellingPoint
      },
      characters,
      storyState,
      foreshadow,
      directives,
      priorChapters: prior.map((item) => ({
        idx: item.idx,
        title: item.title,
        content: item.content,
        summaryL1: item.summaryL1,
        summaryL2: item.summaryL2,
        outline: item.outline
      })),
      currentIdx: chapter.idx,
      currentTitle: chapter.title,
      currentOutline: outline,
      seedText: seed || undefined,
      minWords,
      maxWords,
      tokenBudget: contextBudget(this.settings.contextWindow)
    })

    this.emit({
      type: 'chapter:reset',
      chapterId,
      projectId: project.id,
      idx: chapter.idx,
      base: seed || undefined
    })

    let output = ''
    let sent = ''
    let pending = ''
    let lastFlush = 0
    let lastPersist = Date.now()

    const flush = (): void => {
      if (!pending) return
      this.emit({
        type: 'chapter:delta',
        chapterId,
        projectId: project.id,
        idx: chapter.idx,
        text: pending,
        chars: countWords(output)
      })
      pending = ''
    }

    const onDelta = (delta: string): void => {
      output += delta
      const clean = visibleStream(output)
      if (clean.length >= sent.length) {
        pending += clean.slice(sent.length)
      } else {
        // A marker was removed from the tail; retract and resend.
        pending = ''
        this.emit({
          type: 'chapter:reset',
          chapterId,
          projectId: project.id,
          idx: chapter.idx,
          base: seed || undefined
        })
        pending = clean
      }
      sent = clean
      const now = Date.now()
      if (now - lastFlush >= 50) {
        lastFlush = now
        flush()
      }
      if (now - lastPersist >= 2000) {
        lastPersist = now
        savePartial(this.db, chapterId, `${seedBase}${cleanProse(output)}`)
      }
    }

    const previousTail = seed
      ? truncateByTokens(seed, 700, 'tail')
      : previous
        ? truncateByTokens(previous.content, 700, 'tail')
        : ''
    const writeInput = {
      prompt,
      project,
      characters: characters.map((character) => ({
        name: character.name,
        profile: character.profile
      })),
      chapterIdx: chapter.idx,
      chapterTitle: chapter.title,
      outline,
      previousTail,
      minWords,
      maxWords
    }

    let finalText = ''
    let lastRaw = ''
    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        output = ''
        sent = ''
        pending = ''
        lastRaw = await writer.streamChapter(writeInput, onDelta, signal)
        flush()
        finalText = normalizeProse(stripModelMarkers(lastRaw).text)
        if (countWords(finalText) >= 60) break
        if (attempt === 2) throw new EmptyResponseError()
        this.emit({
          type: 'chapter:reset',
          chapterId,
          projectId: project.id,
          idx: chapter.idx,
          base: seed || undefined
        })
      }

      if (!finalText) throw new EmptyResponseError()
      const stripped = stripModelMarkers(lastRaw)
      const facts = stripped.facts
      finalText = normalizeProse(stripped.text)
      if (countWords(finalText) < 60) throw new EmptyResponseError()
      if (seedBase) finalText = cleanProse(`${seedBase}${finalText}`)

      const finished = finishChapter(this.db, chapterId, finalText)
      clearChapterSeed(this.db, chapterId)
      this.rebuildChunks(finished)
      for (const fact of facts) {
        addNewFact(this.db, project.id, chapter.idx, fact.key, fact.value)
      }
      markDirectivesApplied(this.db, project.id, chapter.idx)
      expireDirectives(this.db, project.id, chapter.idx)
      touchProject(this.db, project.id)

      this.emitChapterContent(finished)
      this.emitChapterChanged(chapterId)
      this.emit({ type: 'directives:changed', projectId: project.id })
      this.emitProjectsChanged()

      this.recordUsage(
        project.id,
        chapter.idx,
        'chapter',
        prompt.tokens,
        estimateTokens(finalText)
      )

      this.enqueueSummary(chapterId)
      if (this.settings.consistencyCheck) this.enqueueCheck(chapterId)
      if (!options.batchId) {
        const fresh = requireProject(this.db, project.id)
        this.ensureBuffer(project.id, fresh.lastChapterIdx)
      }
    } catch (error) {
      const cancelled = signal.aborted || error instanceof CancelledError
        || (error instanceof Error && error.name === 'AbortError')
      const partial = normalizeProse(stripModelMarkers(output).text)
      const usable = countWords(partial) >= 30
      const partialWithSeed = seedBase ? cleanProse(`${seedBase}${partial}`) : partial

      try {
        if (cancelled) {
          if (usable) {
            const draft = interruptChapter(this.db, chapterId, partialWithSeed)
            this.rebuildChunks(draft)
            this.emitChapterContent(draft)
            this.emitChapterChanged(chapterId)
          } else if (snapshot) {
            const restored = restoreChapterSnapshot(
              this.db,
              chapterId,
              snapshot.content,
              snapshot.status,
              ''
            )
            this.emitChapterContent(restored)
            this.emitChapterChanged(chapterId)
          } else {
            const draft = interruptChapter(this.db, chapterId, '')
            this.emitChapterChanged(draft.id)
            this.emitChapterContent(draft)
          }
          clearChapterSeed(this.db, chapterId)
          throw new CancelledError()
        }

        const message = toReadableMessage(error)
        if (usable) {
          const draft = failChapter(this.db, chapterId, partialWithSeed, message)
          this.rebuildChunks(draft)
          this.emitChapterContent(draft)
          this.emitChapterChanged(chapterId)
        } else if (snapshot) {
          const restored = restoreChapterSnapshot(
            this.db,
            chapterId,
            snapshot.content,
            snapshot.status,
            message
          )
          this.emitChapterContent(restored)
          this.emitChapterChanged(chapterId)
        } else {
          const current = requireChapter(this.db, chapterId)
          if (current.status === 'generating') {
            updateChapterStatus(this.db, chapterId, 'draft')
          }
          setChapterError(this.db, chapterId, message)
          this.emitChapterChanged(chapterId)
        }
        clearChapterSeed(this.db, chapterId)
        this.emitProjectsChanged()
      } catch (handlerError) {
        logError('chapter-recovery', handlerError)
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private markGenerating(chapter: Chapter): Chapter {
    let current = chapter
    if (current.status !== 'generating') {
      if (current.status !== 'queued') {
        current = updateChapterStatus(this.db, chapter.id, 'queued')
      }
      current = updateChapterStatus(this.db, chapter.id, 'generating')
    }
    return current
  }

  private rebuildChunks(chapter: Chapter): Chunk[] {
    const chunks = chunkChapter(chapter.content)
    replaceChunks(this.db, chapter, chunks)
    return listChunks(this.db, chapter.id)
  }

  /* ---------------------------------------------------------------- */
  /* Utility jobs                                                      */
  /* ---------------------------------------------------------------- */

  private enqueueSummary(chapterId: string): void {
    const chapter = getChapterById(this.db, chapterId)
    if (!chapter || !chapter.content) return
    const key = `summary:${chapterId}`
    if (this.queue.hasKey(key)) return
    const project = requireProject(this.db, chapter.projectId)
    this.queue.enqueue({
      key,
      lane: 'utility',
      title: `整理第${chapter.idx}章纪要`,
      type: 'summary',
      projectId: project.id,
      chapterId,
      run: async (signal) => {
        const summary = await this.writer().summarize(
          {
            project,
            chapterIdx: chapter.idx,
            chapterTitle: chapter.title,
            content: chapter.content,
            characterNames: listCharacters(this.db, project.id).map((item) => item.name)
          },
          signal
        )
        const l1 = [summary.who_did_what, summary.relationship_change, summary.new_info]
          .filter((part) => part.trim().length > 0)
          .join('；')
        const l2 = [summary.who_did_what, summary.ending_hook]
          .filter((part) => part.trim().length > 0)
          .join('；')
        updateChapterSummary(this.db, chapterId, l1.slice(0, 500), l2.slice(0, 160))
        for (const item of summary.foreshadow_planted) {
          addForeshadow(this.db, project.id, item, chapter.idx)
        }
        for (const item of summary.foreshadow_paid) {
          resolveForeshadow(this.db, project.id, item)
        }
        if (summary.new_info.trim()) {
          appendTimeline(this.db, project.id, chapter.idx, summary.new_info)
        }
        this.emitChapterChanged(chapterId)
        this.emit({ type: 'projects:changed' })
      }
    })
  }

  private enqueueCheck(chapterId: string): void {
    const chapter = getChapterById(this.db, chapterId)
    if (!chapter || !chapter.content) return
    const key = `check:${chapterId}`
    if (this.queue.hasKey(key)) return
    const project = requireProject(this.db, chapter.projectId)
    const characters = listCharacters(this.db, project.id)
    const storyState = listStoryState(this.db, project.id)
    const setting = [
      `《${project.title}》题材：${project.genre}，基调：${project.tone}，视角：${project.pov}`,
      `人物：${characters
        .map((character) => `${character.name}（${truncateByTokens(character.profile, 60)}）`)
        .join('；')}`,
      ...storyState
        .filter((entry) => entry.value.trim() && entry.key !== '伏笔')
        .slice(0, 6)
        .map((entry) => `${entry.key}：${truncateByTokens(entry.value, 160)}`)
    ].join('\n')

    this.queue.enqueue({
      key,
      lane: 'utility',
      title: `核对第${chapter.idx}章`,
      type: 'check',
      projectId: project.id,
      chapterId,
      run: async (signal) => {
        const issues = await this.writer().check(
          { setting, chapterTitle: chapter.title, content: chapter.content },
          signal
        )
        updateChapterIssues(this.db, chapterId, issues)
        this.emitChapterChanged(chapterId)
      }
    })
  }

  async beats(projectId: string, chapterIdx: number): Promise<BeatsResult> {
    const project = requireProject(this.db, projectId)
    if (project.source !== 'imported') {
      ensureChapterRange(this.db, projectId, chapterIdx)
    }
    const prior = getPriorChapters(this.db, projectId, chapterIdx)
    const beats = await this.writer().beats(
      {
        project,
        idx: chapterIdx,
        recent: prior
          .slice(-5)
          .map((item) => `第${item.idx}章：${item.summaryL1 || truncateByTokens(item.content, 100)}`)
          .join('\n'),
        lastContent: truncateByTokens(prior[prior.length - 1]?.content ?? '', 600, 'tail'),
        characterNames: listCharacters(this.db, projectId).map((item) => item.name)
      },
      AbortSignal.timeout(TASK_TIMEOUT)
    )
    return { beats }
  }

  /* ---------------------------------------------------------------- */
  /* Plot continuation                                                 */
  /* ---------------------------------------------------------------- */

  async plotBeats(input: PlotBeatsInput): Promise<BeatsResult> {
    const project = requireProject(this.db, input.projectId)
    const anchor = getChapterByIndex(this.db, project.id, input.fromIdx)
    if (!anchor) throw new AppError('not_found', '起点章节不存在，请刷新目录后重试。')
    if (input.startMode === 'after' || input.startMode === 'paragraph') {
      if (!anchor.content.trim()) {
        throw new AppError('empty', '这一章还没有正文，无法据此续写。')
      }
    }
    let seed = ''
    if (input.startMode === 'paragraph') {
      const offset = input.startOffset ?? 0
      if (offset <= 0 || offset >= anchor.content.length) {
        throw new AppError('invalid', '请选择本章中的一段文字作为改写起点。')
      }
      seed = anchor.content.slice(0, offset)
    }

    const targetIdx = input.startMode === 'after' ? input.fromIdx + 1 : input.fromIdx
    const prior = getPriorChapters(
      this.db,
      project.id,
      input.startMode === 'after' ? input.fromIdx + 1 : input.fromIdx
    )
    const recent = prior
      .slice(-5)
      .map(
        (item) =>
          `第${item.idx}章：${item.summaryL1 || item.summaryL2 || truncateByTokens(item.content, 100)}`
      )
      .join('\n')
    const lastContent =
      input.startMode === 'after'
        ? truncateByTokens(anchor.content, 600, 'tail')
        : input.startMode === 'paragraph'
          ? truncateByTokens(seed, 600, 'tail')
          : truncateByTokens(prior[prior.length - 1]?.content ?? '', 600, 'tail')

    const beats = await this.writer().beats(
      {
        project,
        idx: targetIdx,
        recent,
        lastContent,
        characterNames: listCharacters(this.db, project.id).map((item) => item.name)
      },
      AbortSignal.timeout(TASK_TIMEOUT)
    )
    return { beats }
  }

  async plotRewrite(input: PlotRewriteInput): Promise<PlotRewriteResult> {
    const project = requireProject(this.db, input.projectId)
    const direction = input.direction.trim()
    if (!direction) throw new AppError('invalid', '先写一句希望故事往哪走。')
    for (const batch of this.plotBatches.values()) {
      if (batch.projectId === project.id) {
        throw new AppError('busy', '上一批改写还没有结束，请等它完成或先停止。')
      }
    }

    const chapterCount = lastChapterIdxOf(this.db, project.id)
    const anchor = getChapterByIndex(this.db, project.id, input.fromIdx)
    if (!anchor) throw new AppError('not_found', '起点章节不存在，请刷新目录后重试。')
    if (anchor.status === 'queued' || anchor.status === 'generating') {
      throw new AppError('busy', '这一章正在写入，请等它写完再改后续。')
    }
    if (input.startMode !== 'include' && !anchor.content.trim()) {
      throw new AppError('empty', '这一章还没有正文，无法保留后改写。')
    }
    if (input.startMode === 'paragraph') {
      const offset = input.startOffset ?? 0
      if (offset <= 0 || offset >= anchor.content.length) {
        throw new AppError('invalid', '请选择本章中靠前的段落作为起点。')
      }
      if (snapParagraphEnd(anchor.content, offset) !== offset) {
        throw new AppError('invalid', '改写起点要落在段末，请重新选择。')
      }
    }

    let plan: PlotPlan
    try {
      plan = planPlot({
        fromIdx: input.fromIdx,
        startMode: input.startMode,
        startOffset: input.startOffset,
        chapterCount,
        batchSize: 3
      })
    } catch (error) {
      if (error instanceof PlotPlanError) throw new AppError('invalid', error.message)
      throw error
    }

    const affected = await this.queue.cancelProjectWriters(project.id)
    for (const chapterId of affected) {
      this.restoreQueuedChapter(chapterId)
    }

    ensureChapterRange(this.db, project.id, plan.replaceTo)
    for (const unit of plan.units) {
      const chapter = getChapterByIndex(this.db, project.id, unit.chapterIdx)
      if (!chapter) continue
      await this.queue.cancelKeyAndWait(`summary:${chapter.id}`)
      await this.queue.cancelKeyAndWait(`check:${chapter.id}`)
    }

    const reason = `改后续：${direction.slice(0, 40)}`
    const versions = new Map<number, string | null>()
    this.db.transaction(() => {
      for (const idx of plan.archived) {
        const chapter = getChapterByIndex(this.db, project.id, idx)
        if (!chapter || !chapter.content.trim()) {
          versions.set(idx, null)
          continue
        }
        const version = createVersion(
          this.db,
          chapter.id,
          chapter.content,
          null,
          reason,
          chapter.wordCount,
          chapter.wordCount
        )
        pruneVersions(this.db, chapter.id)
        versions.set(idx, version.id)
      }
    })

    deactivatePlotDirectives(this.db, project.id)
    const directive = createDirective(
      this.db,
      project.id,
      '后续3章',
      direction,
      plan.units[0].chapterIdx,
      {
        startChapter: plan.directive.starts,
        expiresChapter: plan.directive.expires,
        origin: 'plot'
      }
    )
    const stale = markSubsequentStale(
      this.db,
      project.id,
      plan.replaceTo,
      '前文已按新方向改写，待跟进'
    )

    const batch: PlotBatchState = {
      batchId: randomUUID(),
      projectId: project.id,
      direction,
      plan,
      directiveId: directive.id,
      nextIndex: 0,
      stopped: false,
      chapterIds: new Map(),
      versions
    }
    for (const unit of plan.units) {
      const chapter = ensureChapter(this.db, project.id, unit.chapterIdx)
      batch.chapterIds.set(unit.chapterIdx, chapter.id)
    }
    this.plotBatches.set(batch.batchId, batch)

    const units: PlotUnitResult[] = plan.units.map((unit, index) => ({
      idx: unit.chapterIdx,
      chapterId: batch.chapterIds.get(unit.chapterIdx) ?? '',
      mode:
        unit.chapterIdx > chapterCount
          ? 'created'
          : input.startMode === 'paragraph' && index === 0
            ? 'seeded'
            : 'replaced',
      versionId: versions.get(unit.chapterIdx) ?? null
    }))

    touchProject(this.db, project.id)
    this.emit({ type: 'directives:changed', projectId: project.id })
    this.emitStaleChanged(project.id, stale)
    this.emitProjectsChanged()
    this.emit({
      type: 'plot:batch',
      batchId: batch.batchId,
      projectId: project.id,
      status: 'running',
      unitIdx: plan.units[0].chapterIdx
    })

    try {
      this.preparePlotUnit(batch, 0)
    } catch (error) {
      this.failPlotBatch(
        batch.batchId,
        error instanceof Error ? error.message : '无法启动这一批改写。'
      )
      throw error
    }

    return {
      batchId: batch.batchId,
      directiveId: directive.id,
      units,
      replaceTo: plan.replaceTo,
      staleFrom: plan.staleFrom
    }
  }

  async plotCancel(projectId: string, batchId: string): Promise<void> {
    const batch = this.plotBatches.get(batchId)
    if (!batch || batch.projectId !== projectId) {
      throw new AppError('not_found', '这一批改写已经结束。')
    }
    batch.stopped = true
    const currentIndex = Math.min(Math.max(0, batch.nextIndex - 1), 2)
    const unit = batch.plan.units[currentIndex]
    const chapterId = unit ? batch.chapterIds.get(unit.chapterIdx) : undefined
    if (chapterId) {
      await this.queue.cancelKeyAndWait(`chapter:${chapterId}`)
      clearChapterSeed(this.db, chapterId)
      this.restoreQueuedChapter(chapterId)
      this.emitChapterChanged(chapterId)
    }
    deactivateDirectiveRepo(this.db, projectId, batch.directiveId)
    this.disposePlotBatch(batch)
    this.emit({ type: 'directives:changed', projectId })
    this.emit({
      type: 'plot:batch',
      batchId,
      projectId,
      status: 'stopped',
      unitIdx: unit?.chapterIdx ?? 0
    })
    this.emitProjectsChanged()
  }

  private preparePlotUnit(batch: PlotBatchState, index: number): void {
    const unit = batch.plan.units[index]
    if (!unit) throw new AppError('invalid', '这一批改写的章节范围不完整。')
    const chapter = ensureChapter(this.db, batch.projectId, unit.chapterIdx)
    batch.chapterIds.set(unit.chapterIdx, chapter.id)
    batch.nextIndex = index + 1
    this.chapterBatch.set(chapter.id, batch.batchId)
    clearChapterOutline(this.db, chapter.id)

    if (unit.keepPrefixChars > 0) {
      const current = requireChapter(this.db, chapter.id)
      const seed = current.content.slice(0, unit.keepPrefixChars).replace(/\s+$/u, '')
      if (!seed) {
        throw new AppError('empty', '保留的开头是空的，请重新选择段落。')
      }
      setChapterSeed(this.db, chapter.id, seed)
      updateChapterOutline(this.db, chapter.id, {
        title: current.title,
        goals: ['承接已给出的开头，继续写完本章'],
        advance: [],
        forbidden: ['不要重复、改写或总结已给出的开头'],
        hook: '留下推动下一章的钩子'
      })
    }

    this.enqueueChapter(batch.projectId, unit.chapterIdx, {
      urgent: true,
      regenerate: true,
      batchId: batch.batchId,
      useSeed: unit.keepPrefixChars > 0,
      skipArchive: true,
      originalStatus: chapter.status
    })
  }

  private advancePlotBatch(batchId: string, chapterId: string): void {
    const batch = this.plotBatches.get(batchId)
    if (!batch || batch.stopped) return
    const completed = batch.plan.units[batch.nextIndex - 1]
    if (!completed || batch.chapterIds.get(completed.chapterIdx) !== chapterId) return
    this.chapterBatch.delete(chapterId)
    if (batch.nextIndex >= batch.plan.units.length) {
      this.finishPlotBatch(batch)
      return
    }
    try {
      this.preparePlotUnit(batch, batch.nextIndex)
    } catch (error) {
      this.failPlotBatch(
        batchId,
        error instanceof Error ? error.message : '下一章没能开始。'
      )
    }
  }

  private finishPlotBatch(batch: PlotBatchState): void {
    deactivateDirectiveRepo(this.db, batch.projectId, batch.directiveId)
    this.disposePlotBatch(batch)
    this.emit({ type: 'directives:changed', projectId: batch.projectId })
    this.emit({
      type: 'plot:batch',
      batchId: batch.batchId,
      projectId: batch.projectId,
      status: 'done',
      unitIdx: batch.plan.replaceTo
    })
    this.emitProjectsChanged()
  }

  private failPlotBatch(batchId: string, message: string): void {
    const batch = this.plotBatches.get(batchId)
    if (!batch) return
    const wasStopped = batch.stopped
    batch.stopped = true
    for (const chapterId of batch.chapterIds.values()) {
      clearChapterSeed(this.db, chapterId)
    }
    deactivateDirectiveRepo(this.db, batch.projectId, batch.directiveId)
    this.disposePlotBatch(batch)
    this.emit({ type: 'directives:changed', projectId: batch.projectId })
    if (!wasStopped) {
      this.emit({
        type: 'plot:batch',
        batchId,
        projectId: batch.projectId,
        status: 'failed',
        unitIdx: batch.plan.units[Math.min(batch.nextIndex - 1, 2)]?.chapterIdx ?? 0,
        message: message.slice(0, 120)
      })
    }
    this.emitProjectsChanged()
  }

  private disposePlotBatch(batch: PlotBatchState): void {
    this.plotBatches.delete(batch.batchId)
    for (const chapterId of batch.chapterIds.values()) {
      if (this.chapterBatch.get(chapterId) === batch.batchId) {
        this.chapterBatch.delete(chapterId)
      }
    }
  }

  private restoreQueuedChapter(chapterId: string): void {
    const chapter = getChapterById(this.db, chapterId)
    if (!chapter || chapter.status !== 'queued') return
    updateChapterStatus(this.db, chapterId, chapter.content ? 'final' : 'outline')
    this.emitChapterChanged(chapterId)
  }

  /* ---------------------------------------------------------------- */
  /* Directives                                                        */
  /* ---------------------------------------------------------------- */

  createDirective(projectId: string, scope: DirectiveScope, content: string): Directive {
    const project = requireProject(this.db, projectId)
    const directive = createDirective(this.db, projectId, scope, content, project.lastChapterIdx)
    this.emit({ type: 'directives:changed', projectId })
    void this.requeueForDirective(projectId)
    return directive
  }

  private async requeueForDirective(projectId: string): Promise<void> {
    const affected = await this.queue.cancelProjectWriters(projectId)
    for (const chapterId of affected) {
      const chapter = getChapterById(this.db, chapterId)
      if (!chapter) continue
      this.enqueueChapter(chapter.projectId, chapter.idx, {
        urgent: true,
        regenerate: true
      })
    }
    const project = getProject(this.db, projectId)
    if (project) this.ensureBuffer(projectId, Math.max(1, project.lastChapterIdx))
    this.emit({ type: 'directives:changed', projectId })
  }

  deactivateDirective(projectId: string, directiveId: string): void {
    deactivateDirectiveRepo(this.db, projectId, directiveId)
    this.emit({ type: 'directives:changed', projectId })
  }

  /* ---------------------------------------------------------------- */
  /* Rewrite                                                           */
  /* ---------------------------------------------------------------- */

  async selectTargets(chapterId: string, instruction: string): Promise<SelectTargetsResult> {
    const chapter = requireChapter(this.db, chapterId)
    const chunks = this.usableChunks(chapterId)
    if (chunks.length === 0) {
      throw new AppError('empty', '这一章还没有可分段的正文。')
    }
    const writer = this.writer()
    const selected = await writer.selectTargets(
      {
        chapterIdx: chapter.idx,
        chapterTitle: chapter.title,
        outline: chapter.outline,
        chunks,
        instruction,
        maxTargets: SETTINGS_LIMITS.rewriteTargetsMax
      },
      AbortSignal.timeout(TASK_TIMEOUT)
    )
    let targets = selected.targets
    if (chunks.length > 14 && targets.length > 0) {
      try {
        const verified = await writer.verifyTargets(
          {
            chapterIdx: chapter.idx,
            instruction,
            chunks,
            candidates: targets
          },
          AbortSignal.timeout(TASK_TIMEOUT)
        )
        const keep = new Set(verified)
        const filtered = targets.filter((target) => keep.has(target.chunkId))
        if (filtered.length > 0) targets = filtered
      } catch {
        // Verification is best-effort; keep the coarse selection.
      }
    }
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
    const hydrated = targets
      .map((target) => {
        const chunk = byId.get(target.chunkId)
        if (!chunk) return null
        const item: RewriteTarget = {
          chunkId: chunk.id,
          displayId: target.displayId || displayIdOf(chapter.idx, chunk.idx),
          idx: chunk.idx,
          text: chunk.text,
          roleTag: chunk.roleTag,
          action: target.action === 'move' ? 'rewrite' : target.action,
          reason: target.reason,
          hint: target.hint
        }
        return item
      })
      .filter((item): item is RewriteTarget => item !== null)
      .slice(0, SETTINGS_LIMITS.rewriteTargetsMax)
    return { targets: hydrated, globalNote: selected.globalNote }
  }

  async previewRewrite(
    chapterId: string,
    instruction: string,
    targetIds: string[]
  ): Promise<RewritePreview> {
    const chapter = requireChapter(this.db, chapterId)
    let targets: RewriteTarget[]
    let globalNote = ''
    if (targetIds.length > 0) {
      const chunks = this.usableChunks(chapterId)
      const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
      targets = targetIds
        .map((id) => byId.get(id))
        .filter((chunk): chunk is Chunk => Boolean(chunk))
        .map((chunk) => ({
          chunkId: chunk.id,
          displayId: displayIdOf(chapter.idx, chunk.idx),
          idx: chunk.idx,
          text: chunk.text,
          roleTag: chunk.roleTag,
          action: 'rewrite' as const,
          reason: '',
          hint: instruction
        }))
        .slice(0, SETTINGS_LIMITS.rewriteTargetsMax)
      globalNote = '只改写选中的段落，前后文保持不动。'
    } else {
      const selected = await this.selectTargets(chapterId, instruction)
      targets = selected.targets
      globalNote = selected.globalNote
    }
    if (targets.length === 0) {
      throw new AppError('no_target', '没有找到需要改动的段落。换个说法再试。')
    }

    const chunks = this.usableChunks(chapterId)
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
    const writer = this.writer()
    const base = chapter.content
    const snapshots = new Map<string, ChunkSnapshot>()
    const edits: RewriteEdit[] = []

    for (const target of targets) {
      const chunk = byId.get(target.chunkId)
      if (!chunk) continue
      snapshots.set(chunk.id, {
        startOff: chunk.startOff,
        endOff: chunk.endOff,
        text: chunk.text,
        hash: chunk.hash
      })
      const previous = chunks.find((item) => item.idx === chunk.idx - 1)
      const next = chunks.find((item) => item.idx === chunk.idx + 1)
      let after = ''
      if (target.action === 'delete') {
        after = ''
      } else {
        try {
          const rewritten = await writer.rewriteChunk(
            {
              instruction:
                target.action === 'insert_after'
                  ? `只写要插入的新段落，不要重复原段落。${instruction}`
                  : instruction,
              hint: target.hint || instruction,
              roleTag: target.roleTag,
              before: previous?.text ?? '',
              after: next?.text ?? '',
              original: chunk.text,
              chapterTitle: chapter.title
            },
            AbortSignal.timeout(TASK_TIMEOUT)
          )
          after = stripMetaTrailer(rewritten).trim()
        } catch (error) {
          if (error instanceof CancelledError) throw error
          logError('rewrite-chunk', error)
          continue
        }
      }
      if (target.action !== 'delete' && (!after || after === chunk.text.trim())) continue
      edits.push({
        chunkId: chunk.id,
        displayId: target.displayId,
        action: target.action,
        before: chunk.text,
        after,
        reason: target.reason,
        hint: target.hint,
        moveAfterId: ''
      })
    }

    if (edits.length === 0) {
      throw new AppError('no_change', '模型没有给出有效的改动。可以补充要求后重试。')
    }

    const afterContent = this.compose(base, snapshots, edits)
    const preview: PendingPreview = {
      id: randomUUID(),
      chapterId,
      projectId: chapter.projectId,
      chapterIdx: chapter.idx,
      chapterVersion: chapter.version,
      instruction,
      globalNote,
      origin: 'model',
      baseContent: base,
      beforeWordCount: countWords(base),
      afterWordCount: countWords(afterContent),
      edits,
      chunks: snapshots,
      manualRange: null,
      createdAt: Date.now()
    }
    this.previews.set(preview.id, preview)
    return this.publicPreview(preview)
  }

  async previewManual(input: ManualRewriteInput): Promise<RewritePreview> {
    const chapter = requireChapter(this.db, input.chapterId)
    if (chapter.projectId !== input.projectId) {
      throw new AppError('invalid', '章节与作品不匹配。')
    }
    const base = chapter.content
    const start = Math.min(Math.max(0, input.start), base.length)
    const end = Math.min(Math.max(start, input.end), base.length)
    const selected = base.slice(start, end)
    if (!selected.trim()) {
      throw new AppError('empty_selection', '请先选中要改写的文字。')
    }
    if (selected.length > 2000) {
      throw new AppError('too_long', '一次最多改写 2000 字，请分段处理。')
    }
    const before = base.slice(Math.max(0, start - 240), start)
    const after = base.slice(end, Math.min(base.length, end + 240))
    const rewritten = await this.writer().rewriteManual(
      {
        mode: input.mode,
        instruction: input.instruction,
        selected,
        before,
        after,
        chapterTitle: chapter.title
      },
      AbortSignal.timeout(TASK_TIMEOUT)
    )
    const replacement = stripMetaTrailer(rewritten).trim()
    if (!replacement || replacement === selected.trim()) {
      throw new AppError('no_change', '模型没有给出有效的改动。')
    }
    const snapshot = new Map<string, ChunkSnapshot>()
    const edits: RewriteEdit[] = [
      {
        chunkId: `manual:${start}:${end}`,
        displayId: `选区 ${start}–${end}`,
        action: 'rewrite',
        before: selected,
        after: replacement,
        reason: '',
        hint: input.instruction,
        moveAfterId: ''
      }
    ]
    const afterContent = `${base.slice(0, start)}${replacement}${base.slice(end)}`
    const preview: PendingPreview = {
      id: randomUUID(),
      chapterId: chapter.id,
      projectId: chapter.projectId,
      chapterIdx: chapter.idx,
      chapterVersion: chapter.version,
      instruction: input.instruction,
      globalNote: '只替换选中的文字，前后文保持不动。',
      origin: 'manual',
      baseContent: base,
      beforeWordCount: countWords(base),
      afterWordCount: countWords(afterContent),
      edits,
      chunks: snapshot,
      manualRange: { start, end },
      createdAt: Date.now()
    }
    this.previews.set(preview.id, preview)
    return this.publicPreview(preview)
  }

  applyPreview(previewId: string, editIds?: string[]): ApplyRewriteResult {
    const preview = this.previews.get(previewId)
    if (!preview) {
      throw new AppError('preview_expired', '这次改写结果已过期，请重新生成。')
    }
    if (Date.now() - preview.createdAt > PREVIEW_TTL) {
      this.previews.delete(previewId)
      throw new AppError('preview_expired', '这次改写结果已过期，请重新生成。')
    }
    const chapter = requireChapter(this.db, preview.chapterId)
    if (chapter.status === 'generating' || chapter.status === 'queued') {
      throw new AppError('busy', '这一章正在写入，请稍后再改。')
    }
    if (chapter.version !== preview.chapterVersion || chapter.content !== preview.baseContent) {
      this.previews.delete(previewId)
      throw new AppError('preview_stale', '这一章刚刚有改动，请重新生成改写方案。')
    }
    const allowed = editIds && editIds.length > 0 ? new Set(editIds) : null
    const selected = preview.edits.filter((edit) =>
      allowed ? allowed.has(edit.chunkId) || allowed.has(edit.displayId) : true
    )
    if (selected.length === 0) {
      throw new AppError('nothing_selected', '没有选择要采纳的段落。')
    }

    if (preview.origin === 'model') {
      const current = new Map(listChunks(this.db, chapter.id).map((chunk) => [chunk.id, chunk]))
      for (const edit of selected) {
        const chunk = current.get(edit.chunkId)
        const snapshot = preview.chunks.get(edit.chunkId)
        if (!chunk || !snapshot || chunk.hash !== snapshot.hash) {
          throw new AppError('hash_mismatch', '正文在预览之后被改动过，请重新生成方案。')
        }
      }
    }

    let nextContent: string
    if (preview.origin === 'manual') {
      const edit = selected[0]
      if (!edit) throw new AppError('nothing_selected', '没有选择要采纳的段落。')
      nextContent = this.composeManual(preview.baseContent, edit, preview.manualRange)
    } else {
      nextContent = this.compose(preview.baseContent, preview.chunks, selected)
    }
    if (!nextContent.trim()) {
      throw new AppError('empty_result', '改动后正文为空，已取消。')
    }

    const beforeWordCount = countWords(preview.baseContent)
    const afterWordCount = countWords(nextContent)
    createVersion(
      this.db,
      chapter.id,
      nextContent,
      {
        edits: selected,
        beforeWordCount,
        afterWordCount
      },
      `改写：${preview.instruction.slice(0, 40) || '选区调整'}`,
      beforeWordCount,
      afterWordCount
    )
    pruneVersions(this.db, chapter.id)

    const updated = updateChapterContent(
      this.db,
      chapter.id,
      nextContent,
      chapter.status === 'stale' ? 'final' : chapter.status
    )
    this.rebuildChunks(updated)
    updateChapterIssues(this.db, chapter.id, [])
    const ratio = changedRatio(preview.baseContent, nextContent)
    const staleChapters =
      ratio > STALE_THRESHOLD
        ? markSubsequentStale(
            this.db,
            preview.projectId,
            chapter.idx,
            `第${chapter.idx}章有较大改动`
          )
        : []
    if (ratio > STALE_THRESHOLD) {
      this.enqueueSummary(chapter.id)
    }
    this.previews.delete(previewId)
    touchProject(this.db, preview.projectId)
    this.emitChapterContent(updated)
    this.emitChapterChanged(chapter.id)
    this.emitStaleChanged(preview.projectId, staleChapters)
    this.emitProjectsChanged()
    const project = requireProject(this.db, preview.projectId)
    this.ensureBuffer(project.id, project.lastChapterIdx)
    return {
      chapter: toMeta(updated),
      staleChapters,
      issues: updated.issues
    }
  }

  discardPreview(previewId: string): void {
    this.previews.delete(previewId)
  }

  private composeManual(
    base: string,
    edit: RewriteEdit,
    range: { start: number; end: number } | null
  ): string {
    if (range && base.slice(range.start, range.end) === edit.before) {
      return cleanProse(
        `${base.slice(0, range.start)}${edit.after}${base.slice(range.end)}`
      )
    }
    if (!base.includes(edit.before)) {
      throw new AppError('preview_stale', '这一章刚刚有改动，请重新生成改写方案。')
    }
    const index = base.indexOf(edit.before)
    return cleanProse(`${base.slice(0, index)}${edit.after}${base.slice(index + edit.before.length)}`)
  }

  private compose(
    base: string,
    snapshots: Map<string, ChunkSnapshot>,
    edits: RewriteEdit[]
  ): string {
    const ordered = edits
      .map((edit) => ({ edit, snapshot: snapshots.get(edit.chunkId) }))
      .filter(
        (item): item is { edit: RewriteEdit; snapshot: ChunkSnapshot } =>
          Boolean(item.snapshot)
      )
      .sort((a, b) => b.snapshot.startOff - a.snapshot.startOff)

    let text = base
    for (const { edit, snapshot } of ordered) {
      if (text.slice(snapshot.startOff, snapshot.endOff) !== snapshot.text) {
        continue
      }
      let replacement = edit.after
      if (edit.action === 'insert_after') replacement = `${snapshot.text}\n\n${edit.after}`
      if (edit.action === 'delete') replacement = ''
      text = `${text.slice(0, snapshot.startOff)}${replacement}${text.slice(snapshot.endOff)}`
    }
    return cleanProse(text)
  }

  private publicPreview(preview: PendingPreview): RewritePreview {
    return {
      id: preview.id,
      chapterId: preview.chapterId,
      chapterIdx: preview.chapterIdx,
      instruction: preview.instruction,
      chapterVersion: preview.chapterVersion,
      globalNote: preview.globalNote,
      edits: preview.edits,
      origin: preview.origin,
      beforeWordCount: preview.beforeWordCount,
      afterWordCount: preview.afterWordCount
    }
  }

  private usableChunks(chapterId: string): Chunk[] {
    let chunks = listChunks(this.db, chapterId)
    if (chunks.length === 0) {
      const chapter = getChapterById(this.db, chapterId)
      if (chapter && chapter.content.trim()) {
        this.rebuildChunks(chapter)
        chunks = listChunks(this.db, chapterId)
      }
    }
    return chunks.filter((chunk) => chunk.text.trim().length >= 4)
  }

  /* ---------------------------------------------------------------- */
  /* Versions and stale handling                                       */
  /* ---------------------------------------------------------------- */

  restoreVersion(chapterId: string, versionId: string): ApplyRewriteResult {
    const version = getVersion(this.db, versionId)
    if (!version || version.chapterId !== chapterId) {
      throw new AppError('not_found', '这个版本不存在。')
    }
    const chapter = requireChapter(this.db, chapterId)
    if (chapter.status === 'generating' || chapter.status === 'queued') {
      throw new AppError('busy', '这一章正在写入，请稍后再改。')
    }
    if (chapter.content === version.content) {
      return { chapter: toMeta(chapter), staleChapters: [], issues: chapter.issues }
    }
    const updated = updateChapterContent(
      this.db,
      chapterId,
      version.content,
      chapter.status === 'stale' ? 'final' : chapter.status
    )
    this.rebuildChunks(updated)
    updateChapterIssues(this.db, chapterId, [])
    const ratio = changedRatio(chapter.content, version.content)
    const staleChapters =
      ratio > STALE_THRESHOLD
        ? markSubsequentStale(
            this.db,
            chapter.projectId,
            chapter.idx,
            `第${chapter.idx}章回到较早的版本`
          )
        : []
    this.enqueueSummary(chapterId)
    touchProject(this.db, chapter.projectId)
    this.emitChapterContent(updated)
    this.emitChapterChanged(chapterId)
    this.emitStaleChanged(chapter.projectId, staleChapters)
    this.emitProjectsChanged()
    return { chapter: toMeta(updated), staleChapters, issues: updated.issues }
  }

  private emitStaleChanged(projectId: string, indices: number[]): void {
    if (indices.length === 0) return
    const wanted = new Set(indices)
    for (const meta of listChapterMetas(this.db, projectId)) {
      if (wanted.has(meta.idx)) {
        this.emit({ type: 'chapter:changed', chapter: meta })
      }
    }
  }

  staleAction(chapterId: string, action: 'resummarize' | 'rewrite' | 'ignore'): ChapterMeta {
    const chapter = requireChapter(this.db, chapterId)
    if (action === 'rewrite') {
      this.enqueueChapter(chapter.projectId, chapter.idx, {
        urgent: true,
        regenerate: true
      })
      return toMeta(requireChapter(this.db, chapterId))
    }
    if (action === 'resummarize') {
      this.enqueueSummary(chapterId)
    }
    const accepted = acceptStaleChapter(this.db, chapterId)
    this.emitChapterChanged(chapterId)
    this.emitProjectsChanged()
    return toMeta(accepted)
  }

  async fixIssues(chapterId: string, issueText: string): Promise<RewritePreview> {
    const instruction = issueText.trim() || '按设定修正本章的连贯性问题'
    return this.previewRewrite(chapterId, `修正问题：${instruction}`, [])
  }

  /* ---------------------------------------------------------------- */
  /* Cancellation and deletion                                         */
  /* ---------------------------------------------------------------- */

  cancelChapter(chapterId: string): void {
    const chapter = getChapterById(this.db, chapterId)
    this.queue.cancelChapter(chapterId)
    if (chapter && chapter.status === 'queued') {
      updateChapterStatus(this.db, chapterId, chapter.content ? 'final' : 'outline')
      this.emitChapterChanged(chapterId)
    }
  }

  async regenerateChapter(chapterId: string): Promise<void> {
    const chapter = requireChapter(this.db, chapterId)
    await this.queue.cancelKeyAndWait(`chapter:${chapterId}`)
    this.queue.cancelChapter(chapterId)
    this.previews.forEach((preview, id) => {
      if (preview.chapterId === chapterId) this.previews.delete(id)
    })
    this.enqueueChapter(chapter.projectId, chapter.idx, {
      urgent: true,
      regenerate: true
    })
  }

  deleteChapter(chapterId: string): void {
    const chapter = requireChapter(this.db, chapterId)
    this.queue.cancelChapter(chapterId)
    const { projectId } = deleteChapterAndShift(this.db, chapterId)
    this.emit({ type: 'chapter:removed', projectId, idx: chapter.idx })
    this.emitProjectsChanged()
    const project = getProject(this.db, projectId)
    if (project) this.ensureBuffer(projectId, project.lastChapterIdx)
  }

  activeJobs(): JobInfo[] {
    return this.queue.activeJobs()
  }
}

