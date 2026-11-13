import type { ReaderFont, ThemeName } from './tokens'

/* ------------------------------------------------------------------ */
/* Domain                                                              */
/* ------------------------------------------------------------------ */

export type ChapterStatus =
  | 'outline'
  | 'queued'
  | 'generating'
  | 'draft'
  | 'final'
  | 'stale'

export type RoleTag = '对话' | '动作' | '描写' | '心理' | '转折' | '信息'

export interface Project {
  id: string
  title: string
  themePrompt: string
  genre: string
  tone: string
  pov: string
  styleGuide: string
  styleSample: string
  targetLenPerChapter: number
  synopsis: string
  sellingPoint: string
  createdAt: number
  updatedAt: number
  lastChapterIdx: number
  lastOffsetRatio: number
  buffer: number
  chapterMin: number
  chapterMax: number
}

export interface ProjectBrief {
  id: string
  title: string
  genre: string
  chapterCount: number
  readChapter: number
  wordCount: number
  updatedAt: number
  createdAt: number
  coverIndex: number
  hasPartial: boolean
}

export interface ChapterOutline {
  title: string
  goals: string[]
  advance: string[]
  forbidden: string[]
  hook: string
}

export interface ConsistencyIssue {
  type: 'name' | 'timeline' | 'ability' | 'foreshadow' | 'pov'
  detail: string
  chunkHint: string
}

export interface Chapter {
  id: string
  projectId: string
  idx: number
  title: string
  status: ChapterStatus
  content: string
  wordCount: number
  summaryL1: string
  summaryL2: string
  outline: ChapterOutline | null
  version: number
  generatedAt: number | null
  staleReason: string
  error: string
  issues: ConsistencyIssue[]
  updatedAt: number
}

export interface ChapterMeta {
  id: string
  projectId: string
  idx: number
  title: string
  status: ChapterStatus
  wordCount: number
  summaryL2: string
  version: number
  staleReason: string
  error: string
  updatedAt: number
}

export interface Chunk {
  id: string
  chapterId: string
  idx: number
  startOff: number
  endOff: number
  text: string
  roleTag: RoleTag
  hash: string
}

export interface CharacterState {
  location: string
  condition: string
  intent: string
}

export interface Character {
  id: string
  projectId: string
  name: string
  aliases: string[]
  profile: string
  state: CharacterState
  firstChapter: number
}

export interface StoryStateEntry {
  key: string
  value: string
}

export interface ForeshadowItem {
  id: string
  text: string
  chapter: number
}

export type DirectiveScope = '本章' | '后续3章' | '本卷' | '全书'
export type DirectiveStatus = 'pending' | 'applied' | 'expired'

export interface Directive {
  id: string
  projectId: string
  scope: DirectiveScope
  content: string
  status: DirectiveStatus
  createdAt: number
  appliedChapter: number | null
  expiresChapter: number | null
}

export interface VersionDiffEdit {
  chunkId: string
  displayId: string
  action: RewriteAction
  before: string
  after: string
  reason: string
}

export interface VersionDiff {
  edits: VersionDiffEdit[]
  beforeWordCount: number
  afterWordCount: number
}

export interface VersionMeta {
  id: string
  chapterId: string
  seq: number
  reason: string
  createdAt: number
  beforeWordCount: number
  afterWordCount: number
}

export interface VersionDetail extends VersionMeta {
  content: string
  diff: VersionDiff | null
}

export type JobType =
  | 'chapter'
  | 'outline'
  | 'summary'
  | 'check'
  | 'rewrite'
  | 'beats'
  | 'tag'

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface JobInfo {
  id: string
  type: JobType
  chapterId: string | null
  projectId: string
  label: string
  status: JobStatus
  progress: number
  error: string
  createdAt: number
}

/* ------------------------------------------------------------------ */
/* Story skeleton                                                      */
/* ------------------------------------------------------------------ */

export interface SkeletonCharacter {
  name: string
  identity: string
  desire: string
  secret: string
}

export interface SkeletonChapter {
  title: string
  goals: string[]
  hook: string
}

export interface StorySkeleton {
  titles: string[]
  sellingPoint: string
  synopsis: string
  characters: SkeletonCharacter[]
  world: string[]
  chapters: SkeletonChapter[]
}

export interface CreateProjectInput {
  title: string
  themePrompt: string
  genre: string
  tone: string
  pov: string
  targetLenPerChapter: number
  styleSample: string
  styleGuide: string
  skeleton: StorySkeleton
}

export interface SetupDraft {
  themePrompt: string
  genre: string
  tone: string
  pov: string
  targetLenPerChapter: number
  styleSample: string
  styleGuide: string
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type ProviderKind = 'builtin' | 'openai'

export interface AppSettings {
  provider: ProviderKind
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  temperature: number
  theme: ThemeName
  fontSize: number
  readerFont: ReaderFont
  indent: boolean
  buffer: number
  chapterMin: number
  chapterMax: number
  consistencyCheck: boolean
  openLastOnLaunch: boolean
  lastProjectId: string | null
  lastView: 'library' | 'reader'
}

export interface UsageSummary {
  requests: number
  promptTokens: number
  completionTokens: number
  last30DaysRequests: number
}

export interface BootstrapData {
  projects: ProjectBrief[]
  settings: AppSettings
  activeJobs: JobInfo[]
  notices: string[]
  platform: string
  version: string
  dataDir: string
  usage: UsageSummary
  resume: { projectId: string; chapterIdx: number } | null
}

export interface ReaderData {
  project: Project
  chapters: ChapterMeta[]
  directives: Directive[]
  characters: Character[]
  storyState: StoryStateEntry[]
  activeJobs: JobInfo[]
}

/* ------------------------------------------------------------------ */
/* Rewrite                                                             */
/* ------------------------------------------------------------------ */

export type RewriteAction = 'rewrite' | 'delete' | 'insert_after' | 'move'

export interface RewriteTarget {
  chunkId: string
  displayId: string
  idx: number
  text: string
  roleTag: RoleTag
  action: RewriteAction
  reason: string
  hint: string
}

export interface RewriteEdit {
  chunkId: string
  displayId: string
  action: RewriteAction
  before: string
  after: string
  reason: string
  hint: string
  moveAfterId: string
}

export interface RewritePreview {
  id: string
  chapterId: string
  chapterIdx: number
  instruction: string
  chapterVersion: number
  globalNote: string
  edits: RewriteEdit[]
  origin: 'model' | 'manual'
  beforeWordCount: number
  afterWordCount: number
}

export interface ManualRewriteInput {
  projectId: string
  chapterId: string
  start: number
  end: number
  mode: 'rewrite' | 'expand' | 'condense' | 'tone' | 'continue'
  instruction: string
}

export interface ApplyRewriteInput {
  previewId: string
  editIds?: string[]
}

export interface ApplyRewriteResult {
  chapter: ChapterMeta
  staleChapters: number[]
  issues: ConsistencyIssue[]
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ExportResult {
  path: string
  chapters: number
  words: number
}

/* ------------------------------------------------------------------ */
/* Events and IPC                                                      */
/* ------------------------------------------------------------------ */

export type AppEvent =
  | {
      type: 'chapter:delta'
      chapterId: string
      projectId: string
      idx: number
      text: string
      chars: number
    }
  | { type: 'chapter:reset'; chapterId: string; projectId: string; idx: number }
  | { type: 'chapter:changed'; chapter: ChapterMeta }
  | { type: 'chapter:content'; chapter: ChapterMeta; content: string }
  | { type: 'chapter:removed'; projectId: string; idx: number }
  | { type: 'project:changed'; project: Project }
  | { type: 'projects:changed' }
  | { type: 'directives:changed'; projectId: string }
  | { type: 'jobs:changed'; jobs: JobInfo[] }
  | { type: 'notice'; tone: 'info' | 'error'; message: string }
  | { type: 'usage:changed'; usage: UsageSummary }

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface SetupResult {
  projectId: string
}

export interface TestModelResult {
  ok: boolean
  detail: string
  latencyMs: number
}

export interface BeatsResult {
  beats: string[]
}

export interface SelectTargetsResult {
  targets: RewriteTarget[]
  globalNote: string
}
