import { App as CapacitorApp } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type {
  DirectiveInput,
  OutlineInput,
  ProjectPatch,
  ShiyeApi,
  StaleAction,
  TestModelInput
} from '@shared/api'
import type {
  ApiResult,
  ApplyRewriteResult,
  AppEvent,
  AppSettings,
  BeatsResult,
  BootstrapData,
  Chapter,
  ChapterMeta,
  Directive,
  ExportResult,
  Project,
  ProjectBrief,
  ReaderData,
  RewritePreview,
  SelectTargetsResult,
  SetupDraft,
  StorySkeleton,
  TestModelResult,
  UsageSummary,
  VersionDetail,
  VersionMeta
} from '@shared/types'
import { CHANNELS, type ChannelName } from '@shared/ipc'
import { themes } from '@shared/tokens'
import { StoryEngine } from '@main/engine'
import { migrate } from '@main/db/schema'
import { loadSettings, pruneJobs, recoverInterruptedChapters } from '@main/db/repo'
import {
  buildExportText,
  createService,
  exportExtension,
  sanitizeFileName,
  type ExportPayload
} from '@main/service'
import { useApp } from '@renderer/store'
import { openAndroidDatabase, type SqlJsDatabase } from './db'
import { installNativeTransport } from './http'
import { bytesToBase64, isNative } from './storage'

type Listener = (event: AppEvent) => void

interface PlatformRuntime {
  db: SqlJsDatabase
  flush: () => Promise<void>
}

declare global {
  interface Window {
    __shiyePlatform?: PlatformRuntime
    shiye: ShiyeApi
  }
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function shareTextFile(
  path: string,
  data: string,
  title: string
): Promise<void> {
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data,
    encoding: Encoding.UTF8,
    recursive: true
  })
  const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
  await Share.share({
    title,
    dialogTitle: title,
    files: [uri.uri]
  })
}

async function writeExport(payload: ExportPayload): Promise<{ path: string }> {
  const fileName = `${sanitizeFileName(payload.title)}.${exportExtension(payload.format)}`
  const text = buildExportText(payload)
  if (!isNative()) {
    downloadBlob(fileName, new Blob([text], { type: 'text/plain;charset=utf-8' }))
    return { path: fileName }
  }
  await shareTextFile(`exports/${fileName}`, text, `导出《${payload.title}》`)
  return { path: fileName }
}

async function backupDatabase(db: SqlJsDatabase): Promise<null> {
  await db.flush()
  const bytes = db.snapshot()
  const stamp = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const name = `shiye-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
    stamp.getDate()
  )}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.db`

  if (!isNative()) {
    const buffer = bytes.slice().buffer as ArrayBuffer
    downloadBlob(name, new Blob([buffer], { type: 'application/octet-stream' }))
    return null
  }

  const path = `backups/${name}`
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: bytesToBase64(bytes),
    recursive: true
  })
  const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
  await Share.share({
    title: '拾页数据备份',
    dialogTitle: '保存或分享数据备份',
    files: [uri.uri]
  })
  return null
}

interface SystemBarsPlugin {
  setStyle(options: {
    color: string
    darkIcons: boolean
  }): Promise<{ topInset?: number; bottomInset?: number }>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

function applyStatusBar(theme: AppSettings['theme']): void {
  const background = themes[theme].colors.bg
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', background)
  if (!isNative()) return
  void SystemBars.setStyle({
    color: background,
    darkIcons: theme !== 'night'
  })
    .then((result) => {
      const bottom = Number(result?.bottomInset)
      if (Number.isFinite(bottom) && bottom >= 0) {
        document.documentElement.style.setProperty(
          '--android-nav-bottom',
          `${bottom}px`
        )
      }
      const top = Number(result?.topInset)
      if (Number.isFinite(top) && top >= 0) {
        document.documentElement.style.setProperty(
          '--android-status-top',
          `${top}px`
        )
      }
    })
    .catch(() => undefined)
}

function handleBackButton(): void {
  const event = new CustomEvent('shiye:back', { cancelable: true })
  const proceed = window.dispatchEvent(event)
  if (!proceed || event.defaultPrevented) return

  const state = useApp.getState()
  if (state.settingsOpen) {
    state.setSettingsOpen(false)
    return
  }
  if (state.diff) {
    state.setDiff(null)
    return
  }
  if (state.panelOpen) {
    state.setPanelOpen(false)
    return
  }
  if (state.tocOpen) {
    state.setTocOpen(false)
    return
  }
  if (state.view === 'reader' || state.view === 'setup') {
    state.openLibrary()
    return
  }

  const now = Date.now()
  const last = Number(sessionStorage.getItem('shiye:last-back') ?? '0')
  if (now - last < 1800) {
    void CapacitorApp.exitApp()
    return
  }
  sessionStorage.setItem('shiye:last-back', String(now))
  state.showToast('info', '再按一次退出')
}

export async function initPlatform(): Promise<void> {
  installNativeTransport()

  const { db, corrupt } = await openAndroidDatabase()
  migrate(db)

  const notices: string[] = []
  if (corrupt) {
    notices.push('本地数据文件损坏，已重新建立。原文件仍保留在应用数据里。')
  }
  const recovered = recoverInterruptedChapters(db)
  if (recovered > 0) {
    notices.push(`上次退出时有 ${recovered} 章没有写完，已保留为草稿。`)
  }
  pruneJobs(db)

  let settings = loadSettings(db)
  const listeners = new Set<Listener>()

  const emit = (event: AppEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // One broken subscriber must not stop the others.
      }
    }
  }

  const engine = new StoryEngine({
    db,
    getSettings: () => settings,
    emit
  })

  const service = createService({
    engine,
    db,
    dataDir: '应用内部存储 · shiye.db',
    platform: 'android',
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next
      applyStatusBar(next.theme)
    },
    takeNotices: () => {
      const pending = notices.slice()
      notices.length = 0
      return pending
    },
    broadcast: emit,
    writeExport,
    openDataFolder: () => backupDatabase(db)
  })

  const call = <T>(
    channel: ChannelName,
    payload?: unknown
  ): Promise<ApiResult<T>> =>
    service[channel](payload) as Promise<ApiResult<T>>

  const api: ShiyeApi = {
    bootstrap: () => call<BootstrapData>(CHANNELS.bootstrap),
    listProjects: () => call<ProjectBrief[]>(CHANNELS.projectsList),
    createSkeleton: (draft: SetupDraft) =>
      call<StorySkeleton>(CHANNELS.skeletonCreate, draft),
    createBook: (input) => call<Project>(CHANNELS.bookCreate, input),
    updateProject: (projectId: string, patch: ProjectPatch) =>
      call<Project>(CHANNELS.projectUpdate, { projectId, ...patch }),
    deleteProject: (projectId: string) =>
      call<null>(CHANNELS.projectDelete, { projectId }),
    readProject: (projectId: string) =>
      call<ReaderData>(CHANNELS.readerRead, { projectId }),
    enterReader: (projectId: string, chapterIdx: number) =>
      call<ReaderData>(CHANNELS.readerEnter, { projectId, chapterIdx }),
    readChapter: (chapterId: string) =>
      call<Chapter>(CHANNELS.readChapter, { chapterId }),
    updateCursor: (projectId: string, chapterIdx: number, ratio: number) =>
      call<null>(CHANNELS.cursorUpdate, { projectId, chapterIdx, ratio }),
    requestChapter: (projectId: string, chapterIdx: number, urgent?: boolean) =>
      call<null>(CHANNELS.chapterRequest, { projectId, chapterIdx, urgent }),
    cancelChapter: (chapterId: string) =>
      call<null>(CHANNELS.chapterCancel, { chapterId }),
    regenerateChapter: (chapterId: string) =>
      call<null>(CHANNELS.chapterRegenerate, { chapterId }),
    deleteChapter: (chapterId: string) =>
      call<null>(CHANNELS.chapterDelete, { chapterId }),
    updateOutline: (input: OutlineInput) =>
      call<ChapterMeta>(CHANNELS.chapterOutline, input),
    saveSettings: (patch) =>
      call<AppSettings>(CHANNELS.settingsSave, patch),
    testModel: (input: TestModelInput) =>
      call<TestModelResult>(CHANNELS.modelTest, input),
    createDirective: (input: DirectiveInput) =>
      call<Directive>(CHANNELS.directiveCreate, input),
    deactivateDirective: (projectId: string, directiveId: string) =>
      call<null>(CHANNELS.directiveDeactivate, { projectId, directiveId }),
    createBeats: (projectId: string, chapterIdx: number) =>
      call<BeatsResult>(CHANNELS.beats, { projectId, chapterIdx }),
    selectTargets: (chapterId: string, instruction: string) =>
      call<SelectTargetsResult>(CHANNELS.rewriteSelect, {
        chapterId,
        instruction
      }),
    previewRewrite: (
      chapterId: string,
      instruction: string,
      targetIds: string[]
    ) =>
      call<RewritePreview>(CHANNELS.rewritePreview, {
        chapterId,
        instruction,
        targetIds
      }),
    previewManual: (input) =>
      call<RewritePreview>(CHANNELS.rewriteManual, input),
    applyRewrite: (previewId: string, editIds?: string[]) =>
      call<ApplyRewriteResult>(CHANNELS.rewriteApply, { previewId, editIds }),
    discardRewrite: (previewId: string) =>
      call<null>(CHANNELS.rewriteDiscard, { previewId }),
    fixIssues: (chapterId: string, issueText: string) =>
      call<RewritePreview>(CHANNELS.rewriteFix, { chapterId, issueText }),
    listVersions: (chapterId: string) =>
      call<VersionMeta[]>(CHANNELS.versionsList, { chapterId }),
    getVersion: (versionId: string) =>
      call<VersionDetail | null>(CHANNELS.versionsGet, { versionId }),
    restoreVersion: (chapterId: string, versionId: string) =>
      call<ApplyRewriteResult>(CHANNELS.versionsRestore, {
        chapterId,
        versionId
      }),
    staleAction: (chapterId: string, action: StaleAction) =>
      call<ChapterMeta>(CHANNELS.staleAction, { chapterId, action }),
    getUsage: () => call<UsageSummary>(CHANNELS.usageGet),
    exportBook: (projectId: string, format: 'txt' | 'md') =>
      call<ExportResult>(CHANNELS.exportBook, { projectId, format }),
    openDataFolder: () => call<null>(CHANNELS.dataFolder),
    onEvent: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }

  window.shiye = api
  window.__shiyePlatform = { db, flush: () => db.flush() }

  applyStatusBar(settings.theme)

  // Rotation and gesture/3-button navigation changes move the bottom inset.
  let barTimer: number | undefined
  window.addEventListener('resize', () => {
    window.clearTimeout(barTimer)
    barTimer = window.setTimeout(() => {
      const theme = document.documentElement.dataset['theme'] as
        | AppSettings['theme']
        | undefined
      applyStatusBar(theme ?? useApp.getState().settings.theme)
    }, 140)
  })

  const observer = new MutationObserver(() => {
    const theme = document.documentElement.dataset['theme'] as
      | AppSettings['theme']
      | undefined
    if (theme) applyStatusBar(theme)
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void db.flush()
  })
  window.addEventListener('pagehide', () => {
    void db.flush()
  })

  if (isNative()) {
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) void db.flush()
    })
    void CapacitorApp.addListener('backButton', () => handleBackButton())
  }
}
