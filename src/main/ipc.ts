import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain, shell } from 'electron'
import type { AppEvent, AppSettings, ExportResult } from '@shared/types'
import { CHANNELS } from '@shared/ipc'
import { AppError } from './errors'
import type { StoryEngine } from './engine'
import type { DatabaseHandle } from './db/sqlite'
import {
  buildExportText,
  createService,
  exportExtension,
  sanitizeFileName,
  type ExportPayload
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

async function exportBookNode(
  payload: ExportPayload,
  dataDir: string
): Promise<{ path: string }> {
  const extension = exportExtension(payload.format)
  const result = await dialog.showSaveDialog({
    title: '导出',
    defaultPath: join(dataDir, `${sanitizeFileName(payload.title)}.${extension}`),
    filters:
      payload.format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: '纯文本', extensions: ['txt'] }]
  })
  if (result.canceled || !result.filePath) {
    throw new AppError('cancelled', '已取消导出。')
  }

  const filePath = result.filePath
  const text = buildExportText(payload)
  const stream = createWriteStream(filePath, { encoding: 'utf8' })
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.once('finish', resolve)
    stream.end(text)
  })
  return { path: filePath }
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
    writeExport: (payload) => exportBookNode(payload, deps.dataDir),
    openDataFolder: () => openDataFolderNode(deps.dataDir)
  })

  for (const channel of Object.values(CHANNELS)) {
    if (channel === CHANNELS.event) continue
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_event, raw: unknown) => service[channel](raw))
  }
}

export type { ExportResult }
