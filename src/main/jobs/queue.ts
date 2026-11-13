import type { JobInfo, JobType } from '@shared/types'
import { isAbortError } from '../errors'
import { logError } from '../logger'
import { createJob, updateJobStatus } from '../db/repo'
import type { DatabaseHandle } from '../db/sqlite'

export interface QueueTask {
  key: string
  lane: 'writer' | 'utility'
  urgent?: boolean
  title: string
  type: JobType
  projectId: string
  chapterId: string | null
  run: (signal: AbortSignal, job: JobInfo) => Promise<void>
}

interface Entry {
  task: QueueTask
  job: JobInfo
  controller: AbortController | null
  done: Promise<void>
  resolveDone: () => void
}

const UTILITY_CONCURRENCY = 3

export class TaskQueue {
  private readonly entries = new Map<string, Entry>()
  private readonly writerQueue: Entry[] = []
  private readonly utilityQueue: Entry[] = []
  private writerRunning: Entry | null = null
  private readonly utilityRunning = new Set<Entry>()

  constructor(
    private readonly db: DatabaseHandle,
    private readonly emitJobs: (jobs: JobInfo[]) => void,
    private readonly onError: (message: string) => void
  ) {}

  enqueue(task: QueueTask): void {
    const existing = this.entries.get(task.key)
    if (existing) {
      if (task.urgent && task.lane === 'writer' && !existing.controller) {
        const index = this.writerQueue.indexOf(existing)
        if (index > 0) {
          this.writerQueue.splice(index, 1)
          this.writerQueue.unshift(existing)
          this.emit()
        }
      }
      return
    }

    const job = createJob(
      this.db,
      task.type,
      task.projectId,
      task.chapterId,
      task.title
    )
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    const entry: Entry = {
      task,
      job,
      controller: null,
      done,
      resolveDone
    }
    this.entries.set(task.key, entry)
    if (task.lane === 'writer') {
      if (task.urgent) this.writerQueue.unshift(entry)
      else this.writerQueue.push(entry)
    } else {
      this.utilityQueue.push(entry)
    }
    this.emit()
    this.pump()
  }

  private pump(): void {
    if (!this.writerRunning && this.writerQueue.length > 0) {
      const next = this.writerQueue.shift()
      if (next) this.start(next)
    }
    while (this.utilityRunning.size < UTILITY_CONCURRENCY && this.utilityQueue.length > 0) {
      const next = this.utilityQueue.shift()
      if (next) this.start(next)
    }
  }

  private start(entry: Entry): void {
    const controller = new AbortController()
    entry.controller = controller
    entry.job = { ...entry.job, status: 'running' }
    updateJobStatus(this.db, entry.job.id, 'running')
    if (entry.task.lane === 'writer') this.writerRunning = entry
    else this.utilityRunning.add(entry)
    this.emit()

    entry.task
      .run(controller.signal, entry.job)
      .then(() => {
        updateJobStatus(this.db, entry.job.id, 'done', 1)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          updateJobStatus(this.db, entry.job.id, 'cancelled')
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        logError('job', error)
        updateJobStatus(this.db, entry.job.id, 'error', 0, message.slice(0, 200))
        this.onError(message)
      })
      .finally(() => {
        this.entries.delete(entry.task.key)
        if (this.writerRunning === entry) this.writerRunning = null
        this.utilityRunning.delete(entry)
        entry.resolveDone()
        this.emit()
        this.pump()
      })
  }

  cancelChapter(chapterId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.task.chapterId !== chapterId) continue
      if (entry.controller) {
        entry.controller.abort()
      } else {
        this.removeQueued(entry)
        this.entries.delete(key)
        updateJobStatus(this.db, entry.job.id, 'cancelled')
        entry.resolveDone()
      }
    }
    this.emit()
  }

  cancelKey(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.controller) entry.controller.abort()
    else {
      this.removeQueued(entry)
      this.entries.delete(key)
      updateJobStatus(this.db, entry.job.id, 'cancelled')
      entry.resolveDone()
    }
    this.emit()
  }

  /** Cancels a single key and resolves once the task has fully stopped. */
  async cancelKeyAndWait(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.controller) {
      entry.controller.abort()
      await entry.done
      return
    }
    this.removeQueued(entry)
    this.entries.delete(key)
    updateJobStatus(this.db, entry.job.id, 'cancelled')
    entry.resolveDone()
    this.emit()
  }

  private removeQueued(entry: Entry): void {
    const writerIndex = this.writerQueue.indexOf(entry)
    if (writerIndex >= 0) this.writerQueue.splice(writerIndex, 1)
    const utilityIndex = this.utilityQueue.indexOf(entry)
    if (utilityIndex >= 0) this.utilityQueue.splice(utilityIndex, 1)
  }

  /** Aborts running writer tasks for a project and clears queued writer tasks. */
  async cancelProjectWriters(projectId: string): Promise<string[]> {
    const chapterIds: string[] = []
    const waits: Promise<void>[] = []
    for (const entry of [...this.entries.values()]) {
      if (entry.task.lane !== 'writer' || entry.task.projectId !== projectId) continue
      if (entry.task.chapterId) chapterIds.push(entry.task.chapterId)
      if (entry.controller) {
        entry.controller.abort()
        waits.push(entry.done)
      } else {
        this.removeQueued(entry)
        this.entries.delete(entry.task.key)
        updateJobStatus(this.db, entry.job.id, 'cancelled')
        entry.resolveDone()
      }
    }
    this.emit()
    await Promise.all(waits)
    return chapterIds
  }

  /** Aborts everything and resolves once every task has stopped writing. */
  async cancelAll(): Promise<void> {
    const waits: Promise<void>[] = []
    for (const [key, entry] of [...this.entries]) {
      if (entry.controller) {
        entry.controller.abort()
        waits.push(entry.done)
      } else {
        this.removeQueued(entry)
        this.entries.delete(key)
        updateJobStatus(this.db, entry.job.id, 'cancelled')
        entry.resolveDone()
      }
    }
    this.emit()
    await Promise.all(waits)
  }

  hasKey(key: string): boolean {
    return this.entries.has(key)
  }

  activeJobs(): JobInfo[] {
    return [...this.entries.values()].map((entry) => entry.job)
  }

  chapterJobRunning(chapterId: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.task.chapterId === chapterId && entry.task.lane === 'writer') return true
    }
    return false
  }

  private emit(): void {
    this.emitJobs(this.activeJobs())
  }

  async waitForIdle(): Promise<void> {
    while (this.entries.size > 0) {
      await Promise.all([...this.entries.values()].map((entry) => entry.done))
    }
  }
}
