import { z } from 'zod'
import {
  DIRECTIVE_SCOPES,
  SETTINGS_LIMITS
} from './constants'
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
  lastView: z.enum(['library', 'reader']).optional()
})

export const TestModelSchema = z.object({
  baseUrl: z.string().max(500),
  apiKey: z.string().max(500),
  model: z.string().max(100)
})

export const ExportSchema = z.object({
  projectId: IdSchema,
  format: z.enum(['txt', 'md'])
})

export const BeatsSchema = z.object({
  projectId: IdSchema,
  chapterIdx: ChapterIdxSchema
})

export const FixIssuesSchema = z.object({
  chapterId: IdSchema,
  issueText: z.string().max(1200)
})

export const ProjectIdOnlySchema = ProjectIdSchema
