import { z } from 'zod'
import {
  DIRECTIVE_SCOPES,
  SETTINGS_LIMITS
} from './constants'
import { IMPORT_LIMITS } from './import/types'
import { themes } from './tokens'
import type { DirectiveScope } from './types'
import type { ThemeName } from './tokens'

export const IdSchema = z.string().min(1).max(64)
export const ChapterIdxSchema = z.number().int().min(1).max(SETTINGS_LIMITS.chaptersMax)

export const SkeletonCharacterSchema = z.object({
  name: z.string().min(1).max(40),
  identity: z.string().max(200).default(''),
  desire: z.string().max(200).default(''),
  secret: z.string().max(300).default('')
})

export const SkeletonChapterSchema = z.object({
  title: z.string().min(1).max(60),
  goals: z.array(z.string().max(200)).max(8),
  hook: z.string().max(200)
})

export const StorySkeletonSchema = z.object({
  titles: z.array(z.string().min(1).max(40)).min(1).max(6),
  sellingPoint: z.string().max(200),
  synopsis: z.string().max(600),
  characters: z.array(SkeletonCharacterSchema).min(1).max(8),
  world: z.array(z.string().max(200)).max(10),
  chapters: z.array(SkeletonChapterSchema).min(1).max(5)
})

export const SetupDraftSchema = z.object({
  themePrompt: z.string().min(2).max(500),
  genre: z.string().min(1).max(30),
  tone: z.string().min(1).max(30),
  pov: z.string().min(1).max(30),
  targetLenPerChapter: z.number().int().min(600).max(6000),
  styleSample: z.string().max(SETTINGS_LIMITS.styleSampleMax),
  styleGuide: z.string().max(300)
})

export const CreateProjectSchema = z.object({
  title: z.string().min(1).max(60),
  themePrompt: z.string().min(2).max(500),
  genre: z.string().min(1).max(30),
  tone: z.string().min(1).max(30),
  pov: z.string().min(1).max(30),
  targetLenPerChapter: z.number().int().min(600).max(6000),
  styleSample: z.string().max(SETTINGS_LIMITS.styleSampleMax),
  styleGuide: z.string().max(300),
  skeleton: StorySkeletonSchema
})

export const ChapterOutlineSchema = z.object({
  title: z.string().max(60),
  goals: z.array(z.string().max(200)).max(8),
  advance: z.array(z.string().max(200)).max(8),
  forbidden: z.array(z.string().max(200)).max(8),
  hook: z.string().max(300)
})

export const ProjectIdSchema = z.object({ projectId: IdSchema })

export const ChapterIdSchema = z.object({ chapterId: IdSchema })

export const EnqueueChapterSchema = z.object({
  projectId: IdSchema,
  idx: ChapterIdxSchema,
  urgent: z.boolean().optional()
})

export const ReaderEnterSchema = z.object({
  projectId: IdSchema,
  chapterIdx: ChapterIdxSchema
})

export const ReadCursorSchema = z.object({
  projectId: IdSchema,
  chapterIdx: ChapterIdxSchema,
  ratio: z.number().min(0).max(1)
})

export const UpdateOutlineSchema = z.object({
  chapterId: IdSchema,
  title: z.string().max(60),
  goals: z.array(z.string().max(200)).max(8),
  advance: z.array(z.string().max(200)).max(8),
  forbidden: z.array(z.string().max(200)).max(8),
  hook: z.string().max(300)
})

export const DirectiveCreateSchema = z.object({
  projectId: IdSchema,
  scope: z.enum(DIRECTIVE_SCOPES as [DirectiveScope, ...DirectiveScope[]]),
  content: z.string().min(1).max(SETTINGS_LIMITS.instructionMax)
})

export const DirectiveDeactivateSchema = z.object({
  projectId: IdSchema,
  directiveId: IdSchema
})

export const RewriteSelectSchema = z.object({
  chapterId: IdSchema,
  instruction: z.string().min(1).max(SETTINGS_LIMITS.instructionMax)
})

export const RewritePreviewSchema = z.object({
  chapterId: IdSchema,
  instruction: z.string().min(1).max(SETTINGS_LIMITS.instructionMax),
  targetIds: z.array(IdSchema).max(20)
})

export const ManualRewriteSchema = z.object({
  projectId: IdSchema,
  chapterId: IdSchema,
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  mode: z.enum(['rewrite', 'expand', 'condense', 'tone', 'continue']),
  instruction: z.string().max(SETTINGS_LIMITS.instructionMax)
})

export const ApplyRewriteSchema = z.object({
  previewId: IdSchema,
  editIds: z.array(IdSchema).max(20).optional()
})

export const VersionListSchema = z.object({ chapterId: IdSchema })
export const VersionGetSchema = z.object({ versionId: IdSchema })
export const VersionRestoreSchema = z.object({
  chapterId: IdSchema,
  versionId: IdSchema
})

export const ChapterDeleteSchema = z.object({
  chapterId: IdSchema
})

export const StaleActionSchema = z.object({
  chapterId: IdSchema,
  action: z.enum(['resummarize', 'rewrite', 'ignore'])
})

export const ProjectUpdateSchema = z.object({
  projectId: IdSchema,
  title: z.string().min(1).max(60).optional(),
  styleSample: z.string().max(SETTINGS_LIMITS.styleSampleMax).optional(),
  styleGuide: z.string().max(300).optional(),
  buffer: z.number().int().min(1).max(3).optional(),
  chapterMin: z.number().int().min(600).max(5000).optional(),
  chapterMax: z.number().int().min(800).max(6000).optional()
})

export const ProjectMetaSchema = z.object({
  projectId: IdSchema,
  title: z.string().min(1).max(60).optional(),
  author: z.string().max(80).optional(),
  series: z.string().max(80).optional(),
  publisher: z.string().max(80).optional(),
  language: z.string().max(30).optional(),
  description: z.string().max(4000).optional(),
  tags: z.array(z.string().max(24)).max(12).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  readStatus: z.enum(['none', 'want', 'reading', 'done', 'dropped']).optional(),
  coverData: z.string().max(400_000).optional()
})

export const ProjectBatchDeleteSchema = z.object({
  projectIds: z.array(IdSchema).min(1).max(500)
})

export const SearchSchema = z.object({
  projectId: IdSchema.nullable().optional(),
  query: z.string().min(1).max(120),
  limit: z.number().int().min(1).max(SETTINGS_LIMITS.searchLimitMax).optional(),
  beforeIdx: z.number().int().min(1).max(SETTINGS_LIMITS.chaptersMax).nullable().optional()
})

export const BookmarkAddSchema = z.object({
  projectId: IdSchema,
  chapterId: IdSchema,
  chapterIdx: ChapterIdxSchema,
  ratio: z.number().min(0).max(1),
  label: z.string().max(120).default(''),
  excerpt: z.string().max(300).default('')
})

export const BookmarkRemoveSchema = z.object({ bookmarkId: IdSchema })

export const ReadingRecordSchema = z.object({
  projectId: IdSchema,
  seconds: z.number().int().min(1).max(3600),
  words: z.number().int().min(0).max(2_000_000)
})

export const ReadingStatsSchema = z.object({
  projectId: IdSchema.nullable().optional()
})

export const ShelfCreateSchema = z.object({ name: z.string().min(1).max(40) })

export const ShelfRenameSchema = z.object({
  shelfId: IdSchema,
  name: z.string().min(1).max(40)
})

export const ShelfDeleteSchema = z.object({ shelfId: IdSchema })

export const ShelfBooksSchema = z.object({
  shelfId: IdSchema,
  projectIds: z.array(IdSchema).min(1).max(500)
})

export const QaAskSchema = z.object({
  projectId: IdSchema,
  chapterIdx: ChapterIdxSchema,
  question: z.string().min(1).max(SETTINGS_LIMITS.qaQuestionMax),
  selection: z.string().max(2000).optional(),
  allowSpoilers: z.boolean().optional()
})

export const AnalyzeChapterSchema = z.object({
  projectId: IdSchema,
  chapterIdx: ChapterIdxSchema
})

export const AnalyzeBookSchema = z.object({
  projectId: IdSchema,
  sampleSize: z.number().int().min(1).max(SETTINGS_LIMITS.analysisSampleMax).optional()
})

export const IssueStatusSchema = z.object({
  issueId: IdSchema,
  status: z.enum(['open', 'ignored'])
})

export const ForeshadowStatusSchema = z.object({
  foreshadowId: IdSchema,
  status: z.enum(['open', 'paid', 'ignored'])
})

export const ImportUrlSchema = z.object({
  url: z.string().url().max(1000),
  name: z.string().max(260).optional()
})

export const OpdsUrlSchema = z.object({
  url: z.string().url().max(1000)
})

export const AppSettingsSchema = z.object({
  provider: z.enum(['builtin', 'openai']).optional(),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  model: z.string().max(100).optional(),
  contextWindow: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.contextWindowMin)
    .max(SETTINGS_LIMITS.contextWindowMax)
    .optional(),
  temperature: z
    .number()
    .min(SETTINGS_LIMITS.temperatureMin)
    .max(SETTINGS_LIMITS.temperatureMax)
    .optional(),
  theme: z.enum(Object.keys(themes) as [ThemeName, ...ThemeName[]]).optional(),
  fontSize: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.fontSizeMin)
    .max(SETTINGS_LIMITS.fontSizeMax)
    .optional(),
  readerFont: z.enum(['ui', 'serif', 'sans', 'kai']).optional(),
  indent: z.boolean().optional(),
  buffer: z.number().int().min(1).max(3).optional(),
  chapterMin: z.number().int().min(600).max(5000).optional(),
  chapterMax: z.number().int().min(800).max(6000).optional(),
  consistencyCheck: z.boolean().optional(),
  openLastOnLaunch: z.boolean().optional(),
  lastProjectId: z.string().max(64).nullable().optional(),
  lastView: z.enum(['library', 'reader']).optional(),
  pageMode: z.enum(['scroll', 'paged']).optional(),
  lineHeight: z
    .number()
    .min(SETTINGS_LIMITS.lineHeightMin)
    .max(SETTINGS_LIMITS.lineHeightMax)
    .optional(),
  letterSpacing: z.number().min(0).max(SETTINGS_LIMITS.letterSpacingMax).optional(),
  paragraphGap: z.number().min(0).max(SETTINGS_LIMITS.paragraphGapMax).optional(),
  pageWidth: z
    .number()
    .int()
    .min(SETTINGS_LIMITS.pageWidthMin)
    .max(SETTINGS_LIMITS.pageWidthMax)
    .optional(),
  justify: z.boolean().optional(),
  brightness: z.number().min(0.4).max(1).optional(),
  vertical: z.boolean().optional(),
  convert: z.enum(['none', 's2t', 't2s']).optional(),
  syncUrl: z.string().max(500).optional(),
  syncUser: z.string().max(200).optional(),
  syncPassword: z.string().max(500).optional(),
  syncPath: z.string().max(200).optional()
})

export const TestModelSchema = z.object({
  baseUrl: z.string().max(500),
  apiKey: z.string().max(500),
  model: z.string().max(100)
})

export const ExportSchema = z.object({
  projectId: IdSchema,
  format: z.enum(['txt', 'md', 'epub', 'docx', 'pdf'])
})

export const BeatsSchema = z.object({
  projectId: IdSchema,
  chapterIdx: ChapterIdxSchema
})

export const ImportBookSchema = z
  .object({
    title: z.string().min(1).max(60),
    genre: z.string().min(1).max(30),
    tone: z.string().min(1).max(30),
    pov: z.string().min(1).max(30),
    styleSample: z.string().max(SETTINGS_LIMITS.styleSampleMax),
    styleGuide: z.string().max(300),
    targetLenPerChapter: z.number().int().min(600).max(6000),
    sourceFile: z.string().max(260),
    author: z.string().max(80).optional(),
    series: z.string().max(80).optional(),
    publisher: z.string().max(80).optional(),
    language: z.string().max(30).optional(),
    description: z.string().max(4000).optional(),
    tags: z.array(z.string().max(24)).max(12).optional(),
    coverData: z.string().max(400_000).optional(),
    chapters: z
      .array(
        z.object({
          title: z.string().min(1).max(120),
          content: z.string().min(1).max(120_000),
          html: z.string().max(IMPORT_LIMITS.chapterHtmlChars).optional(),
          volume: z.string().max(80).optional(),
          level: z.number().int().min(1).max(6).optional()
        })
      )
      .min(1)
      .max(IMPORT_LIMITS.chapters)
  })
  .superRefine((value, ctx) => {
    const total = value.chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)
    if (total > IMPORT_LIMITS.totalChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters'],
        message: '正文总字数超过上限。'
      })
    }
  })

const PlotAnchorObject = z.object({
  projectId: IdSchema,
  fromIdx: ChapterIdxSchema,
  startMode: z.enum(['after', 'include', 'paragraph']),
  startOffset: z.number().int().min(0).nullable()
})

function refinePlotAnchor(
  value: {
    startMode: 'after' | 'include' | 'paragraph'
    startOffset: number | null
  },
  ctx: z.RefinementCtx
): void {
  if (value.startMode === 'paragraph') {
    if (value.startOffset === null || value.startOffset < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startOffset'],
        message: '请选择段落位置。'
      })
    }
  } else if (value.startOffset !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startOffset'],
      message: '章节起点不需要段落位置。'
    })
  }
}

export const PlotBeatsSchema = PlotAnchorObject.superRefine(refinePlotAnchor)

export const PlotRewriteSchema = PlotAnchorObject.extend({
  direction: z.string().min(1).max(SETTINGS_LIMITS.instructionMax),
  batchSize: z.literal(3)
}).superRefine(refinePlotAnchor)

export const PlotCancelSchema = z.object({
  projectId: IdSchema,
  batchId: IdSchema
})

export const FixIssuesSchema = z.object({
  chapterId: IdSchema,
  issueText: z.string().max(1200)
})

export const ProjectIdOnlySchema = ProjectIdSchema
