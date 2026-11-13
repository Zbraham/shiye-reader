import { z } from 'zod'
import type {
  AnalysisBundle,
  AnalyzeResult,
  ApiResult,
  AppEvent,
  AppSettings,
  ApplyRewriteResult,
  BeatsResult,
  Bookmark,
  BootstrapData,
  Chapter,
  ChapterMeta,
  Directive,
  DirectiveScope,
  ExportFormat,
  ExportResult,
  ImportBookInput,
  ManualRewriteInput,
  OpdsFeed,
  PlotRewriteInput,
  PlotRewriteResult,
  Project,
  ProjectBrief,
  QaAnswer,
  ReaderData,
  ReadingStats,
  RemoteBook,
  RewritePreview,
  SearchResult,
  SelectTargetsResult,
  Shelf,
  StorySkeleton,
  SyncResult,
  SyncStatus,
  TestModelResult,
  UsageSummary,
  VersionDetail,
  VersionMeta
} from '@shared/types'
import {
  buildExportFile,
  buildExportText as buildSharedExportText,
  exportExtension,
  sanitizeFileName
} from '@shared/export'
import { APP_VERSION, InvalidTransitionError } from '@shared/constants'
import { countWords } from '@shared/text'
import {
  AnalyzeBookSchema,
  AnalyzeChapterSchema,
  AppSettingsSchema,
  ApplyRewriteSchema,
  BeatsSchema,
  BookmarkAddSchema,
  BookmarkRemoveSchema,
  ChapterDeleteSchema,
  ChapterIdSchema,
  CreateProjectSchema,
  DirectiveCreateSchema,
  DirectiveDeactivateSchema,
  EnqueueChapterSchema,
  ExportSchema,
  FixIssuesSchema,
  ForeshadowStatusSchema,
  ImportBookSchema,
  ImportUrlSchema,
  IssueStatusSchema,
  ManualRewriteSchema,
  OpdsUrlSchema,
  PlotBeatsSchema,
  PlotCancelSchema,
  PlotRewriteSchema,
  ProjectBatchDeleteSchema,
  ProjectIdOnlySchema,
  ProjectIdSchema,
  ProjectMetaSchema,
  ProjectUpdateSchema,
  QaAskSchema,
  ReadCursorSchema,
  ReaderEnterSchema,
  ReadingRecordSchema,
  ReadingStatsSchema,
  RewritePreviewSchema,
  RewriteSelectSchema,
  SearchSchema,
  SetupDraftSchema,
  ShelfBooksSchema,
  ShelfCreateSchema,
  ShelfDeleteSchema,
  ShelfRenameSchema,
  StaleActionSchema,
  TestModelSchema,
  UpdateOutlineSchema,
  VersionGetSchema,
  VersionListSchema,
  VersionRestoreSchema
} from '@shared/schemas'
import { CHANNELS, type ChannelName } from '@shared/ipc'
import { AppError, toReadableMessage } from './errors'
import { logError } from './logger'
import type { StoryEngine } from './engine'
import type { DatabaseHandle } from './db/sqlite'
import {
  chapterContents,
  getVersion as getVersionOf,
  listChapterMetas,
  listCharacters,
  listDirectives,
  listProjects,
  listStoryState,
  listVersions as listVersionsOf,
  requireChapter,
  requireProject,
  saveSettings as persistSettings,
  usageSummary
} from './db/repo'
import {
  addBookmark,
  addToShelf,
  createShelf,
  deleteProjects,
  deleteShelf,
  findDuplicateProjects,
  listBookmarks,
  listShelves,
  readingStats,
  recordReading,
  removeBookmark,
  removeFromShelf,
  renameShelf,
  searchChapters,
  updateProjectMetadata
} from './db/reading'
import {
  clearAnalysis,
  getAnalysis,
  setForeshadowStatus,
  setIssueStatus
} from './db/analysis'
import { createInsights } from './insights'
import { syncStatus as readSyncStatus, runWebdavSync } from './sync/webdav'
import { browseOpds, fetchRemoteBook, importFromOpds } from './remote-books'

export interface ExportChapter {
  idx: number
  title: string
  content: string
}

export interface ExportPayload {
  title: string
  author?: string
  language?: string
  publisher?: string
  series?: string
  description?: string
  tags?: string[]
  genre: string
  tone: string
  pov: string
  synopsis: string
  coverData?: string
  format: ExportFormat
  chapters: ExportChapter[]
}

export interface ExportArtifact {
  fileName: string
  mime: string
  bytes: Uint8Array
  format: ExportFormat
  /** Only for desktop PDF rendering. */
  html?: string
}

export interface ServiceDeps {
  engine: StoryEngine
  db: DatabaseHandle
  dataDir: string
  platform: string
  getSettings: () => AppSettings
  setSettings: (settings: AppSettings) => void
  takeNotices: () => string[]
  broadcast: (event: AppEvent) => void
  /** Creates the file and returns its human-readable path. */
  writeExport: (artifact: ExportArtifact) => Promise<{ path: string }>
  openDataFolder: () => Promise<null>
}

export type ApiHandler = (raw: unknown) => Promise<ApiResult<unknown>>

function failure(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } }
}

function readerData(db: DatabaseHandle, engine: StoryEngine, projectId: string): ReaderData {
  const project = requireProject(db, projectId)
  return {
    project,
    chapters: listChapterMetas(db, projectId),
    directives: listDirectives(db, projectId),
    characters: listCharacters(db, projectId),
    storyState: listStoryState(db, projectId),
    activeJobs: engine.activeJobs().filter((job) => job.projectId === projectId)
  }
}

export function createService(deps: ServiceDeps): Record<ChannelName, ApiHandler> {
  const { engine, db } = deps
  const handlers = {} as Record<ChannelName, ApiHandler>
  const insights = createInsights({
    db,
    writerMode: () => engine.writerMode,
    complete: (system, user, signal) => engine.complete(system, user, signal),
    emitAnalysisChanged: (projectId) => deps.broadcast({ type: 'analysis:changed', projectId })
  })

  const handle = <S extends z.ZodTypeAny, T>(
    channel: ChannelName,
    schema: S,
    run: (input: z.infer<S>) => T | Promise<T>
  ): void => {
    handlers[channel] = async (raw: unknown): Promise<ApiResult<unknown>> => {
      try {
        const input = schema.parse(raw) as z.infer<S>
        const data = await run(input)
        return { ok: true, data }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return failure('invalid_input', '请求参数不合法。')
        }
        if (error instanceof InvalidTransitionError) {
          return failure('state', '章节状态刚刚发生了变化，请刷新后重试。')
        }
        if (error instanceof AppError) {
          return failure(error.code, error.message)
        }
        logError('api', error)
        return failure('unknown', toReadableMessage(error))
      }
    }
  }

  handle(CHANNELS.bootstrap, z.undefined(), (): BootstrapData => {
    const settings = deps.getSettings()
    const projects = listProjects(db)
    const last = settings.lastProjectId
      ? projects.find((item) => item.id === settings.lastProjectId)
      : undefined
    const resume =
      settings.openLastOnLaunch && last && settings.lastView === 'reader'
        ? { projectId: last.id, chapterIdx: last.readChapter }
        : null
    return {
      projects,
      settings,
      activeJobs: engine.activeJobs(),
      notices: deps.takeNotices(),
      platform: deps.platform,
      version: APP_VERSION,
      dataDir: deps.dataDir,
      usage: usageSummary(db),
      resume
    }
  })

  handle(CHANNELS.projectsList, z.undefined(), (): ProjectBrief[] => listProjects(db))

  handle(CHANNELS.skeletonCreate, SetupDraftSchema, async (draft): Promise<StorySkeleton> => {
    return engine.createSkeleton(draft)
  })

  handle(CHANNELS.bookCreate, CreateProjectSchema, (input): Project => {
    const project = engine.createBook(input)
    const settings = persistSettings(db, {
      lastProjectId: project.id,
      lastView: 'reader'
    })
    deps.setSettings(settings)
    return project
  })

  handle(CHANNELS.bookImport, ImportBookSchema, (input): Project => {
    const project = engine.importBook(input as ImportBookInput)
    const settings = persistSettings(db, {
      lastProjectId: project.id,
      lastView: 'reader'
    })
    deps.setSettings(settings)
    return project
  })

  handle(CHANNELS.bookImportUrl, ImportUrlSchema, async (input): Promise<RemoteBook> => {
    return fetchRemoteBook(input.url, input.name)
  })

  handle(CHANNELS.bookImportRemote, ImportUrlSchema, async (input): Promise<RemoteBook> => {
    return importFromOpds(input.url)
  })

  handle(CHANNELS.opdsBrowse, OpdsUrlSchema, async (input): Promise<OpdsFeed> => {
    return browseOpds(input.url)
  })

  handle(CHANNELS.projectUpdate, ProjectUpdateSchema, (input): Project => {
    const { projectId, ...patch } = input
    return engine.updateBookProject(projectId, patch)
  })

  handle(CHANNELS.projectMeta, ProjectMetaSchema, (input): Project => {
    const { projectId, ...patch } = input
    const project = updateProjectMetadata(db, projectId, patch)
    deps.broadcast({ type: 'project:changed', project })
    deps.broadcast({ type: 'projects:changed' })
    return project
  })

  handle(CHANNELS.projectBatchDelete, ProjectBatchDeleteSchema, async (input): Promise<null> => {
    for (const projectId of input.projectIds) {
      try {
        await engine.deleteBook(projectId)
      } catch {
        // Keep deleting the rest even if one book is already gone.
      }
    }
    deleteProjects(db, input.projectIds)
    const settings = deps.getSettings()
    if (settings.lastProjectId && input.projectIds.includes(settings.lastProjectId)) {
      deps.setSettings(persistSettings(db, { lastProjectId: null, lastView: 'library' }))
    }
    deps.broadcast({ type: 'projects:changed' })
    return null
  })

  handle(CHANNELS.projectDuplicates, z.undefined(), (): Record<string, string[]> =>
    findDuplicateProjects(db)
  )

  handle(CHANNELS.projectDelete, ProjectIdOnlySchema, async (input): Promise<null> => {
    await engine.deleteBook(input.projectId)
    const settings = deps.getSettings()
    if (settings.lastProjectId === input.projectId) {
      deps.setSettings(persistSettings(db, { lastProjectId: null, lastView: 'library' }))
    }
    return null
  })

  handle(CHANNELS.readerRead, ProjectIdSchema, (input): ReaderData =>
    readerData(db, engine, input.projectId)
  )

  handle(CHANNELS.readerEnter, ReaderEnterSchema, (input): ReaderData => {
    engine.enterReader(input.projectId, input.chapterIdx)
    const settings = deps.getSettings()
    if (settings.lastProjectId !== input.projectId || settings.lastView !== 'reader') {
      deps.setSettings(
        persistSettings(db, {
          lastProjectId: input.projectId,
          lastView: 'reader'
        })
      )
    }
    return readerData(db, engine, input.projectId)
  })

  handle(CHANNELS.readChapter, ChapterIdSchema, (input): Chapter => requireChapter(db, input.chapterId))

  handle(CHANNELS.cursorUpdate, ReadCursorSchema, (input): null => {
    engine.updateReadCursor(input.projectId, input.chapterIdx, input.ratio)
    return null
  })

  handle(CHANNELS.chapterRequest, EnqueueChapterSchema, (input): null => {
    engine.enqueueChapter(input.projectId, input.idx, { urgent: input.urgent ?? true })
    return null
  })

  handle(CHANNELS.chapterCancel, ChapterIdSchema, (input): null => {
    engine.cancelChapter(input.chapterId)
    return null
  })

  handle(CHANNELS.chapterRegenerate, ChapterIdSchema, async (input): Promise<null> => {
    await engine.regenerateChapter(input.chapterId)
    return null
  })

  handle(CHANNELS.chapterDelete, ChapterDeleteSchema, (input): null => {
    engine.deleteChapter(input.chapterId)
    return null
  })

  handle(CHANNELS.chapterOutline, UpdateOutlineSchema, (input): ChapterMeta => {
    return engine.updateOutline(input.chapterId, {
      title: input.title,
      goals: input.goals,
      advance: input.advance,
      forbidden: input.forbidden,
      hook: input.hook
    })
  })

  handle(CHANNELS.settingsSave, AppSettingsSchema, (input): AppSettings => {
    const next = persistSettings(db, input as Partial<AppSettings>)
    deps.setSettings(next)
    if (typeof input.buffer === 'number' && next.lastProjectId) {
      try {
        engine.updateBookProject(next.lastProjectId, { buffer: input.buffer })
      } catch {
        // The project may have been removed.
      }
    }
    return next
  })

  handle(CHANNELS.modelTest, TestModelSchema, (input): Promise<TestModelResult> =>
    engine.testModel(input.baseUrl, input.apiKey, input.model)
  )

  handle(CHANNELS.directiveCreate, DirectiveCreateSchema, (input): Directive => {
    return engine.createDirective(
      input.projectId,
      input.scope as DirectiveScope,
      input.content
    )
  })

  handle(CHANNELS.directiveDeactivate, DirectiveDeactivateSchema, (input): null => {
    engine.deactivateDirective(input.projectId, input.directiveId)
    return null
  })

  handle(CHANNELS.beats, BeatsSchema, (input): Promise<BeatsResult> =>
    engine.beats(input.projectId, input.chapterIdx)
  )

  handle(CHANNELS.plotBeats, PlotBeatsSchema, (input): Promise<BeatsResult> =>
    engine.plotBeats(input)
  )

  handle(CHANNELS.plotRewrite, PlotRewriteSchema, (input): Promise<PlotRewriteResult> =>
    engine.plotRewrite(input as PlotRewriteInput)
  )

  handle(CHANNELS.plotCancel, PlotCancelSchema, async (input): Promise<null> => {
    await engine.plotCancel(input.projectId, input.batchId)
    return null
  })

  handle(CHANNELS.rewriteSelect, RewriteSelectSchema, (input): Promise<SelectTargetsResult> =>
    engine.selectTargets(input.chapterId, input.instruction)
  )

  handle(CHANNELS.rewritePreview, RewritePreviewSchema, (input): Promise<RewritePreview> =>
    engine.previewRewrite(input.chapterId, input.instruction, input.targetIds)
  )

  handle(CHANNELS.rewriteManual, ManualRewriteSchema, (input): Promise<RewritePreview> =>
    engine.previewManual(input as ManualRewriteInput)
  )

  handle(CHANNELS.rewriteApply, ApplyRewriteSchema, (input): ApplyRewriteResult =>
    engine.applyPreview(input.previewId, input.editIds)
  )

  handle(
    CHANNELS.rewriteDiscard,
    z.object({ previewId: z.string().min(1).max(80) }),
    (input): null => {
      engine.discardPreview(input.previewId)
      return null
    }
  )

  handle(CHANNELS.rewriteFix, FixIssuesSchema, (input): Promise<RewritePreview> =>
    engine.fixIssues(input.chapterId, input.issueText)
  )

  handle(CHANNELS.versionsList, VersionListSchema, (input): VersionMeta[] =>
    listVersionsOf(db, input.chapterId)
  )

  handle(CHANNELS.versionsGet, VersionGetSchema, (input): VersionDetail | null =>
    getVersionOf(db, input.versionId)
  )

  handle(CHANNELS.versionsRestore, VersionRestoreSchema, (input): ApplyRewriteResult =>
    engine.restoreVersion(input.chapterId, input.versionId)
  )

  handle(CHANNELS.staleAction, StaleActionSchema, (input): ChapterMeta =>
    engine.staleAction(input.chapterId, input.action)
  )

  handle(CHANNELS.usageGet, z.undefined(), (): UsageSummary => usageSummary(db))

  handle(CHANNELS.search, SearchSchema, (input): SearchResult =>
    searchChapters(db, {
      projectId: input.projectId ?? null,
      query: input.query,
      limit: input.limit,
      beforeIdx: input.beforeIdx ?? null
    })
  )

  handle(CHANNELS.bookmarkList, ProjectIdOnlySchema, (input): Bookmark[] =>
    listBookmarks(db, input.projectId)
  )

  handle(CHANNELS.bookmarkAdd, BookmarkAddSchema, (input): Bookmark => {
    const bookmark = addBookmark(db, input)
    deps.broadcast({ type: 'project:changed', project: requireProject(db, input.projectId) })
    return bookmark
  })

  handle(CHANNELS.bookmarkRemove, BookmarkRemoveSchema, (input): null => {
    removeBookmark(db, input.bookmarkId)
    return null
  })

  handle(CHANNELS.readingRecord, ReadingRecordSchema, (input): null => {
    recordReading(db, input.projectId, input.seconds, input.words)
    return null
  })

  handle(CHANNELS.readingStats, ReadingStatsSchema, (input): ReadingStats =>
    readingStats(db, input.projectId ?? null)
  )

  handle(CHANNELS.shelfList, z.undefined(), (): Shelf[] => listShelves(db))

  const shelfChanged = (): void => deps.broadcast({ type: 'shelves:changed' })

  handle(CHANNELS.shelfCreate, ShelfCreateSchema, (input): Shelf => {
    const shelf = createShelf(db, input.name)
    shelfChanged()
    return shelf
  })

  handle(CHANNELS.shelfRename, ShelfRenameSchema, (input): Shelf => {
    const shelf = renameShelf(db, input.shelfId, input.name)
    shelfChanged()
    return shelf
  })

  handle(CHANNELS.shelfDelete, ShelfDeleteSchema, (input): null => {
    deleteShelf(db, input.shelfId)
    shelfChanged()
    return null
  })

  handle(CHANNELS.shelfAdd, ShelfBooksSchema, (input): null => {
    addToShelf(db, input.shelfId, input.projectIds)
    shelfChanged()
    return null
  })

  handle(CHANNELS.shelfRemove, ShelfBooksSchema, (input): null => {
    removeFromShelf(db, input.shelfId, input.projectIds)
    shelfChanged()
    return null
  })

  handle(CHANNELS.qaAsk, QaAskSchema, (input): Promise<QaAnswer> =>
    insights.askQuestion(input)
  )

  handle(CHANNELS.analysisGet, ProjectIdOnlySchema, (input): AnalysisBundle =>
    getAnalysis(db, input.projectId)
  )

  handle(CHANNELS.analysisChapter, AnalyzeChapterSchema, (input): Promise<AnalyzeResult> =>
    insights.analyzeChapter(input.projectId, input.chapterIdx)
  )

  handle(CHANNELS.analysisBook, AnalyzeBookSchema, (input): Promise<AnalyzeResult> =>
    insights.analyzeBook(input.projectId, input.sampleSize)
  )

  handle(CHANNELS.analysisIssue, IssueStatusSchema, (input): null => {
    setIssueStatus(db, input.issueId, input.status)
    return null
  })

  handle(CHANNELS.analysisForeshadow, ForeshadowStatusSchema, (input): null => {
    setForeshadowStatus(db, input.foreshadowId, input.status)
    return null
  })

  handle(CHANNELS.analysisClear, ProjectIdOnlySchema, (input): null => {
    clearAnalysis(db, input.projectId)
    deps.broadcast({ type: 'analysis:changed', projectId: input.projectId })
    return null
  })

  handle(CHANNELS.syncStatus, z.undefined(), (): SyncStatus => {
    const settings = deps.getSettings()
    return readSyncStatus(db, {
      url: settings.syncUrl,
      username: settings.syncUser,
      password: settings.syncPassword,
      path: settings.syncPath
    })
  })

  handle(CHANNELS.syncRun, z.undefined(), async (): Promise<SyncResult> => {
    const settings = deps.getSettings()
    return runWebdavSync(db, {
      url: settings.syncUrl,
      username: settings.syncUser,
      password: settings.syncPassword,
      path: settings.syncPath
    })
  })

  handle(CHANNELS.exportBook, ExportSchema, async (input): Promise<ExportResult> => {
    const project = requireProject(db, input.projectId)
    const chapters = chapterContents(db, project.id).filter(
      (chapter) => chapter.content.trim().length > 0
    )
    if (chapters.length === 0) {
      throw new AppError('empty', '这本书还没有可以导出的正文。')
    }
    const payload: ExportPayload = {
      title: project.title,
      author: project.author,
      language: project.language,
      publisher: project.publisher,
      series: project.series,
      description: project.description,
      tags: project.tags,
      genre: project.genre,
      tone: project.tone,
      pov: project.pov,
      synopsis: project.synopsis,
      coverData: project.coverData,
      format: input.format,
      chapters: chapters.map((chapter) => ({
        idx: chapter.idx,
        title: chapter.title,
        content: chapter.content
      }))
    }

    let artifact: ExportArtifact
    if (input.format === 'pdf') {
      artifact = {
        fileName: `${sanitizeFileName(payload.title)}.pdf`,
        mime: 'application/pdf',
        bytes: new Uint8Array(),
        format: 'pdf',
        html: buildPrintHtml(payload)
      }
    } else {
      const file = await buildExportFile(payload, input.format)
      artifact = { ...file, format: input.format }
    }
    const result = await deps.writeExport(artifact)
    const words = chapters.reduce(
      (total, chapter) => total + countWords(chapter.content),
      0
    )
    return { path: result.path, chapters: chapters.length, words }
  })

  handle(CHANNELS.dataFolder, z.undefined(), (): Promise<null> => deps.openDataFolder())

  return handlers
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/** Simple print layout used by the desktop PDF exporter. */
export function buildPrintHtml(payload: ExportPayload): string {
  const chapters = payload.chapters
    .map(
      (chapter) =>
        `<section><h2>第 ${chapter.idx} 章 ${escapeHtml(
          chapter.title.replace(/^第\s*\d+\s*章\s*/u, '')
        )}</h2>${chapter.content
          .split(/\n{2,}/u)
          .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
          .filter((line) => line !== '<p></p>')
          .join('')}</section>`
    )
    .join('')
  return `<!doctype html><html lang="${escapeHtml(
    payload.language || 'zh-CN'
  )}"><head><meta charset="utf-8"><title>${escapeHtml(payload.title)}</title><style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: "Source Han Serif SC", "Noto Serif SC", SimSun, serif; font-size: 11.5pt; line-height: 1.9; color: #222; }
  h1 { font-size: 24pt; text-align: center; margin: 40vh 0 8mm; font-weight: 600; }
  h2 { font-size: 15pt; margin: 10mm 0 4mm; page-break-after: avoid; }
  p { text-indent: 2em; margin: 0 0 0.55em; text-align: justify; }
  .meta { text-align: center; color: #666; margin-bottom: 12mm; }
  section { page-break-before: always; }
  </style></head><body><h1>${escapeHtml(payload.title)}</h1><div class="meta">${escapeHtml(
    [payload.author, payload.genre, payload.tone].filter(Boolean).join(' · ')
  )}</div>${chapters}</body></html>`
}

export function buildExportText(payload: ExportPayload): string {
  return buildSharedExportText(payload, payload.format === 'md' ? 'md' : 'txt')
}

export { exportExtension, sanitizeFileName }
