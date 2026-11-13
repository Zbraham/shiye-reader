import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { AppEvent, AppSettings, ExportFormat, ExportResult } from '@shared/types'
import { CHANNELS } from '@shared/ipc'
import { AppError } from './errors'
import type { StoryEngine } from './engine'
import type { DatabaseHandle } from './db/sqlite'
import {
  createService,
  exportExtension,
  sanitizeFileName,
  type ExportArtifact
} from './service'

export interface IpcDeps {
  engine: StoryEngine
  db: DatabaseHandle
  dataDir: string
  getSettings: () => AppSettings
  setSettings: (settings: AppSettings) => void
  takeNotices: () => string[]
  broadcast: (event: AppEvent) => void
}

const FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  txt: { name: '纯文本', extensions: ['txt'] },
  md: { name: 'Markdown', extensions: ['md'] },
  epub: { name: 'EPUB', extensions: ['epub'] },
  docx: { name: 'Word 文档', extensions: ['docx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] }
}

async function renderPdf(artifact: ExportArtifact, filePath: string): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      javascript: false
    }
  })
  try {
    const html = artifact.html ?? '<!doctype html><html><body></body></html>'
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const buffer = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    await writeFile(filePath, buffer)
  } finally {
    window.destroy()
  }
}

async function exportBookNode(
  artifact: ExportArtifact,
  dataDir: string
): Promise<{ path: string }> {
  const extension = exportExtension(artifact.format)
  const result = await dialog.showSaveDialog({
    title: '导出',
    defaultPath: join(dataDir, `${sanitizeFileName(artifact.fileName.replace(/\.[^.]+$/u, ''))}.${extension}`),
    filters: [FILTERS[artifact.format]]
  })
  if (result.canceled || !result.filePath) {
    throw new AppError('cancelled', '已取消导出。')
  }

  if (artifact.format === 'pdf') {
    await renderPdf(artifact, result.filePath)
  } else {
    await writeFile(result.filePath, artifact.bytes)
  }
  return { path: result.filePath }
}

async function openDataFolderNode(dataDir: string): Promise<null> {
  const error = await shell.openPath(dataDir)
  if (error) throw new AppError('open_failed', '无法打开数据目录。')
  return null
}

export function registerIpc(deps: IpcDeps): void {
  const service = createService({
    ...deps,
    platform: process.platform,
    writeExport: (artifact) => exportBookNode(artifact, deps.dataDir),
    openDataFolder: () => openDataFolderNode(deps.dataDir)
  })

  for (const channel of Object.values(CHANNELS)) {
    if (channel === CHANNELS.event) continue
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_event, raw: unknown) => service[channel](raw))
  }
}

export type { ExportResult }
