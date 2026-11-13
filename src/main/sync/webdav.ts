import type { SyncConfig, SyncResult, SyncStatus } from '@shared/types'
import { AppError } from '../errors'
import type { DatabaseHandle } from '../db/sqlite'
import {
  buildSnapshot,
  mergeSnapshot,
  parseSnapshot,
  SNAPSHOT_MAX_BYTES,
  snapshotBytes
} from './snapshot'

function joinUrl(base: string, path: string): string {
  const cleanBase = base.trim().replace(/\/+$/u, '')
  const cleanPath = path.trim().replace(/^\/+/u, '')
  return `${cleanBase}/${cleanPath}`
}

function authHeader(config: SyncConfig): Record<string, string> {
  if (!config.username && !config.password) return {}
  const raw = `${config.username}:${config.password}`
  return { Authorization: `Basic ${base64(raw)}` }
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('sync_timeout', '连接云端超时。检查地址和网络后再试。')
    }
    throw new AppError('sync_network', '连不上云端。检查 WebDAV 地址和网络。')
  } finally {
    clearTimeout(timer)
  }
}

export function syncStatus(db: DatabaseHandle, config: SyncConfig): SyncStatus {
  const configured = Boolean(config.url.trim())
  const last = db
    .prepare("SELECT value FROM app_settings WHERE key = 'syncLastAt'")
    .get() as { value?: unknown } | undefined
  const message = db
    .prepare("SELECT value FROM app_settings WHERE key = 'syncLastMessage'")
    .get() as { value?: unknown } | undefined
  const rawAt = last && typeof last.value === 'string' ? Number(last.value) : 0
  return {
    configured,
    lastSyncAt: Number.isFinite(rawAt) && rawAt > 0 ? rawAt : null,
    lastMessage: message && typeof message.value === 'string' ? message.value : ''
  }
}

function remember(db: DatabaseHandle, message: string): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('syncLastAt', ?)").run(
    String(Date.now())
  )
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('syncLastMessage', ?)").run(
    message
  )
}

async function pull(config: SyncConfig): Promise<string | null> {
  const url = joinUrl(config.url, config.path || 'shiye-backup.json')
  const response = await request(url, {
    method: 'GET',
    headers: { ...authHeader(config), Accept: 'application/json' }
  })
  if (response.status === 404) return null
  if (response.status === 401 || response.status === 403) {
    throw new AppError('sync_auth', 'WebDAV 鉴权失败。检查用户名或应用密码。')
  }
  if (!response.ok) {
    throw new AppError('sync_http', `云端返回 ${response.status}，无法读取备份。`)
  }
  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > SNAPSHOT_MAX_BYTES) {
    throw new AppError('sync_too_large', '云端备份太大，已停止同步。')
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).length > SNAPSHOT_MAX_BYTES) {
    throw new AppError('sync_too_large', '云端备份太大，已停止同步。')
  }
  return text
}

async function push(config: SyncConfig, db: DatabaseHandle): Promise<number> {
  const snapshot = buildSnapshot(db)
  const body = JSON.stringify(snapshot)
  const url = joinUrl(config.url, config.path || 'shiye-backup.json')
  const response = await request(url, {
    method: 'PUT',
    headers: {
      ...authHeader(config),
      'Content-Type': 'application/json; charset=utf-8'
    },
    body
  })
  if (response.status === 401 || response.status === 403) {
    throw new AppError('sync_auth', 'WebDAV 鉴权失败。检查用户名或应用密码。')
  }
  if (!response.ok) {
    throw new AppError('sync_http', `云端返回 ${response.status}，无法上传备份。`)
  }
  return snapshot.projects.length
}

export async function runWebdavSync(db: DatabaseHandle, config: SyncConfig): Promise<SyncResult> {
  if (!config.url.trim()) {
    throw new AppError('sync_unconfigured', '还没有填写 WebDAV 地址。')
  }
  if (!/^https?:\/\//iu.test(config.url.trim())) {
    throw new AppError('sync_invalid', 'WebDAV 地址需要以 http:// 或 https:// 开头。')
  }
  const remoteText = await pull(config)
  let pulled = 0
  let skipped = 0
  let localNewer = 0
  if (remoteText) {
    const remote = parseSnapshot(remoteText)
    const merged = mergeSnapshot(db, remote)
    pulled = merged.pulled
    skipped = merged.skipped
    localNewer = merged.pushed
  }
  const pushed = await push(config, db)
  const bytes = snapshotBytes(buildSnapshot(db))
  const size = bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
  const message = remoteText
    ? `已合并云端备份：拉取 ${pulled} 本，本机更新 ${localNewer} 本，相同 ${skipped} 本。已上传 ${pushed} 本（${size}）。`
    : `云端还没有备份，已首次上传 ${pushed} 本（${size}）。`
  remember(db, message)
  return {
    pulledProjects: pulled,
    pushedProjects: pushed,
    skippedProjects: skipped,
    message
  }
}
