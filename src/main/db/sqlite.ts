import { createRequire } from 'node:module'
import { AppError } from '../errors'
import { logInfo } from '../logger'

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface StatementHandle {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface DatabaseHandle {
  readonly engine: 'better-sqlite3' | 'node:sqlite' | 'sql.js'
  exec(sql: string): void
  prepare(sql: string): StatementHandle
  queryPragma(statement: string): unknown[]
  transaction<T>(fn: () => T): T
  close(): void
}

interface NativeStatement {
  run(...params: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface NativeDatabase {
  prepare(sql: string): NativeStatement
  exec(sql: string): void
  close(): void
  pragma?(statement: string): unknown
}

const nodeRequire = createRequire(__filename)

class SqliteHandle implements DatabaseHandle {
  private depth = 0

  constructor(
    private readonly raw: NativeDatabase,
    readonly engine: 'better-sqlite3' | 'node:sqlite'
  ) {}

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  prepare(sql: string): StatementHandle {
    const statement = this.raw.prepare(sql)
    return {
      run: (...params: unknown[]): RunResult => {
        const result = statement.run(...params)
        return {
          changes: Number(result.changes ?? 0),
          lastInsertRowid: result.lastInsertRowid ?? 0
        }
      },
      get: (...params: unknown[]): unknown => statement.get(...params),
      all: (...params: unknown[]): unknown[] => statement.all(...params)
    }
  }

  queryPragma(statement: string): unknown[] {
    if (this.engine === 'better-sqlite3' && this.raw.pragma) {
      const result = this.raw.pragma(statement)
      return Array.isArray(result) ? result : [result]
    }
    return this.raw.prepare(`PRAGMA ${statement}`).all()
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
    this.raw.exec('BEGIN IMMEDIATE')
    this.depth = 1
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK')
      } catch {
        // The original error is more useful.
      }
      throw error
    } finally {
      this.depth = 0
    }
  }

  close(): void {
    this.raw.close()
  }
}

export function openDatabase(file: string): DatabaseHandle {
  const errors: string[] = []

  try {
    const BetterSqlite = nodeRequire('better-sqlite3') as new (path: string) => NativeDatabase
    const raw = new BetterSqlite(file)
    raw.exec('PRAGMA journal_mode = WAL')
    raw.exec('PRAGMA foreign_keys = ON')
    raw.exec('PRAGMA busy_timeout = 4000')
    raw.exec('PRAGMA synchronous = NORMAL')
    logInfo('db', 'using better-sqlite3')
    return new SqliteHandle(raw, 'better-sqlite3')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const sqlite = nodeRequire('node:sqlite') as {
      DatabaseSync: new (path: string) => NativeDatabase
    }
    const raw = new sqlite.DatabaseSync(file)
    raw.exec('PRAGMA journal_mode = WAL')
    raw.exec('PRAGMA foreign_keys = ON')
    raw.exec('PRAGMA busy_timeout = 4000')
    logInfo('db', 'using node:sqlite')
    return new SqliteHandle(raw, 'node:sqlite')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  throw new AppError(
    'db_open',
    `无法打开本地数据库。${errors.join(' / ').slice(0, 220)}`
  )
}

export function integrityOk(db: DatabaseHandle): boolean {
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
