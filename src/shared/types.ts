import type { ReaderFont, ThemeName } from './tokens'
import type { ParsedBook } from './import/types'

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

export type ProjectSource = 'generated' | 'imported'

export type BookReadStatus = 'none' | 'want' | 'reading' | 'done' | 'dropped'

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
  source: ProjectSource
  importedAt: number | null
  originalFile: string
  author: string
  series: string
  publisher: string
  language: string
  description: string
  tags: string[]
  rating: number
  readStatus: BookReadStatus
  coverData: string
}

export interface ProjectBrief {
  id: string
  title: string
  genre: string
  source: ProjectSource
  chapterCount: number
  readChapter: number
  wordCount: number
  updatedAt: number
  createdAt: number
  coverIndex: number
  hasPartial: boolean
  author: string
  series: string
  tags: string[]
  rating: number
  readStatus: BookReadStatus
  coverData: string
  lastOffsetRatio: number
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
  html: string
  volume: string
  level: number
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
  lastOffsetRatio: number
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
  volume: string
  level: number
  lastOffsetRatio: number
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
export type DirectiveOrigin = 'user' | 'plot'

export interface Directive {
  id: string
  projectId: string
  scope: DirectiveScope
  content: string
  status: DirectiveStatus
  createdAt: number
  appliedChapter: number | null
  expiresChapter: number | null
  startsChapter: number | null
  origin: DirectiveOrigin
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
/* Import and plot continuation                                        */
/* ------------------------------------------------------------------ */

export interface ImportBookInput {
  title: string
  genre: string
  tone: string
  pov: string
  styleSample: string
  styleGuide: string
  targetLenPerChapter: number
  sourceFile: string
  author?: string
  series?: string
  publisher?: string
  language?: string
  description?: string
  tags?: string[]
  coverData?: string
  chapters: {
    title: string
    content: string
    html?: string
    volume?: string
    level?: number
  }[]
}

export type PlotStartMode = 'after' | 'include' | 'paragraph'

export interface PlotBeatsInput {
  projectId: string
  fromIdx: number
  startMode: PlotStartMode
  startOffset: number | null
}

export interface PlotRewriteInput extends PlotBeatsInput {
  direction: string
  batchSize: 3
}

export interface PlotUnitResult {
  idx: number
  chapterId: string
  mode: 'replaced' | 'created' | 'seeded'
  versionId: string | null
}

export interface PlotRewriteResult {
  batchId: string
  directiveId: string
  units: PlotUnitResult[]
  replaceTo: number
  staleFrom: number
}

export type PlotBatchStatus = 'running' | 'done' | 'stopped' | 'failed'

/* ------------------------------------------------------------------ */
/* Reading workspace                                                   */
/* ------------------------------------------------------------------ */

export interface Bookmark {
  id: string
  projectId: string
  chapterId: string
  chapterIdx: number
  ratio: number
  label: string
  excerpt: string
  createdAt: number
}

export interface BookmarkInput {
  projectId: string
  chapterId: string
  chapterIdx: number
  ratio: number
  label: string
  excerpt: string
}

export interface SearchInput {
  projectId?: string | null
  query: string
  limit?: number
  beforeIdx?: number | null
}

export interface SearchHit {
  projectId: string
  projectTitle: string
  chapterId: string
  chapterIdx: number
  chapterTitle: string
  snippet: string
  matchOffset: number
  score: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  tookMs: number
  truncated: boolean
}

export interface ReadingDay {
  day: string
  seconds: number
  words: number
}

export interface ReadingStats {
  totalSeconds: number
  todaySeconds: number
  streakDays: number
  totalWords: number
  days: ReadingDay[]
  bookSeconds: Array<{ projectId: string; title: string; seconds: number }>
}

export interface ReadingRecordInput {
  projectId: string
  seconds: number
  words: number
}

export interface Shelf {
  id: string
  name: string
  createdAt: number
  projectIds: string[]
}

export interface ProjectMetadataPatch {
  title?: string
  author?: string
  series?: string
  publisher?: string
  language?: string
  description?: string
  tags?: string[]
  rating?: number
  readStatus?: BookReadStatus
  coverData?: string
}

export interface ProjectListFilter {
  query?: string
  readStatus?: BookReadStatus | 'all'
  source?: ProjectSource | 'all'
  shelfId?: string | null
  sort?: 'recent' | 'title' | 'author' | 'created'
}

export interface QaSource {
  chapterIdx: number
  chapterTitle: string
  excerpt: string
}

export interface QaAskInput {
  projectId: string
  chapterIdx: number
  question: string
  selection?: string
  allowSpoilers?: boolean
}

export interface QaAnswer {
  answer: string
  sources: QaSource[]
}

export interface TimelineEvent {
  id: string
  projectId: string
  chapterIdx: number
  storyTime: string
  title: string
  detail: string
  characters: string[]
  createdAt: number
}

export interface KnowledgeFact {
  id: string
  projectId: string
  chapterIdx: number
  character: string
  fact: string
  createdAt: number
}

export type AnalysisIssueType =
  | 'timeline'
  | 'name'
  | 'ability'
  | 'foreshadow'
  | 'pov'
  | 'logic'

export interface AnalysisIssue {
  id: string
  projectId: string
  chapterIdx: number
  type: AnalysisIssueType
  detail: string
  quote: string
  status: 'open' | 'ignored'
  createdAt: number
}

export interface AnalysisForeshadow {
  id: string
  projectId: string
  plantedChapter: number
  payoffChapter: number | null
  text: string
  status: 'open' | 'paid' | 'ignored'
  createdAt: number
}

export interface AnalysisBundle {
  projectId: string
  events: TimelineEvent[]
  knowledge: KnowledgeFact[]
  issues: AnalysisIssue[]
  foreshadows: AnalysisForeshadow[]
  analyzedChapters: number[]
  updatedAt: number
}

export interface AnalyzeChapterInput {
  projectId: string
  chapterIdx: number
}

export interface AnalyzeBookInput {
  projectId: string
  sampleSize?: number
}

export interface AnalyzeResult {
  analyzed: number[]
  events: number
  knowledge: number
  issues: number
  foreshadows: number
  skipped: number
}

export interface SyncConfig {
  url: string
  username: string
  password: string
  path: string
}

export interface SyncStatus {
  configured: boolean
  lastSyncAt: number | null
  lastMessage: string
}

export interface SyncResult {
  pulledProjects: number
  pushedProjects: number
  skippedProjects: number
  message: string
}

/* ------------------------------------------------------------------ */
/* Remote sources and export                                           */
/* ------------------------------------------------------------------ */

export type ExportFormat = 'txt' | 'md' | 'epub' | 'docx' | 'pdf'

export interface RemoteBook {
  name: string
  book: ParsedBook
}

export interface OpdsEntry {
  id: string
  title: string
  author: string
  summary: string
  contentUrl: string
  coverUrl: string
  format: string
}

export interface OpdsFeed {
  title: string
  url: string
  entries: OpdsEntry[]
  nextUrl: string | null
}

export interface ImportUrlInput {
  url: string
  name?: string
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
  pageMode: 'scroll' | 'paged'
  lineHeight: number
  letterSpacing: number
  paragraphGap: number
  pageWidth: number
  justify: boolean
  brightness: number
  vertical: boolean
  convert: 'none' | 's2t' | 't2s'
  syncUrl: string
  syncUser: string
  syncPassword: string
  syncPath: string
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
  | {
      type: 'chapter:reset'
      chapterId: string
      projectId: string
      idx: number
      base?: string
    }
  | { type: 'chapter:changed'; chapter: ChapterMeta }
  | { type: 'chapter:content'; chapter: ChapterMeta; content: string }
  | { type: 'chapter:removed'; projectId: string; idx: number }
  | { type: 'project:changed'; project: Project }
  | { type: 'projects:changed' }
  | { type: 'directives:changed'; projectId: string }
  | { type: 'jobs:changed'; jobs: JobInfo[] }
  | { type: 'notice'; tone: 'info' | 'error'; message: string }
  | { type: 'usage:changed'; usage: UsageSummary }
  | {
      type: 'plot:batch'
      batchId: string
      projectId: string
      status: PlotBatchStatus
      unitIdx: number
      message?: string
    }
  | { type: 'analysis:changed'; projectId: string }
  | { type: 'shelves:changed' }

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
