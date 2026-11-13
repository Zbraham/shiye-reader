import type {
  AppSettings,
  ChapterStatus,
  DirectiveScope,
  RoleTag
} from './types'

export const APP_NAME = '拾页'
export const APP_VERSION = '1.2.0'

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'builtin',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  contextWindow: 65536,
  temperature: 0.85,
  theme: 'paper',
  fontSize: 19,
  readerFont: 'serif',
  indent: true,
  buffer: 2,
  chapterMin: 1800,
  chapterMax: 2600,
  consistencyCheck: true,
  openLastOnLaunch: true,
  lastProjectId: null,
  lastView: 'library',
  pageMode: 'scroll',
  lineHeight: 1.95,
  letterSpacing: 0,
  paragraphGap: 0.75,
  pageWidth: 720,
  justify: false,
  brightness: 1,
  vertical: false,
  convert: 'none',
  syncUrl: '',
  syncUser: '',
  syncPassword: '',
  syncPath: 'shiye-backup.json'
}

export const SETTINGS_LIMITS = {
  fontSizeMin: 16,
  fontSizeMax: 24,
  bufferMin: 1,
  bufferMax: 3,
  chapterMinMin: 800,
  chapterMaxMax: 6000,
  contextWindowMin: 8000,
  contextWindowMax: 1000000,
  temperatureMin: 0,
  temperatureMax: 1.5,
  instructionMax: 2000,
  styleSampleMax: 1200,
  chaptersMax: 2000,
  rewriteTargetsMax: 10,
  lineHeightMin: 1.4,
  lineHeightMax: 2.6,
  letterSpacingMax: 3,
  paragraphGapMax: 2,
  pageWidthMin: 520,
  pageWidthMax: 1100,
  fontFamilyMax: 80,
  searchLimitMax: 120,
  qaQuestionMax: 600,
  analysisSampleMax: 30
} as const

export const STATUS_LABEL: Record<ChapterStatus, string> = {
  outline: '未写',
  queued: '待写',
  generating: '写作中',
  draft: '草稿',
  final: '完成',
  stale: '待校对'
}

export const STATUS_ORDER: ChapterStatus[] = [
  'outline',
  'queued',
  'generating',
  'draft',
  'final',
  'stale'
]

const TRANSITIONS: Record<ChapterStatus, ChapterStatus[]> = {
  outline: ['queued', 'draft'],
  queued: ['generating', 'draft', 'outline', 'final', 'stale'],
  generating: ['draft', 'final', 'queued'],
  draft: ['queued', 'generating', 'final', 'stale'],
  final: ['stale', 'queued', 'draft'],
  stale: ['queued', 'final', 'draft']
}

export function canTransition(from: ChapterStatus, to: ChapterStatus): boolean {
  if (from === to) return true
  return TRANSITIONS[from].includes(to)
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ChapterStatus,
    readonly to: ChapterStatus
  ) {
    super(`章节状态不能从 ${from} 变为 ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function assertTransition(from: ChapterStatus, to: ChapterStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}

export function isActiveStatus(status: ChapterStatus): boolean {
  return status === 'queued' || status === 'generating'
}

export function isReadableStatus(status: ChapterStatus): boolean {
  return status === 'draft' || status === 'final' || status === 'stale'
}

export const DIRECTIVE_SCOPES: DirectiveScope[] = ['本章', '后续3章', '本卷', '全书']

export const DIRECTIVE_RANGE: Record<DirectiveScope, number> = {
  本章: 0,
  后续3章: 3,
  本卷: 10,
  全书: -1
}

export const ROLE_TAGS: RoleTag[] = ['对话', '动作', '描写', '心理', '转折', '信息']

export const GENRES = [
  '悬疑',
  '都市',
  '古言',
  '幻想',
  '科幻',
  '武侠',
  '现实',
  '青春'
]

export const TONES = ['克制', '冷峻', '温和', '轻快', '沉郁', '锋利']

export const POVS = ['第三人称限知', '第一人称', '第三人称全知']

export const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max'
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k'
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: ''
  }
] as const

export const WORDS_NOTE =
  '字数口径：每个汉字计 1，西文按单词计 1，连续数字计 1。'

export const CHAPTER_STATUS_HINT: Record<ChapterStatus, string> = {
  outline: '只有章纲，正文尚未开始。',
  queued: '已进入写作队列。',
  generating: '正在写入这一章。',
  draft: '已写出草稿，可继续读。',
  final: '这一章已经写完。',
  stale: '前文有改动，可能需要校对。'
}
