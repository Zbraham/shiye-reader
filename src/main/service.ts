import { z } from 'zod'
import type {
  ApiResult,
  AppEvent,
  AppSettings,
  ApplyRewriteResult,
  BeatsResult,
  BootstrapData,
  Chapter,
  ChapterMeta,
  Directive,
  DirectiveScope,
  ExportResult,
  ManualRewriteInput,
  Project,
  ProjectBrief,
  ReaderData,
  RewritePreview,
  SelectTargetsResult,
  StorySkeleton,
  TestModelResult,
  UsageSummary,
  VersionDetail,
  VersionMeta
} from '@shared/types'
import { APP_VERSION, InvalidTransitionError } from '@shared/constants'
import { countWords } from '@shared/text'
import {
  AppSettingsSchema,
  ApplyRewriteSchema,
  BeatsSchema,
  ChapterDeleteSchema,
  ChapterIdSchema,
  CreateProjectSchema,
  DirectiveCreateSchema,
  DirectiveDeactivateSchema,
  EnqueueChapterSchema,
  ExportSchema,
  FixIssuesSchema,
  ManualRewriteSchema,
  ProjectIdOnlySchema,
  ProjectIdSchema,
  ProjectUpdateSchema,
  ReadCursorSchema,
  ReaderEnterSchema,
  RewritePreviewSchema,
  RewriteSelectSchema,
  SetupDraftSchema,
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

export interface ExportChapter {
  idx: number
  title: string
  content: string
}

export interface ExportPayload {
  title: string
  genre: string
  tone: string
  pov: string
  synopsis: string
  format: 'txt' | 'md'
  chapters: ExportChapter[]
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
  writeExport: (payload: ExportPayload) => Promise<{ path: string }>
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

  handle(CHANNELS.projectUpdate, ProjectUpdateSchema, (input): Project => {
    const { projectId, ...patch } = input
    return engine.updateBookProject(projectId, patch)
  })

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
      genre: project.genre,
      tone: project.tone,
      pov: project.pov,
      synopsis: project.synopsis,
      format: input.format,
      chapters: chapters.map((chapter) => ({
        idx: chapter.idx,
        title: chapter.title,
        content: chapter.content
      }))
    }
    const result = await deps.writeExport(payload)
    const words = chapters.reduce(
      (total, chapter) => total + countWords(chapter.content),
      0
    )
    return { path: result.path, chapters: chapters.length, words }
  })

  handle(CHANNELS.dataFolder, z.undefined(), (): Promise<null> => deps.openDataFolder())

  return handlers
}

/**
 * Builds the plain-text or markdown body for an export. Shared by the desktop
 * file writer and the Android share-sheet writer so both produce identical
 * files.
 */
export function buildExportText(payload: ExportPayload): string {
  if (payload.format === 'md') {
    const lines: string[] = [`# ${payload.title}`, '']
    lines.push(`> ${payload.genre} · ${payload.tone} · ${payload.pov}`, '')
    if (payload.synopsis.trim()) lines.push(payload.synopsis.trim(), '')
    for (const chapter of payload.chapters) {
      lines.push(
        `## 第 ${chapter.idx} 章 ${chapter.title.replace(/^第\s*\d+\s*章\s*/u, '')}`,
        ''
      )
      lines.push(
        chapter.content
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .join('\n\n')
      )
      lines.push('')
    }
    return lines.join('\n')
  }

  const lines: string[] = [`《${payload.title}》`, '']
  if (payload.synopsis.trim()) lines.push(payload.synopsis.trim(), '')
  for (const chapter of payload.chapters) {
    lines.push(
      `第 ${chapter.idx} 章　${chapter.title.replace(/^第\s*\d+\s*章\s*/u, '')}`,
      ''
    )
    lines.push(chapter.content.trim(), '')
  }
  return lines.join('\n')
}

export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '未命名'
}

export function exportExtension(format: 'txt' | 'md'): string {
  return format === 'md' ? 'md' : 'txt'
}
