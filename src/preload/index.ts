import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppEvent } from '@shared/types'
import type { ShiyeApi } from '@shared/api'
import { CHANNELS } from '@shared/ipc'

const api: ShiyeApi = {
  bootstrap: () => ipcRenderer.invoke(CHANNELS.bootstrap),
  listProjects: () => ipcRenderer.invoke(CHANNELS.projectsList),
  createSkeleton: (draft) => ipcRenderer.invoke(CHANNELS.skeletonCreate, draft),
  createBook: (input) => ipcRenderer.invoke(CHANNELS.bookCreate, input),
  updateProject: (projectId, patch) =>
    ipcRenderer.invoke(CHANNELS.projectUpdate, { projectId, ...patch }),
  deleteProject: (projectId) =>
    ipcRenderer.invoke(CHANNELS.projectDelete, { projectId }),
  readProject: (projectId) =>
    ipcRenderer.invoke(CHANNELS.readerRead, { projectId }),
  enterReader: (projectId, chapterIdx) =>
    ipcRenderer.invoke(CHANNELS.readerEnter, { projectId, chapterIdx }),
  readChapter: (chapterId) =>
    ipcRenderer.invoke(CHANNELS.readChapter, { chapterId }),
  updateCursor: (projectId, chapterIdx, ratio) =>
    ipcRenderer.invoke(CHANNELS.cursorUpdate, { projectId, chapterIdx, ratio }),
  requestChapter: (projectId, chapterIdx, urgent) =>
    ipcRenderer.invoke(CHANNELS.chapterRequest, { projectId, idx: chapterIdx, urgent }),
  cancelChapter: (chapterId) =>
    ipcRenderer.invoke(CHANNELS.chapterCancel, { chapterId }),
  regenerateChapter: (chapterId) =>
    ipcRenderer.invoke(CHANNELS.chapterRegenerate, { chapterId }),
  deleteChapter: (chapterId) =>
    ipcRenderer.invoke(CHANNELS.chapterDelete, { chapterId }),
  updateOutline: (input) =>
    ipcRenderer.invoke(CHANNELS.chapterOutline, input),
  saveSettings: (patch) => ipcRenderer.invoke(CHANNELS.settingsSave, patch),
  testModel: (input) => ipcRenderer.invoke(CHANNELS.modelTest, input),
  createDirective: (input) => ipcRenderer.invoke(CHANNELS.directiveCreate, input),
  deactivateDirective: (projectId, directiveId) =>
    ipcRenderer.invoke(CHANNELS.directiveDeactivate, { projectId, directiveId }),
  createBeats: (projectId, chapterIdx) =>
    ipcRenderer.invoke(CHANNELS.beats, { projectId, chapterIdx }),
  selectTargets: (chapterId, instruction) =>
    ipcRenderer.invoke(CHANNELS.rewriteSelect, { chapterId, instruction }),
  previewRewrite: (chapterId, instruction, targetIds) =>
    ipcRenderer.invoke(CHANNELS.rewritePreview, { chapterId, instruction, targetIds }),
  previewManual: (input) => ipcRenderer.invoke(CHANNELS.rewriteManual, input),
  applyRewrite: (previewId, editIds) =>
    ipcRenderer.invoke(CHANNELS.rewriteApply, { previewId, editIds }),
  discardRewrite: (previewId) =>
    ipcRenderer.invoke(CHANNELS.rewriteDiscard, { previewId }),
  fixIssues: (chapterId, issueText) =>
    ipcRenderer.invoke(CHANNELS.rewriteFix, { chapterId, issueText }),
  listVersions: (chapterId) =>
    ipcRenderer.invoke(CHANNELS.versionsList, { chapterId }),
  getVersion: (versionId) =>
    ipcRenderer.invoke(CHANNELS.versionsGet, { versionId }),
  restoreVersion: (chapterId, versionId) =>
    ipcRenderer.invoke(CHANNELS.versionsRestore, { chapterId, versionId }),
  staleAction: (chapterId, action) =>
    ipcRenderer.invoke(CHANNELS.staleAction, { chapterId, action }),
  getUsage: () => ipcRenderer.invoke(CHANNELS.usageGet),
  exportBook: (projectId, format) =>
    ipcRenderer.invoke(CHANNELS.exportBook, { projectId, format }),
  openDataFolder: () => ipcRenderer.invoke(CHANNELS.dataFolder),
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, event: AppEvent): void => listener(event)
    ipcRenderer.on(CHANNELS.event, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.event, handler)
    }
  }
}

contextBridge.exposeInMainWorld('shiye', api)
