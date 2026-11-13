import type {
  ChapterOutline,
  Character,
  Directive,
  ForeshadowItem,
  StoryStateEntry
} from '@shared/types'
import { estimateTokens, truncateByTokens } from '@shared/text'

export const CONTEXT_LIMITS = {
  t0: 900,
  t2: 2200,
  t3: 900,
  t4: 600,
  outputReserve: 3000,
  safety: 500
} as const

export interface ContextProject {
  title: string
  genre: string
  tone: string
  pov: string
  styleGuide: string
  styleSample: string
  targetLenPerChapter: number
  synopsis: string
  sellingPoint: string
}

export interface ContextChapter {
  idx: number
  title: string
  content: string
  summaryL1: string
  summaryL2: string
  outline: ChapterOutline | null
}

export interface BuildContextInput {
  project: ContextProject
  characters: Character[]
  storyState: StoryStateEntry[]
  foreshadow: ForeshadowItem[]
  directives: Directive[]
  priorChapters: ContextChapter[]
  currentIdx: number
  currentTitle: string
  currentOutline: ChapterOutline | null
  /** Verbatim opening kept from an imported chapter (paragraph rewrite). */
  seedText?: string
  minWords: number
  maxWords: number
  tokenBudget: number
}

export interface LayerTokens {
  t0: number
  t1: number
  t2: number
  t3: number
  t4: number
  style: number
  directives: number
  outline: number
  seed: number
}

export interface BuiltPrompt {
  system: string
  user: string
  tokens: number
  layers: LayerTokens
  dropped: string[]
  keywords: string[]
}

const DEFAULT_STYLE =
  '用具体名词而非抽象形容；情绪用动作承载；对话留缺口，不必句句说完；句式长短交错，避免连续排比。'

export function buildSystemPrompt(minWords: number, maxWords: number): string {
  return [
    '你是一位长篇小说作家，正在续写一部连载作品。只输出本章正文，不要标题、不要解释、不要分隔线。',
    '',
    '写作要求：',
    `- 全章 ${minWords}–${maxWords} 字（按汉字计），写到足够长度再收束。`,
    '- 用具体名词而非抽象形容；情绪用动作和细节承载，不直接下判断。',
    '- 对话留缺口，允许答非所问；不同人物说话方式要有区分。',
    '- 句式长短交错，避免连续排比和空泛抒情。',
    '- 不出现“上一章”“本章”“读者”等元叙述。',
    '- 人称、时态、人物口吻与上下文严格一致。',
    '- 不引入未登记的重要设定或新人物。确需新增时，在正文最后单独一行写：',
    '  <!--NEW_FACT: {"key":"...","value":"..."}-->',
    '- 结尾必须落在给定的钩子上，不要总结全书。'
  ].join('\n')
}

function formatCharacter(character: Character): string {
  const alias =
    character.aliases.length > 0 ? `，又称${character.aliases.join('、')}` : ''
  const profile = truncateByTokens(character.profile, 120)
  const state = [
    character.state.location,
    character.state.condition,
    character.state.intent
  ]
    .filter(Boolean)
    .join('；')
  const stateText = state ? `｜当前：${truncateByTokens(state, 80)}` : ''
  return `- ${character.name}${alias}：${profile}${stateText}`
}

function formatTimeline(entries: StoryStateEntry[]): string {
  const timeline = entries.find((entry) => entry.key === 'timeline')
  if (!timeline || !timeline.value.trim()) return ''
  return truncateByTokens(timeline.value.trim(), 300)
}

function formatStoryState(entries: StoryStateEntry[]): string {
  const preferred = ['地点', '能力体系', '禁忌', '规则']
  const lines: string[] = []
  for (const key of preferred) {
    const entry = entries.find((item) => item.key === key)
    if (entry && entry.value.trim()) {
      lines.push(`${key}：${truncateByTokens(entry.value.trim(), 120)}`)
    }
  }
  const others = entries.filter(
    (entry) =>
      !preferred.includes(entry.key) &&
      entry.key !== 'timeline' &&
      entry.key !== '伏笔' &&
      entry.value.trim()
  )
  for (const entry of others.slice(0, 4)) {
    lines.push(`${entry.key}：${truncateByTokens(entry.value.trim(), 80)}`)
  }
  return lines.join('\n')
}

function formatForeshadow(items: ForeshadowItem[]): string {
  if (items.length === 0) return '（暂无）'
  return items
    .slice(0, 8)
    .map((item) => `- [第${item.chapter}章] ${truncateByTokens(item.text, 60)}`)
    .join('\n')
}

export function buildSettingBlock(input: BuildContextInput): string {
  const { project, characters, storyState, foreshadow } = input
  const characterLines = characters.slice(0, 8).map(formatCharacter).join('\n')
  const timeline = formatTimeline(storyState)
  const world = formatStoryState(storyState)
  return [
    `《${project.title}》　题材：${project.genre}｜基调：${project.tone}｜视角：${project.pov}`,
    project.sellingPoint ? `一句话：${project.sellingPoint}` : '',
    project.synopsis ? `梗概：${truncateByTokens(project.synopsis, 120)}` : '',
    '',
    '主要人物（含当前状态）：',
    characterLines || '（暂无）',
    '',
    timeline ? `时间线：\n${timeline}` : '',
    world ? `世界与规则：\n${world}` : '',
    '',
    '未回收伏笔（标注埋设章号）：',
    formatForeshadow(foreshadow)
  ]
    .filter((line, index) => line !== '' || index === 0)
    .join('\n')
    .trim()
}

export function outlineBlock(
  idx: number,
  title: string,
  outline: ChapterOutline | null
): string {
  const goals = outline?.goals?.length ? outline.goals : ['推进主线，并承接上一章结尾']
  const advance = outline?.advance?.length ? outline.advance : ['（无特定要求）']
  const forbidden = outline?.forbidden?.length ? outline.forbidden : ['（无）']
  const hook = outline?.hook?.trim() || '留一个让读者想翻页的悬念'
  return [
    `章号：第 ${idx} 章　标题：${title}`,
    '必须发生：',
    ...goals.map((goal) => `- ${goal}`),
    '必须推进的伏笔：',
    ...advance.map((item) => `- ${item}`),
    '禁止发生：',
    ...forbidden.map((item) => `- ${item}`),
    `结尾要求：${hook}`
  ].join('\n')
}

export interface KeywordSource {
  project: ContextProject
  characters: Character[]
  foreshadow: ForeshadowItem[]
  outline: ChapterOutline | null
}

function uniquePush(target: string[], value: string): void {
  const clean = value.trim()
  if (clean.length < 2 || clean.length > 24) return
  if (!target.includes(clean)) target.push(clean)
}

/** Proper nouns and explicit terms worth retrieving from the archive. */
export function extractKeywords(source: KeywordSource): string[] {
  const keywords: string[] = []
  for (const character of source.characters) {
    uniquePush(keywords, character.name)
    for (const alias of character.aliases) uniquePush(keywords, alias)
  }
  for (const item of source.foreshadow) {
    for (const part of item.text.split(/[，。；、：:（）()《》“”「」\s]+/)) {
      if (part.length >= 2 && part.length <= 12) uniquePush(keywords, part)
    }
  }
  const outlineText = [
    ...(source.outline?.goals ?? []),
    ...(source.outline?.advance ?? []),
    ...(source.outline?.forbidden ?? []),
    source.outline?.hook ?? ''
  ].join('，')
  for (const match of outlineText.matchAll(/[“「《]([^”」》]{2,16})[”」》]/g)) {
    const value = match[1]
    if (value) uniquePush(keywords, value)
  }
  return keywords.slice(0, 18)
}

export function findSnippets(
  chapters: ContextChapter[],
  keywords: string[],
  maxTokens: number,
  excludeRecent = 0
): { text: string; found: number } {
  if (keywords.length === 0 || maxTokens <= 0) return { text: '', found: 0 }
  const lines: string[] = []
  let tokens = 0
  let found = 0
  const pool = chapters
    .slice(0, Math.max(0, chapters.length - excludeRecent))
    .slice()
    .reverse()

  outer: for (const chapter of pool) {
    if (!chapter.content) continue
    const sentences = chapter.content
      .split(/(?<=[。！？…])/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 8)
    for (const sentence of sentences) {
      if (!keywords.some((keyword) => sentence.includes(keyword))) continue
      if (sentence.length < 10) continue
      const line = `[第${chapter.idx}章] ${truncateByTokens(sentence, 120)}`
      const cost = estimateTokens(line)
      if (tokens + cost > maxTokens) break outer
      if (lines.includes(line)) continue
      lines.push(line)
      tokens += cost
      found += 1
      if (found >= 6) break outer
    }
  }

  return { text: lines.join('\n'), found }
}

function buildRecentBlock(chapters: ContextChapter[], limit: number): string {
  if (chapters.length === 0) return ''
  const recent = chapters.slice(-limit)
  const lines = recent.map((chapter) => {
    const summary =
      chapter.summaryL1.trim() ||
      (chapter.content ? truncateByTokens(chapter.content, 220) : '') ||
      chapter.summaryL2 ||
      '（无摘要）'
    return `第${chapter.idx}章《${chapter.title}》：${truncateByTokens(summary, 260)}`
  })
  let text = lines.join('\n')
  if (estimateTokens(text) > CONTEXT_LIMITS.t2) {
    text = truncateByTokens(text, CONTEXT_LIMITS.t2, 'tail')
  }
  return text
}

function buildDistantBlock(chapters: ContextChapter[]): string {
  if (chapters.length === 0) return ''
  const groups: string[] = []
  for (let start = 0; start < chapters.length; start += 10) {
    const bucket = chapters.slice(start, start + 10)
    const first = bucket[0]
    const last = bucket[bucket.length - 1]
    if (!first || !last) continue
    const details = bucket
      .map((chapter) => {
        const oneLine =
          chapter.summaryL2.trim() ||
          (chapter.summaryL1.trim()
            ? truncateByTokens(chapter.summaryL1, 40)
            : truncateByTokens(chapter.content, 40))
        return `第${chapter.idx}章：${oneLine}`
      })
      .filter((line) => !line.endsWith('：'))
      .join('；')
    const label = first.idx === last.idx ? `第${first.idx}章` : `第${first.idx}–${last.idx}章`
    groups.push(`${label}：${details}`)
  }
  const text = groups.join('\n')
  return truncateByTokens(text, CONTEXT_LIMITS.t3, 'head')
}

function buildStyleBlock(project: ContextProject): string {
  if (project.styleSample.trim()) {
    return [
      '下面段落是目标文风的样例。模仿其质感、句长、密度和叙述距离，不要复用其中的情节或句子。',
      '---',
      truncateByTokens(project.styleSample.trim(), 900),
      '---'
    ].join('\n')
  }
  return project.styleGuide.trim() || DEFAULT_STYLE
}

function renderPrompt(
  input: BuildContextInput,
  parts: {
    setting: string
    recent: string
    distant: string
    retrieved: string
    previous: string
    previousTail: string
    seed: string
    outline: string
    style: string
    directives: string
  }
): string {
  const previousChapter = input.priorChapters[input.priorChapters.length - 1]
  const sections: string[] = []
  sections.push(`【作品设定】\n${parts.setting}`)
  if (parts.distant) sections.push(`【前情纪要】\n${parts.distant}`)
  if (parts.recent) sections.push(`【近期剧情】\n${parts.recent}`)
  if (parts.retrieved) sections.push(`【相关旧事】\n${parts.retrieved}`)
  if (previousChapter) {
    sections.push(
      `【上一章原文】\n${parts.previous || '（缺失原文，只能依据摘要承接）'}`
    )
    // When a paragraph seed exists, the seed block already carries the exact
    // text we must continue from, so repeating it as "previous tail" would
    // duplicate the same passage in the prompt.
    if (!parts.seed) {
      sections.push(
        `【上一章结尾（逐字承接，不得复述）】\n${
          parts.previousTail || '（缺失）'
        }`
      )
    }
  } else {
    sections.push('【位置】\n这是第一章，从零开始，不需要承接前文。')
  }
  if (parts.seed) {
    sections.push(
      `【本章已写好的开头（必须逐字承接，不得重复或改写）】\n${parts.seed}`
    )
  }
  sections.push(`【本章任务】\n${parts.outline}`)
  sections.push(`【文风】\n${parts.style}`)
  if (parts.directives) {
    sections.push(
      `【用户新指令（最高优先级，与以上任何设定冲突时以此为准）】\n${parts.directives}`
    )
  }
  sections.push(
    [
      '【硬约束】',
      `- 本章 ${input.minWords}–${input.maxWords} 字。`,
      '- 人称、时态、人物口吻与上文一致。',
      '- 不引入未登记的重要设定；确需新增时，在正文后单独一行写 NEW_FACT 标记。',
      '- 不出现“上一章”“本章”等元叙述。',
      '',
      `现在开始写第 ${input.currentIdx} 章正文。`
    ].join('\n')
  )
  return sections.join('\n\n')
}

export function buildWritingContext(input: BuildContextInput): BuiltPrompt {
  const settingRaw = buildSettingBlock(input)
  const setting = truncateByTokens(settingRaw, CONTEXT_LIMITS.t0)
  const style = buildStyleBlock(input.project)

  const prior = input.priorChapters
  const recentCount = 6
  let recent = buildRecentBlock(prior, recentCount)
  let distant = buildDistantBlock(prior.slice(0, Math.max(0, prior.length - recentCount)))

  const keywords = extractKeywords({
    project: input.project,
    characters: input.characters,
    foreshadow: input.foreshadow,
    outline: input.currentOutline
  })
  let retrieved = findSnippets(
    prior,
    keywords,
    CONTEXT_LIMITS.t4,
    Math.min(recentCount, prior.length)
  ).text

  const previousChapter = prior[prior.length - 1]
  let previous = previousChapter?.content ?? ''
  const seedText = input.seedText?.trim() ?? ''
  const previousTail = seedText
    ? truncateByTokens(seedText, 700, 'tail')
    : previousChapter
      ? truncateByTokens(previousChapter.content, 700, 'tail')
      : ''
  const outline = outlineBlock(
    input.currentIdx,
    input.currentTitle,
    input.currentOutline
  )
  const activeDirectives = input.directives.filter(
    (directive) => directive.status !== 'expired'
  )
  const directiveText = activeDirectives
    .map((directive) => `（${directive.scope}）${directive.content}`)
    .join('\n')

  const parts = () => ({
    setting,
    recent,
    distant,
    retrieved,
    previous:
      estimateTokens(previous) > 6000
        ? truncateByTokens(previous, 6000, 'tail')
        : previous,
    previousTail,
    seed: seedText ? truncateByTokens(seedText, 700, 'tail') : '',
    outline,
    style,
    directives: directiveText
  })

  let current = parts()
  const dropped: string[] = []
  let user = renderPrompt(input, current)
  let total =
    estimateTokens(user) + estimateTokens(buildSystemPrompt(input.minWords, input.maxWords))

  if (total > input.tokenBudget) {
    retrieved = ''
    dropped.push('T4 检索片段')
    current = parts()
    user = renderPrompt(input, current)
    total = estimateTokens(user) + estimateTokens(buildSystemPrompt(input.minWords, input.maxWords))
  }

  if (total > input.tokenBudget && recent) {
    distant = ''
    dropped.push('T3 前情纪要')
    current = parts()
    user = renderPrompt(input, current)
    total = estimateTokens(user) + estimateTokens(buildSystemPrompt(input.minWords, input.maxWords))
  }

  if (total > input.tokenBudget && recent) {
    recent = buildRecentBlock(prior.slice(-3), 3)
    dropped.push('T2 缩减为最近 3 章')
    current = parts()
    user = renderPrompt(input, current)
    total = estimateTokens(user) + estimateTokens(buildSystemPrompt(input.minWords, input.maxWords))
  }

  if (total > input.tokenBudget && previous) {
    recent = ''
    dropped.push('T2 近期剧情')
    current = parts()
    user = renderPrompt(input, current)
    total = estimateTokens(user) + estimateTokens(buildSystemPrompt(input.minWords, input.maxWords))
  }

  const system = buildSystemPrompt(input.minWords, input.maxWords)
  if (total > input.tokenBudget && previous) {
    const systemTokens = estimateTokens(system)
    const others = estimateTokens(
      renderPrompt(input, { ...current, previous: '', previousTail, recent: '', distant: '', retrieved: '' })
    )
    const available = Math.max(600, input.tokenBudget - systemTokens - others)
    previous = truncateByTokens(previous, available, 'tail')
    dropped.push('T1 原文仅保留结尾')
    current = parts()
    user = renderPrompt(input, current)
    total = estimateTokens(user) + systemTokens
  }

  const layers: LayerTokens = {
    t0: estimateTokens(setting),
    t1: estimateTokens(current.previous) + estimateTokens(current.previousTail),
    t2: estimateTokens(current.recent),
    t3: estimateTokens(current.distant),
    t4: estimateTokens(current.retrieved),
    style: estimateTokens(current.style),
    directives: estimateTokens(current.directives),
    outline: estimateTokens(current.outline),
    seed: estimateTokens(current.seed)
  }

  return {
    system,
    user,
    tokens: estimateTokens(user) + estimateTokens(system),
    layers,
    dropped,
    keywords
  }
}

export function contextBudget(contextWindow: number): number {
  return Math.max(
    4000,
    contextWindow - CONTEXT_LIMITS.outputReserve - CONTEXT_LIMITS.safety
  )
}
