import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'

export interface DbStorage {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
}

const DATA_DIR = 'data'
const DB_PATH = `${DATA_DIR}/shiye.db`
const BAK_PATH = `${DATA_DIR}/shiye.db.bak`
const TMP_PATH = `${DATA_DIR}/shiye.db.tmp`

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(offset, Math.min(offset + chunk, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: Directory.Data })
    return true
  } catch {
    return false
  }
}

class NativeDbStorage implements DbStorage {
  async load(): Promise<Uint8Array | null> {
    for (const path of [DB_PATH, BAK_PATH]) {
      try {
        const result = await Filesystem.readFile({ path, directory: Directory.Data })
        if (typeof result.data !== 'string' || !result.data) continue
        return base64ToBytes(result.data)
      } catch {
        // Try the next candidate.
      }
    }
    return null
  }

  async save(bytes: Uint8Array): Promise<void> {
    const base64 = bytesToBase64(bytes)
    await Filesystem.writeFile({
      path: TMP_PATH,
      directory: Directory.Data,
      data: base64,
      recursive: true
    })

    try {
      if (await fileExists(BAK_PATH)) {
        await Filesystem.deleteFile({ path: BAK_PATH, directory: Directory.Data })
      }
      if (await fileExists(DB_PATH)) {
        await Filesystem.rename({
          from: DB_PATH,
          to: BAK_PATH,
          directory: Directory.Data,
          toDirectory: Directory.Data
        })
      }
      await Filesystem.rename({
        from: TMP_PATH,
        to: DB_PATH,
        directory: Directory.Data,
        toDirectory: Directory.Data
      })
    } catch {
      // Rename can fail on unusual filesystems. The direct write still keeps
      // the latest database, and the previous file remains as the backup.
      await Filesystem.writeFile({
        path: DB_PATH,
        directory: Directory.Data,
        data: base64,
        recursive: true
      })
    }
  }
}

const WEB_DB_NAME = 'shiye-reader'
const WEB_STORE = 'database'
const WEB_KEY = 'shiye.db'

function openWebDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(WEB_STORE)) db.createObjectStore(WEB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

class WebDbStorage implements DbStorage {
  async load(): Promise<Uint8Array | null> {
    try {
      const db = await openWebDb()
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(WEB_STORE, 'readonly')
        const request = tx.objectStore(WEB_STORE).get(WEB_KEY)
        request.onsuccess = () => {
          const value = request.result as unknown
          if (value instanceof Uint8Array) resolve(value)
          else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value))
          else resolve(null)
        }
        request.onerror = () => reject(request.error ?? new Error('read failed'))
        tx.oncomplete = () => db.close()
      })
    } catch {
      return null
    }
  }

  async save(bytes: Uint8Array): Promise<void> {
    try {
      const db = await openWebDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(WEB_STORE, 'readwrite')
        tx.objectStore(WEB_STORE).put(bytes.slice(), WEB_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('write failed'))
      })
      db.close()
    } catch {
      // Private browsing may block IndexedDB. The session still works in memory.
    }
  }
}

export function createStorage(): DbStorage {
  return isNative() ? new NativeDbStorage() : new WebDbStorage()
}
