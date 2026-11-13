import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { APP_NAME } from '@shared/constants'
import { themes } from '@shared/tokens'
import { CHANNELS } from '@shared/ipc'
import type { AppEvent, AppSettings } from '@shared/types'
import { logError, logInfo } from './logger'
import { initLogger } from './logger-node'
import { integrityOk, openDatabase } from './db/sqlite'
import type { DatabaseHandle } from './db/sqlite'
import { migrate } from './db/schema'
import {
  loadSettings,
  pruneJobs,
  recoverInterruptedChapters,
  usageSummary
} from './db/repo'
import { StoryEngine } from './engine'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let database: DatabaseHandle | null = null
let engine: StoryEngine | null = null
let quitting = false

const singleInstance = app.requestSingleInstanceLock()

if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  void start()
}

function bootstrapDatabase(dataDir: string, notices: string[]): DatabaseHandle {
  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, 'shiye.db')
  let db: DatabaseHandle
  if (existsSync(file)) {
    try {
      db = openDatabase(file)
      if (!integrityOk(db)) {
        db.close()
        throw new Error('integrity check failed')
      }
    } catch (error) {
      logError('db', error)
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
      } catch (renameError) {
        logError('db', renameError)
      }
      notices.push('本地数据文件损坏，已另存备份并重新建立。')
      db = openDatabase(file)
    }
  } else {
    db = openDatabase(file)
  }
  migrate(db)
  const recovered = recoverInterruptedChapters(db)
  if (recovered > 0) {
    notices.push(`上次退出时有 ${recovered} 章没有写完，已保留为草稿。`)
  }
  pruneJobs(db)
  return db
}

function broadcast(event: AppEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(CHANNELS.event, event)
    }
  }
}

async function start(): Promise<void> {
  await app.whenReady()

  app.setAppUserModelId('com.shiye.reader')
  Menu.setApplicationMenu(null)

  const dataDir = join(app.getPath('userData'), 'data')
  initLogger(dataDir)

  const notices: string[] = []
  const db = bootstrapDatabase(dataDir, notices)
  database = db

  let settings: AppSettings = loadSettings(db)
  const getSettings = (): AppSettings => settings
  const setSettings = (next: AppSettings): void => {
    settings = next
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(themes[next.theme].colors.bg)
    }
  }

  const storyEngine = new StoryEngine({
    db,
    getSettings,
    emit: broadcast
  })
  engine = storyEngine

  registerIpc({
    engine: storyEngine,
    db,
    dataDir,
    getSettings,
    setSettings,
    takeNotices: () => {
      const pending = notices.slice()
      notices.length = 0
      return pending
    },
    broadcast
  })

  createWindow(settings)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(getSettings())
    }
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void shutdown()
  })

  logInfo('app', `started with ${usageSummary(db).requests} recorded requests`)
}

function createWindow(settings: AppSettings): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: themes[settings.theme].colors.bg,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
  mainWindow = window

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  window.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function shutdown(): Promise<void> {
  try {
    if (engine) await engine.queue.cancelAll()
  } catch (error) {
    logError('shutdown', error)
  }
  try {
    database?.close()
  } catch (error) {
    logError('shutdown', error)
  }
  database = null
  engine = null
  app.quit()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
