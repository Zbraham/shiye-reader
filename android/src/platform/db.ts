import initSqlJs, { type Database, type Statement } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { DatabaseHandle, RunResult, StatementHandle } from '@main/db/sqlite'
import { AppError } from '@main/errors'
import { logInfo } from '@main/logger'
import { createStorage, type DbStorage } from './storage'

const PERSIST_DELAY = 1200

class SqlJsStatement implements StatementHandle {
  constructor(
    private readonly raw: Database,
    private readonly sql: string,
    private readonly touched: () => void
  ) {}

  run(...params: unknown[]): RunResult {
    const statement = this.raw.prepare(this.sql)
    try {
      if (params.length > 0) statement.bind(params as never)
      statement.step()
      const changes = this.raw.getRowsModified()
      let lastInsertRowid: number | bigint = 0
      const result = this.raw.exec('SELECT last_insert_rowid() AS id')
      const value = result[0]?.values[0]?.[0]
      if (typeof value === 'number') lastInsertRowid = value
      else if (typeof value === 'bigint') lastInsertRowid = value
      else if (value !== null && value !== undefined) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) lastInsertRowid = parsed
      }
      this.touched()
      return { changes, lastInsertRowid }
    } finally {
      statement.free()
    }
  }

  get(...params: unknown[]): unknown {
    const statement = this.raw.prepare(this.sql)
    try {
      if (params.length > 0) statement.bind(params as never)
      if (!statement.step()) return undefined
      return statement.getAsObject()
    } finally {
      statement.free()
    }
  }

  all(...params: unknown[]): unknown[] {
    const statement = this.raw.prepare(this.sql)
    try {
      if (params.length > 0) statement.bind(params as never)
      const rows: unknown[] = []
      while (statement.step()) rows.push(statement.getAsObject())
      return rows
    } finally {
      statement.free()
    }
  }
}

export class SqlJsDatabase implements DatabaseHandle {
  readonly engine = 'sql.js' as const
  private depth = 0
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> | null = null
  private closed = false

  constructor(
    private readonly raw: Database,
    private readonly storage: DbStorage
  ) {}

  private touched(): void {
    if (this.closed) return
    this.dirty = true
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, PERSIST_DELAY)
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.saving) await this.saving
    if (!this.dirty || this.closed) return
    this.dirty = false
    const bytes = this.raw.export()
    this.saving = this.storage.save(bytes)
    try {
      await this.saving
    } catch {
      this.dirty = true
    } finally {
      this.saving = null
    }
    if (this.dirty && !this.closed) this.touched()
  }

  snapshot(): Uint8Array {
    return this.raw.export()
  }

  exec(sql: string): void {
    this.raw.run(sql)
    this.touched()
  }

  prepare(sql: string): StatementHandle {
    return new SqlJsStatement(this.raw, sql, () => this.touched())
  }

  queryPragma(statement: string): unknown[] {
    const result = this.raw.exec(`PRAGMA ${statement}`)
    const first = result[0]
    if (!first) return []
    return first.values.map((row) => {
      const record: Record<string, unknown> = {}
      first.columns.forEach((column, index) => {
        record[column] = row[index]
      })
      return record
    })
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth += 1
      try {
        return fn()
      } finally {
        this.depth -= 1
      }
    }
    this.raw.run('BEGIN IMMEDIATE')
    this.depth = 1
    try {
      const result = fn()
      this.raw.run('COMMIT')
      return result
    } catch (error) {
      try {
        this.raw.run('ROLLBACK')
      } catch {
        // The original error is more useful.
      }
      throw error
    } finally {
      this.depth = 0
      this.touched()
    }
  }

  close(): void {
    if (this.closed) return
    try {
      const bytes = this.raw.export()
      void this.storage.save(bytes)
    } catch {
      // Never let a final persistence attempt block shutdown.
    }
    this.closed = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.raw.close()
  }
}

function integrityOk(db: DatabaseHandle): boolean {
  try {
    const rows = db.queryPragma('integrity_check')
    const first = rows[0]
    if (first && typeof first === 'object') {
      const value = Object.values(first)[0]
      return String(value).toLowerCase() === 'ok'
    }
    return String(first).toLowerCase() === 'ok'
  } catch {
    return false
  }
}

export interface OpenedDatabase {
  db: SqlJsDatabase
  corrupt: boolean
}

export async function openAndroidDatabase(): Promise<OpenedDatabase> {
  const storage = createStorage()
  let SQL: Awaited<ReturnType<typeof initSqlJs>>
  try {
    SQL = await initSqlJs({ locateFile: () => wasmUrl })
  } catch (error) {
    throw new AppError(
      'db_open',
      `本地数据库组件未能加载。${error instanceof Error ? error.message : ''}`
    )
  }

  const bytes = await storage.load()
  if (bytes && bytes.length > 0) {
    try {
      const raw = new SQL.Database(bytes)
      const db = new SqlJsDatabase(raw, storage)
      if (integrityOk(db)) {
        raw.run('PRAGMA foreign_keys = ON')
        logInfo('db', `using sql.js (${bytes.length} bytes)`)
        return { db, corrupt: false }
      }
      raw.close()
    } catch {
      // Fall through to a fresh database.
    }
  }

  const raw = new SQL.Database()
  raw.run('PRAGMA foreign_keys = ON')
  const db = new SqlJsDatabase(raw, storage)
  logInfo('db', 'using sql.js (new database)')
  return { db, corrupt: Boolean(bytes && bytes.length > 0) }
}

/** Re-apply pragmas after loading; sql.js keeps them per connection. */
export function prepareDatabase(db: DatabaseHandle): void {
  try {
    db.exec('PRAGMA foreign_keys = ON')
  } catch {
    // Older SQLite builds may not support this pragma; persistence still works.
  }
}

export type { Statement }
