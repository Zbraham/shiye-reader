import type {
  ChapterOutline,
  Chunk,
  ConsistencyIssue,
  Project,
  RewriteTarget,
  SetupDraft,
  StorySkeleton,
  TestModelResult
} from '@shared/types'
import type { BuiltPrompt } from '@main/text/context'

export interface ChapterSummary {
  who_did_what: string
  relationship_change: string
  new_info: string
  foreshadow_planted: string[]
  foreshadow_paid: string[]
  ending_hook: string
}

export interface ChapterWriteInput {
  prompt: BuiltPrompt
  project: Project
  characters: { name: string; profile: string }[]
  chapterIdx: number
  chapterTitle: string
  outline: ChapterOutline | null
  previousTail: string
  minWords: number
  maxWords: number
}

export interface OutlineTaskInput {
  project: Project
  characters: { name: string; profile: string; state: string }[]
  idx: number
  recentSummaries: string[]
  previousHook: string
  directives: string[]
  planned: { title: string; goals: string[]; hook: string } | null
}

export interface SummaryTaskInput {
  project: Project
  chapterIdx: number
  chapterTitle: string
  content: string
  characterNames: string[]
}

export interface BeatsTaskInput {
  project: Project
  idx: number
  recent: string
  lastContent: string
  characterNames: string[]
}

export interface SelectionTaskInput {
  chapterIdx: number
  chapterTitle: string
  outline: ChapterOutline | null
  chunks: Chunk[]
  instruction: string
  maxTargets: number
}

export interface VerifyTaskInput {
  chapterIdx: number
  instruction: string
  chunks: Chunk[]
  candidates: RewriteTarget[]
}

export interface RewriteChunkTaskInput {
  instruction: string
  hint: string
  roleTag: string
  before: string
  after: string
  original: string
  chapterTitle: string
}

export interface ManualRewriteTaskInput {
  mode: 'rewrite' | 'expand' | 'condense' | 'tone' | 'continue'
  instruction: string
  selected: string
  before: string
  after: string
  chapterTitle: string
}

export interface CheckTaskInput {
  setting: string
  chapterTitle: string
  content: string
}

export interface Writer {
  readonly mode: 'builtin' | 'openai'
  /** Free-form completion used by reader Q&A and book analysis. */
  complete(system: string, user: string, signal: AbortSignal): Promise<string>
  streamChapter(
    input: ChapterWriteInput,
    onDelta: (text: string) => void,
    signal: AbortSignal
  ): Promise<string>
  writeSkeleton(draft: SetupDraft, signal: AbortSignal): Promise<StorySkeleton>
  writeOutline(input: OutlineTaskInput, signal: AbortSignal): Promise<ChapterOutline>
  summarize(input: SummaryTaskInput, signal: AbortSignal): Promise<ChapterSummary>
  beats(input: BeatsTaskInput, signal: AbortSignal): Promise<string[]>
  selectTargets(
    input: SelectionTaskInput,
    signal: AbortSignal
  ): Promise<{ targets: RewriteTarget[]; globalNote: string }>
  verifyTargets(input: VerifyTaskInput, signal: AbortSignal): Promise<string[]>
  rewriteChunk(input: RewriteChunkTaskInput, signal: AbortSignal): Promise<string>
  rewriteManual(input: ManualRewriteTaskInput, signal: AbortSignal): Promise<string>
  check(input: CheckTaskInput, signal: AbortSignal): Promise<ConsistencyIssue[]>
  test(signal: AbortSignal): Promise<TestModelResult>
}
