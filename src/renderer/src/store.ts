import { create } from 'zustand'
import type {
  AppEvent,
  AppSettings,
  Chapter,
  ChapterMeta,
  JobInfo,
  PlotBatchStatus,
  PlotRewriteResult,
  PlotStartMode,
  ProjectBrief,
  ReaderData,
  RewritePreview,
  UsageSummary
} from '@shared/types'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@shared/constants'
import { applyAppearance, chapterFromMeta, clamp, errorText, mergeChapterMeta, unwrap } from './lib'

export type View = 'boot' | 'library' | 'setup' | 'reader'
export type PanelTab = 'write' | 'edit' | 'plot' | 'qa' | 'insights'

export interface PlotAnchor {
  chapterIdx: number
  startMode: PlotStartMode
  offset: number | null
  excerpt: string
}

export interface ToastState {
  id: number
  tone: 'info' | 'error'
  message: string
}

interface AppStore {
  view: View
  bootError: string
  settings: AppSettings
  projects: ProjectBrief[]
  usage: UsageSummary
  notices: string[]
  dataDir: string
  platform: string
  version: string
  reader: ReaderData | null
  chapter: Chapter | null
  liveText: string
  jobs: JobInfo[]
  panelOpen: boolean
  panelTab: PanelTab
  plotAnchor: PlotAnchor | null
  plotDirection: string
  plotBatch: PlotRewriteResult | null
  plotStatus: PlotBatchStatus | null
  plotMessage: string
  crossLocate: { projectId: string; chapterIdx: number; offset: number } | null
  setCrossLocate: (
    target: { projectId: string; chapterIdx: number; offset: number } | null
  ) => void
  tocOpen: boolean
  settingsOpen: boolean
  diff: RewritePreview | null
  toast: ToastState | null
  init: () => Promise<void>
  showToast: (tone: 'info' | 'error', message: string) => void
  clearToast: () => void
  saveSettings: (patch: Partial<AppSettings>) => Promise<boolean>
  refreshProjects: () => Promise<void>
  openLibrary: () => void
  openSetup: () => void
  openBook: (projectId: string, chapterIdx?: number) => Promise<void>
  loadChapter: (idx: number) => Promise<void>
  goPrev: () => Promise<void>
  goNext: () => Promise<void>
  setPanelOpen: (open: boolean) => void
  setPanelTab: (tab: PanelTab) => void
  openPlot: (anchor: PlotAnchor) => void
  setPlotAnchor: (anchor: PlotAnchor | null) => void
  setPlotDirection: (text: string) => void
  beginPlotBatch: (result: PlotRewriteResult, direction: string) => void
  stopPlotBatch: () => Promise<void>
  clearPlot: () => void
  setTocOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setDiff: (preview: RewritePreview | null) => void
  requestChapter: (idx: number) => Promise<void>
  regenerate: () => Promise<void>
  cancelGeneration: () => Promise<void>
  updateCursor: (chapterIdx: number, ratio: number) => void
  refreshReader: () => Promise<void>
  refreshChapter: () => Promise<void>
  handleEvent: (event: AppEvent) => void
}

function mergeMetaList(list: ChapterMeta[], meta: ChapterMeta): ChapterMeta[] {
  const found = list.some((item) => item.id === meta.id)
  const next = found
    ? list.map((item) => (item.id === meta.id ? meta : item))
    : [...list, meta]
  next.sort((a, b) => a.idx - b.idx)
  return next
}

let started = false
let loadSeq = 0
let openSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined

/** Neighbour chapters are prefetched so the next page turn is instant. */
const CHAPTER_CACHE_TTL = 60_000
const CHAPTER_CACHE_MAX = 4
const chapterCache = new Map<string, { at: number; chapter: Chapter }>()

function cacheChapter(chapter: Chapter): void {
  chapterCache.set(chapter.id, { at: Date.now(), chapter })
  if (chapterCache.size <= CHAPTER_CACHE_MAX) return
  let oldestId = ''
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [id, entry] of chapterCache) {
    if (entry.at < oldestAt) {
      oldestAt = entry.at
      oldestId = id
    }
  }
  if (oldestId) chapterCache.delete(oldestId)
}

function dropCachedChapter(chapterId: string): void {
  chapterCache.delete(chapterId)
}

export const useApp = create<AppStore>()((set, get) => ({
  view: 'boot',
  bootError: '',
  settings: DEFAULT_SETTINGS,
  projects: [],
  usage: { requests: 0, promptTokens: 0, completionTokens: 0, last30DaysRequests: 0 },
  notices: [],
  dataDir: '',
  platform: '',
  version: '',
  reader: null,
  chapter: null,
  liveText: '',
  jobs: [],
  panelOpen: false,
  panelTab: 'write',
  plotAnchor: null,
  plotDirection: '',
  plotBatch: null,
  plotStatus: null,
  plotMessage: '',
  crossLocate: null,
  tocOpen: false,
  settingsOpen: false,
  diff: null,
  toast: null,

  init: async () => {
    if (started) return
    started = true
    try {
      const data = await unwrap(window.shiye.bootstrap())
      applyAppearance(data.settings)
      set({
        settings: data.settings,
        projects: data.projects,
        usage: data.usage,
        notices: data.notices,
        dataDir: data.dataDir,
        platform: data.platform,
        version: data.version,
        bootError: '',
        jobs: data.activeJobs
      })
      window.shiye.onEvent((event) => get().handleEvent(event))
      if (data.notices.length > 0) {
        get().showToast('info', data.notices.join(' '))
      }
      if (data.resume) {
        await get().openBook(data.resume.projectId, data.resume.chapterIdx)
      } else {
        set({ view: 'library' })
      }
    } catch (error) {
      started = false
      set({ view: 'boot', bootError: errorText(error) })
    }
  },

  showToast: (tone, message) => {
    const id = Date.now()
    set({ toast: { id, tone, message } })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      const current = get().toast
      if (current && current.id === id) set({ toast: null })
    }, 3800)
  },

  clearToast: () => set({ toast: null }),

  saveSettings: async (patch) => {
    const before = get().settings
    const optimistic: AppSettings = { ...before, ...patch }
    set({ settings: optimistic })
    applyAppearance(optimistic)
    try {
      const saved = await unwrap(window.shiye.saveSettings(patch))
      set({ settings: saved })
      applyAppearance(saved)
      return true
    } catch (error) {
      set({ settings: before })
      applyAppearance(before)
      get().showToast('error', errorText(error))
      return false
    }
  },

  refreshProjects: async () => {
    try {
      const projects = await unwrap(window.shiye.listProjects())
      set({ projects })
    } catch {
      // The shelf will refresh on the next event.
    }
  },

  openLibrary: () => {
    openSeq += 1
    set({
      view: 'library',
      reader: null,
      chapter: null,
      liveText: '',
      panelOpen: false,
      tocOpen: false,
      diff: null,
      plotAnchor: null,
      plotDirection: '',
      plotBatch: null,
      plotStatus: null,
      plotMessage: ''
    })
    void get().refreshProjects()
    void get().saveSettings({ lastView: 'library' })
  },

  openSetup: () => {
    set({ view: 'setup', settingsOpen: false })
  },

  setCrossLocate: (target) => {
    set({ crossLocate: target })
  },

  openBook: async (projectId, chapterIdx) => {
    const seq = (openSeq += 1)
    chapterCache.clear()
    set({
      view: 'reader',
      chapter: null,
      liveText: '',
      diff: null,
      panelOpen: false,
      tocOpen: false,
      plotAnchor: null,
      plotDirection: '',
      plotBatch: null,
      plotStatus: null,
      plotMessage: ''
    })
    try {
      const base = await unwrap(window.shiye.readProject(projectId))
      // Two quick shelf clicks used to race: the slower response could win and
      // replace the book the reader had just opened.
      if (seq !== openSeq) return
      const idx = clamp(
        chapterIdx ?? Math.max(1, base.project.lastChapterIdx),
        1,
        SETTINGS_LIMITS.chaptersMax
      )
      set({
        reader: base,
        // Imported books are for reading; the useful panel there is plot continuation.
        panelTab: base.project.source === 'imported' ? 'plot' : 'write'
      })
      await get().loadChapter(idx)
    } catch (error) {
      if (seq !== openSeq) return
      set({ view: 'library' })
      get().showToast('error', errorText(error))
    }
  },

  loadChapter: async (idx) => {
    const reader = get().reader
    if (!reader) return
    const projectId = reader.project.id
    const target = clamp(idx, 1, SETTINGS_LIMITS.chaptersMax)
    const previous = get().chapter
    if (
      previous &&
      previous.idx !== target &&
      get().plotStatus !== 'running' &&
      get().plotAnchor?.chapterIdx === previous.idx
    ) {
      set({ plotAnchor: null })
    }
    const seq = (loadSeq += 1)
    try {
      const data = await unwrap(window.shiye.enterReader(projectId, target))
      if (seq !== loadSeq) return
      const meta = data.chapters.find((chapter) => chapter.idx === target)
      set({
        reader: data,
        chapter: null,
        liveText: '',
        diff: null
      })
      if (!meta) {
        get().showToast('error', '这一章还没有建立。')
        return
      }
      const cached = chapterCache.get(meta.id)
      const fresh =
        cached && Date.now() - cached.at < CHAPTER_CACHE_TTL
          ? cached.chapter
          : await unwrap(window.shiye.readChapter(meta.id))
      if (seq !== loadSeq) return
      if (!cached || cached.chapter !== fresh) cacheChapter(fresh)
      set({ chapter: fresh, liveText: fresh.content })

      // Warm the neighbours in the background; failures are harmless because
      // loadChapter falls back to reading them on demand.
      for (const idx of [target - 1, target + 1]) {
        const neighbour = data.chapters.find((item) => item.idx === idx)
        if (!neighbour) continue
        if (neighbour.status === 'generating' || neighbour.status === 'queued') continue
        const warm = chapterCache.get(neighbour.id)
        if (warm && Date.now() - warm.at < CHAPTER_CACHE_TTL) continue
        void (async () => {
          try {
            const chapter = await unwrap(window.shiye.readChapter(neighbour.id))
            cacheChapter(chapter)
          } catch {
            // Prefetch is best-effort.
          }
        })()
      }
    } catch (error) {
      if (seq === loadSeq) get().showToast('error', errorText(error))
    }
  },

  goPrev: async () => {
    const chapter = get().chapter
    if (!chapter) return
    if (chapter.idx <= 1) return
    await get().loadChapter(chapter.idx - 1)
  },

  goNext: async () => {
    const chapter = get().chapter
    const reader = get().reader
    if (!chapter || !reader) return
    const lastIdx =
      reader.chapters[reader.chapters.length - 1]?.idx ?? chapter.idx
    const limit =
      reader.project.source === 'imported'
        ? Math.max(chapter.idx, lastIdx)
        : SETTINGS_LIMITS.chaptersMax
    if (chapter.idx >= limit) return
    await get().loadChapter(chapter.idx + 1)
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  openPlot: (anchor) =>
    set((state) => ({
      plotAnchor: anchor,
      panelTab: 'plot',
      panelOpen: true,
      tocOpen: false,
      // A finished batch belongs to its own range; do not show it under a new
      // anchor. A running batch stays visible so progress is never hidden.
      ...(state.plotStatus === 'running'
        ? {}
        : { plotBatch: null, plotStatus: null, plotMessage: '' })
    })),
  setPlotAnchor: (anchor) => set({ plotAnchor: anchor }),
  setPlotDirection: (text) => set({ plotDirection: text }),
  beginPlotBatch: (result, direction) =>
    set({
      plotBatch: result,
      plotStatus: 'running',
      plotMessage: '',
      plotDirection: direction,
      panelTab: 'plot',
      panelOpen: true
    }),
  stopPlotBatch: async () => {
    const state = get()
    const reader = state.reader
    const batch = state.plotBatch
    if (!reader || !batch || state.plotStatus !== 'running') return
    try {
      await unwrap(window.shiye.plotCancel(reader.project.id, batch.batchId))
    } catch (error) {
      get().showToast('error', errorText(error))
    }
  },
  clearPlot: () =>
    set({
      plotAnchor: null,
      plotBatch: null,
      plotStatus: null,
      plotMessage: ''
    }),
  setTocOpen: (open) => set({ tocOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setDiff: (preview) => set({ diff: preview }),

  requestChapter: async (idx) => {
    const reader = get().reader
    if (!reader) return
    try {
      await unwrap(window.shiye.requestChapter(reader.project.id, idx, true))
    } catch (error) {
      get().showToast('error', errorText(error))
    }
  },

  regenerate: async () => {
    const chapter = get().chapter
    if (!chapter) return
    try {
      await unwrap(window.shiye.regenerateChapter(chapter.id))
    } catch (error) {
      get().showToast('error', errorText(error))
    }
  },

  cancelGeneration: async () => {
    const chapter = get().chapter
    if (!chapter) return
    try {
      await unwrap(window.shiye.cancelChapter(chapter.id))
    } catch (error) {
      get().showToast('error', errorText(error))
    }
  },

  updateCursor: (chapterIdx, ratio) => {
    const reader = get().reader
    if (!reader) return
    void window.shiye.updateCursor(reader.project.id, chapterIdx, ratio)
  },

  refreshReader: async () => {
    const reader = get().reader
    if (!reader) return
    try {
      const data = await unwrap(window.shiye.readProject(reader.project.id))
      const current = get().reader
      if (!current || current.project.id !== data.project.id) return
      set({ reader: data })
    } catch {
      // Ignore transient reads while writing.
    }
  },

  refreshChapter: async () => {
    const chapter = get().chapter
    if (!chapter || chapter.status === 'generating') return
    try {
      const fresh = await unwrap(window.shiye.readChapter(chapter.id))
      const current = get().chapter
      if (!current || current.id !== fresh.id || current.status === 'generating') return
      set({ chapter: fresh, liveText: fresh.content })
    } catch {
      // The next chapter load will reconcile.
    }
  },

  handleEvent: (event) => {
    const state = get()
    switch (event.type) {
      case 'chapter:delta': {
        const chapter = state.chapter
        if (chapter && chapter.id === event.chapterId) {
          set({ liveText: state.liveText + event.text })
        }
        return
      }
      case 'chapter:reset': {
        const chapter = state.chapter
        if (chapter && chapter.id === event.chapterId) {
          set({ liveText: event.base ?? '' })
        }
        return
      }
      case 'chapter:changed': {
        dropCachedChapter(event.chapter.id)
        const reader = state.reader
        if (!reader || reader.project.id !== event.chapter.projectId) return
        set({ reader: { ...reader, chapters: mergeMetaList(reader.chapters, event.chapter) } })
        const chapter = get().chapter
        if (chapter && chapter.id === event.chapter.id) {
          set({ chapter: mergeChapterMeta(chapter, event.chapter) })
        }
        return
      }
      case 'chapter:content': {
        dropCachedChapter(event.chapter.id)
        const reader = state.reader
        if (!reader || reader.project.id !== event.chapter.projectId) return
        set({ reader: { ...reader, chapters: mergeMetaList(reader.chapters, event.chapter) } })
        const chapter = get().chapter
        if (chapter && chapter.id === event.chapter.id) {
          // The imported rich HTML is a snapshot of the original layout. Once
          // the text changes (AI rewrite, restore, another window), that
          // snapshot no longer describes the chapter and would hide the edit.
          const changed = event.content !== chapter.content
          set({
            chapter: {
              ...mergeChapterMeta(chapter, event.chapter),
              content: event.content,
              html: changed ? '' : chapter.html
            },
            liveText: event.content
          })
        }
        return
      }
      case 'chapter:removed': {
        chapterCache.clear()
        if (!state.reader || state.reader.project.id !== event.projectId) return
        void (async () => {
          try {
            const data = await unwrap(window.shiye.readProject(event.projectId))
            // The reader may have switched books or gone back to the shelf
            // while this read was in flight.
            const after = get().reader
            if (!after || after.project.id !== event.projectId || get().view !== 'reader') return
            const current = get().chapter
            set({ reader: data })
            if (!current) return
            const fresh = data.chapters.find((chapter) => chapter.id === current.id)
            if (fresh) {
              const chapter = await unwrap(window.shiye.readChapter(fresh.id))
              const latest = get().reader
              if (get().chapter?.id !== current.id || latest?.project.id !== event.projectId) {
                return
              }
              set({ chapter, liveText: chapter.content })
            } else {
              await get().loadChapter(Math.max(1, event.idx - 1))
            }
          } catch {
            // Ignore; the next open will reconcile.
          }
        })()
        return
      }
      case 'project:changed': {
        const reader = state.reader
        if (reader && reader.project.id === event.project.id) {
          set({ reader: { ...reader, project: event.project } })
        }
        return
      }
      case 'projects:changed': {
        void get().refreshProjects()
        return
      }
      case 'directives:changed': {
        const reader = state.reader
        if (!reader || reader.project.id !== event.projectId) return
        void (async () => {
          try {
            const data = await unwrap(window.shiye.readProject(event.projectId))
            const current = get().reader
            if (!current || current.project.id !== event.projectId) return
            set({
              reader: {
                ...current,
                directives: data.directives,
                characters: data.characters,
                storyState: data.storyState
              }
            })
          } catch {
            // Ignore.
          }
        })()
        return
      }
      case 'jobs:changed': {
        set({ jobs: event.jobs })
        return
      }
      case 'notice': {
        get().showToast(event.tone, event.message)
        return
      }
      case 'usage:changed': {
        set({ usage: event.usage })
        return
      }
      case 'plot:batch': {
        const reader = state.reader
        if (!reader || reader.project.id !== event.projectId) return
        set({ plotStatus: event.status, plotMessage: event.message ?? '' })
        if (event.status === 'done') {
          get().showToast('info', '这一批后续已经写完。')
          void get().refreshReader()
          void get().refreshChapter()
          void get().refreshProjects()
        } else if (event.status === 'failed') {
          get().showToast('error', event.message || '这一批改写停在中途。')
          void get().refreshReader()
          void get().refreshChapter()
          void get().refreshProjects()
        } else if (event.status === 'stopped') {
          get().showToast('info', '这一批已经停下，未轮到的章节保持原样。')
          void get().refreshReader()
          void get().refreshChapter()
          void get().refreshProjects()
        }
        return
      }
      default:
        return
    }
  }
}))

export function chapterFromState(chapter: Chapter | null, meta: ChapterMeta, content: string): Chapter {
  return chapter && chapter.id === meta.id ? mergeChapterMeta(chapter, meta) : chapterFromMeta(meta, content)
}
