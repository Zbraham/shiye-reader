import type {
  AnalysisBundle,
  AnalyzeBookInput,
  AnalyzeChapterInput,
  AnalyzeResult,
  ApiResult,
  AppEvent,
  AppSettings,
  ApplyRewriteResult,
  BeatsResult,
  Bookmark,
  BookmarkInput,
  BootstrapData,
  Chapter,
  ChapterMeta,
  ChapterOutline,
  CreateProjectInput,
  Directive,
  DirectiveScope,
  ExportFormat,
  ExportResult,
  ImportBookInput,
  ImportUrlInput,
  ManualRewriteInput,
  OpdsFeed,
  PlotBeatsInput,
  PlotRewriteInput,
  PlotRewriteResult,
  Project,
  ProjectBrief,
  ProjectMetadataPatch,
  QaAnswer,
  QaAskInput,
  ReaderData,
  ReadingRecordInput,
  ReadingStats,
  RemoteBook,
  RewritePreview,
  SearchInput,
  SearchResult,
  SelectTargetsResult,
  SetupDraft,
  Shelf,
  StorySkeleton,
  SyncResult,
  SyncStatus,
  TestModelResult,
  UsageSummary,
  VersionDetail,
  VersionMeta
} from './types'

export type StaleAction = 'resummarize' | 'rewrite' | 'ignore'

export interface ProjectPatch {
  title?: string
  styleSample?: string
  styleGuide?: string
  buffer?: number
  chapterMin?: number
  chapterMax?: number
}

export interface OutlineInput extends ChapterOutline {
  chapterId: string
}

export interface TestModelInput {
  baseUrl: string
  apiKey: string
  model: string
}

export interface DirectiveInput {
  projectId: string
  scope: DirectiveScope
  content: string
}

export interface ShiyeApi {
  bootstrap(): Promise<ApiResult<BootstrapData>>
  listProjects(): Promise<ApiResult<ProjectBrief[]>>
  createSkeleton(draft: SetupDraft): Promise<ApiResult<StorySkeleton>>
  createBook(input: CreateProjectInput): Promise<ApiResult<Project>>
  importBook(input: ImportBookInput): Promise<ApiResult<Project>>
  importFromUrl(input: ImportUrlInput): Promise<ApiResult<RemoteBook>>
  importFromOpds(url: string): Promise<ApiResult<RemoteBook>>
  browseOpds(url: string): Promise<ApiResult<OpdsFeed>>
  updateProject(projectId: string, patch: ProjectPatch): Promise<ApiResult<Project>>
  updateProjectMeta(
    projectId: string,
    patch: ProjectMetadataPatch
  ): Promise<ApiResult<Project>>
  deleteProject(projectId: string): Promise<ApiResult<null>>
  deleteProjects(projectIds: string[]): Promise<ApiResult<null>>
  findDuplicates(): Promise<ApiResult<Record<string, string[]>>>
  readProject(projectId: string): Promise<ApiResult<ReaderData>>
  enterReader(projectId: string, chapterIdx: number): Promise<ApiResult<ReaderData>>
  readChapter(chapterId: string): Promise<ApiResult<Chapter>>
  updateCursor(projectId: string, chapterIdx: number, ratio: number): Promise<ApiResult<null>>
  requestChapter(projectId: string, chapterIdx: number, urgent?: boolean): Promise<ApiResult<null>>
  cancelChapter(chapterId: string): Promise<ApiResult<null>>
  regenerateChapter(chapterId: string): Promise<ApiResult<null>>
  deleteChapter(chapterId: string): Promise<ApiResult<null>>
  updateOutline(input: OutlineInput): Promise<ApiResult<ChapterMeta>>
  saveSettings(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>>
  testModel(input: TestModelInput): Promise<ApiResult<TestModelResult>>
  createDirective(input: DirectiveInput): Promise<ApiResult<Directive>>
  deactivateDirective(projectId: string, directiveId: string): Promise<ApiResult<null>>
  createBeats(projectId: string, chapterIdx: number): Promise<ApiResult<BeatsResult>>
  plotBeats(input: PlotBeatsInput): Promise<ApiResult<BeatsResult>>
  plotRewrite(input: PlotRewriteInput): Promise<ApiResult<PlotRewriteResult>>
  plotCancel(projectId: string, batchId: string): Promise<ApiResult<null>>
  selectTargets(chapterId: string, instruction: string): Promise<ApiResult<SelectTargetsResult>>
  previewRewrite(
    chapterId: string,
    instruction: string,
    targetIds: string[]
  ): Promise<ApiResult<RewritePreview>>
  previewManual(input: ManualRewriteInput): Promise<ApiResult<RewritePreview>>
  applyRewrite(previewId: string, editIds?: string[]): Promise<ApiResult<ApplyRewriteResult>>
  discardRewrite(previewId: string): Promise<ApiResult<null>>
  fixIssues(chapterId: string, issueText: string): Promise<ApiResult<RewritePreview>>
  listVersions(chapterId: string): Promise<ApiResult<VersionMeta[]>>
  getVersion(versionId: string): Promise<ApiResult<VersionDetail | null>>
  restoreVersion(chapterId: string, versionId: string): Promise<ApiResult<ApplyRewriteResult>>
  staleAction(chapterId: string, action: StaleAction): Promise<ApiResult<ChapterMeta>>
  getUsage(): Promise<ApiResult<UsageSummary>>
  exportBook(projectId: string, format: ExportFormat): Promise<ApiResult<ExportResult>>
  search(input: SearchInput): Promise<ApiResult<SearchResult>>
  listBookmarks(projectId: string): Promise<ApiResult<Bookmark[]>>
  addBookmark(input: BookmarkInput): Promise<ApiResult<Bookmark>>
  removeBookmark(bookmarkId: string): Promise<ApiResult<null>>
  recordReading(input: ReadingRecordInput): Promise<ApiResult<null>>
  readingStats(projectId?: string | null): Promise<ApiResult<ReadingStats>>
  listShelves(): Promise<ApiResult<Shelf[]>>
  createShelf(name: string): Promise<ApiResult<Shelf>>
  renameShelf(shelfId: string, name: string): Promise<ApiResult<Shelf>>
  deleteShelf(shelfId: string): Promise<ApiResult<null>>
  addToShelf(shelfId: string, projectIds: string[]): Promise<ApiResult<null>>
  removeFromShelf(shelfId: string, projectIds: string[]): Promise<ApiResult<null>>
  askQuestion(input: QaAskInput): Promise<ApiResult<QaAnswer>>
  getAnalysis(projectId: string): Promise<ApiResult<AnalysisBundle>>
  analyzeChapter(input: AnalyzeChapterInput): Promise<ApiResult<AnalyzeResult>>
  analyzeBook(input: AnalyzeBookInput): Promise<ApiResult<AnalyzeResult>>
  setIssueStatus(issueId: string, status: 'open' | 'ignored'): Promise<ApiResult<null>>
  setForeshadowStatus(
    foreshadowId: string,
    status: 'open' | 'paid' | 'ignored'
  ): Promise<ApiResult<null>>
  clearAnalysis(projectId: string): Promise<ApiResult<null>>
  syncStatus(): Promise<ApiResult<SyncStatus>>
  runSync(): Promise<ApiResult<SyncResult>>
  openDataFolder(): Promise<ApiResult<null>>
  onEvent(listener: (event: AppEvent) => void): () => void
}
