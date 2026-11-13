import type {
  ApiResult,
  AppEvent,
  AppSettings,
  ApplyRewriteResult,
  BeatsResult,
  BootstrapData,
  Chapter,
  ChapterMeta,
  ChapterOutline,
  CreateProjectInput,
  Directive,
  DirectiveScope,
  ExportResult,
  ManualRewriteInput,
  Project,
  ProjectBrief,
  ReaderData,
  RewritePreview,
  SelectTargetsResult,
  SetupDraft,
  StorySkeleton,
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
  updateProject(projectId: string, patch: ProjectPatch): Promise<ApiResult<Project>>
  deleteProject(projectId: string): Promise<ApiResult<null>>
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
  exportBook(projectId: string, format: 'txt' | 'md'): Promise<ApiResult<ExportResult>>
  openDataFolder(): Promise<ApiResult<null>>
  onEvent(listener: (event: AppEvent) => void): () => void
}
