import { create } from 'zustand'
import type {
  AppEvent,
  AppSettings,
  Chapter,
  ChapterMeta,
  JobInfo,
  ProjectBrief,
  ReaderData,
  RewritePreview,
  UsageSummary
} from '@shared/types'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@shared/constants'
import { applyAppearance, chapterFromMeta, clamp, errorText, mergeChapterMeta, unwrap } from './lib'

export type View = 'boot' | 'library' | 'setup' | 'reader'
export type PanelTab = 'write' | 'edit'

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
  tocOpen: boolean
  settingsOpen: boolean
  diff: RewritePreview | null
  toast: ToastState | null
  init: () => Promise<void>
  showToast: (tone: 'info' | 'error', message: string) => void
  clearToast: () => void
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshProjects: () => Promise<void>
  openLibrary: () => void
  openSetup: () => void
  openBook: (projectId: string, chapterIdx?: number) => Promise<void>
  loadChapter: (idx: number) => Promise<void>
  goPrev: () => Promise<void>
  goNext: () => Promise<void>
  setPanelOpen: (open: boolean) => void
  setPanelTab: (tab: PanelTab) => void
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
let toastTimer: ReturnType<typeof setTimeout> | undefined

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
    } catch (error) {
      set({ settings: before })
      applyAppearance(before)
      get().showToast('error', errorText(error))
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
    set({
      view: 'library',
      reader: null,
      chapter: null,
      liveText: '',
      panelOpen: false,
      tocOpen: false,
      diff: null
    })
    void get().refreshProjects()
    void get().saveSettings({ lastView: 'library' })
  },

  openSetup: () => {
    set({ view: 'setup', settingsOpen: false })
  },

  openBook: async (projectId, chapterIdx) => {
    set({
      view: 'reader',
      chapter: null,
      liveText: '',
      diff: null,
      panelOpen: false,
      tocOpen: false
    })
    try {
      const base = await unwrap(window.shiye.readProject(projectId))
      const idx = clamp(
        chapterIdx ?? Math.max(1, base.project.lastChapterIdx),
        1,
        SETTINGS_LIMITS.chaptersMax
      )
      set({ reader: base })
      await get().loadChapter(idx)
    } catch (error) {
      set({ view: 'library' })
      get().showToast('error', errorText(error))
    }
  },

  loadChapter: async (idx) => {
    const reader = get().reader
    if (!reader) return
    const projectId = reader.project.id
    const target = clamp(idx, 1, SETTINGS_LIMITS.chaptersMax)
    const seq = (loadSeq += 1)
    try {
      const data = await unwrap(window.shiye.enterReader(projectId, target))
      if (seq !== loadSeq) return
      const meta = data.chapters.find((chapter) => chapter.idx === target)
      set({
        reader: data,
        chapter: null,
        liveText: '',
        diff: null,
        panelTab: get().panelTab
      })
      if (!meta) {
        get().showToast('error', '这一章还没有建立。')
        return
      }
      const chapter = await unwrap(window.shiye.readChapter(meta.id))
      if (seq !== loadSeq) return
      set({ chapter, liveText: chapter.content })
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
    if (!chapter) return
    if (chapter.idx >= SETTINGS_LIMITS.chaptersMax) return
    await get().loadChapter(chapter.idx + 1)
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
  setPanelTab: (tab) => set({ panelTab: tab }),
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
          set({ liveText: '' })
        }
        return
      }
      case 'chapter:changed': {
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
        const reader = state.reader
        if (!reader || reader.project.id !== event.chapter.projectId) return
        set({ reader: { ...reader, chapters: mergeMetaList(reader.chapters, event.chapter) } })
        const chapter = get().chapter
        if (chapter && chapter.id === event.chapter.id) {
          set({
            chapter: {
              ...mergeChapterMeta(chapter, event.chapter),
              content: event.content
            },
            liveText: event.content
          })
        }
        return
      }
      case 'chapter:removed': {
        if (!state.reader || state.reader.project.id !== event.projectId) return
        void (async () => {
          try {
            const data = await unwrap(window.shiye.readProject(event.projectId))
            set({ reader: data })
            const current = get().chapter
            if (!current) return
            const fresh = data.chapters.find((chapter) => chapter.id === current.id)
            if (fresh) {
              const chapter = await unwrap(window.shiye.readChapter(fresh.id))
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
      default:
        return
    }
  }
}))

export function chapterFromState(chapter: Chapter | null, meta: ChapterMeta, content: string): Chapter {
  return chapter && chapter.id === meta.id ? mergeChapterMeta(chapter, meta) : chapterFromMeta(meta, content)
}
