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
  importBook: (input) => ipcRenderer.invoke(CHANNELS.bookImport, input),
  importFromUrl: (input) => ipcRenderer.invoke(CHANNELS.bookImportUrl, input),
  importFromOpds: (url) => ipcRenderer.invoke(CHANNELS.bookImportRemote, { url }),
  browseOpds: (url) => ipcRenderer.invoke(CHANNELS.opdsBrowse, { url }),
  updateProject: (projectId, patch) =>
    ipcRenderer.invoke(CHANNELS.projectUpdate, { projectId, ...patch }),
  updateProjectMeta: (projectId, patch) =>
    ipcRenderer.invoke(CHANNELS.projectMeta, { projectId, ...patch }),
  deleteProject: (projectId) =>
    ipcRenderer.invoke(CHANNELS.projectDelete, { projectId }),
  deleteProjects: (projectIds) =>
    ipcRenderer.invoke(CHANNELS.projectBatchDelete, { projectIds }),
  findDuplicates: () => ipcRenderer.invoke(CHANNELS.projectDuplicates),
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
  plotBeats: (input) => ipcRenderer.invoke(CHANNELS.plotBeats, input),
  plotRewrite: (input) => ipcRenderer.invoke(CHANNELS.plotRewrite, input),
  plotCancel: (projectId, batchId) =>
    ipcRenderer.invoke(CHANNELS.plotCancel, { projectId, batchId }),
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
  search: (input) => ipcRenderer.invoke(CHANNELS.search, input),
  listBookmarks: (projectId) =>
    ipcRenderer.invoke(CHANNELS.bookmarkList, { projectId }),
  addBookmark: (input) => ipcRenderer.invoke(CHANNELS.bookmarkAdd, input),
  removeBookmark: (bookmarkId) =>
    ipcRenderer.invoke(CHANNELS.bookmarkRemove, { bookmarkId }),
  recordReading: (input) => ipcRenderer.invoke(CHANNELS.readingRecord, input),
  readingStats: (projectId) =>
    ipcRenderer.invoke(CHANNELS.readingStats, { projectId: projectId ?? null }),
  listShelves: () => ipcRenderer.invoke(CHANNELS.shelfList),
  createShelf: (name) => ipcRenderer.invoke(CHANNELS.shelfCreate, { name }),
  renameShelf: (shelfId, name) =>
    ipcRenderer.invoke(CHANNELS.shelfRename, { shelfId, name }),
  deleteShelf: (shelfId) => ipcRenderer.invoke(CHANNELS.shelfDelete, { shelfId }),
  addToShelf: (shelfId, projectIds) =>
    ipcRenderer.invoke(CHANNELS.shelfAdd, { shelfId, projectIds }),
  removeFromShelf: (shelfId, projectIds) =>
    ipcRenderer.invoke(CHANNELS.shelfRemove, { shelfId, projectIds }),
  askQuestion: (input) => ipcRenderer.invoke(CHANNELS.qaAsk, input),
  getAnalysis: (projectId) =>
    ipcRenderer.invoke(CHANNELS.analysisGet, { projectId }),
  analyzeChapter: (input) => ipcRenderer.invoke(CHANNELS.analysisChapter, input),
  analyzeBook: (input) => ipcRenderer.invoke(CHANNELS.analysisBook, input),
  setIssueStatus: (issueId, status) =>
    ipcRenderer.invoke(CHANNELS.analysisIssue, { issueId, status }),
  setForeshadowStatus: (foreshadowId, status) =>
    ipcRenderer.invoke(CHANNELS.analysisForeshadow, { foreshadowId, status }),
  clearAnalysis: (projectId) =>
    ipcRenderer.invoke(CHANNELS.analysisClear, { projectId }),
  syncStatus: () => ipcRenderer.invoke(CHANNELS.syncStatus),
  runSync: () => ipcRenderer.invoke(CHANNELS.syncRun),
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
