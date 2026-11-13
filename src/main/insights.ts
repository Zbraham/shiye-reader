import type {
  AnalysisBundle,
  AnalyzeResult,
  Project,
  QaAnswer,
  QaSource
} from '@shared/types'
import { SETTINGS_LIMITS } from '@shared/constants'
import { AppError } from './errors'
import { getAnalysis, replaceChapterAnalysis, type ChapterAnalysisInput } from './db/analysis'
import { chapterContents, requireProject } from './db/repo'
import type { DatabaseHandle } from './db/sqlite'
import { parseJsonLoose } from './llm/parse'

export interface InsightsDeps {
  db: DatabaseHandle
  writerMode: () => 'builtin' | 'openai'
  complete: (system: string, user: string, signal: AbortSignal) => Promise<string>
  emitAnalysisChanged: (projectId: string) => void
}

const STOPWORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '这',
  '那',
  '他',
  '她',
  '它',
  '我',
  '你',
  '什么',
  '为什么',
  '怎么',
  '如何',
  '请问',
  '书中',
  '小说',
  '故事',
  'the',
  'and',
  'what',
  'why',
  'how'
])

function termsOf(question: string): string[] {
  const clean = question.toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, ' ')
  const terms = new Set<string>()
  for (const word of clean.split(/\s+/u)) {
    if (!word) continue
    if (/^[a-z0-9]{2,}$/u.test(word)) terms.add(word)
  }
  const han = Array.from(clean.replace(/[^\p{Script=Han}]/gu, ''))
  for (let index = 0; index < han.length - 1; index += 1) {
    const bigram = `${han[index]}${han[index + 1]}`
    if (!STOPWORDS.has(bigram)) terms.add(bigram)
  }
  return [...terms].filter((term) => !STOPWORDS.has(term)).slice(0, 24)
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .filter((paragraph) => paragraph.length > 12)
}

interface Retrieved {
  chapterIdx: number
  chapterTitle: string
  excerpt: string
  score: number
}

function retrieve(
  chapters: { idx: number; title: string; content: string }[],
  question: string,
  chapterIdx: number,
  allowSpoilers: boolean,
  limit: number
): Retrieved[] {
  const terms = termsOf(question)
  const scored: Retrieved[] = []
  for (const chapter of chapters) {
    // Respect the spoiler guard strictly: chapters after the one being read
    // stay out when the reader asked not to be spoiled. The current chapter is
    // still fair game, and there is no silent retry that would leak spoilers.
    if (!allowSpoilers && chapter.idx > chapterIdx) continue
    for (const paragraph of splitParagraphs(chapter.content)) {
      let score = 0
      const lower = paragraph.toLowerCase()
      for (const term of terms) {
        if (lower.includes(term)) score += term.length >= 2 ? term.length : 1
      }
      if (score > 0) {
        scored.push({
          chapterIdx: chapter.idx,
          chapterTitle: chapter.title,
          excerpt: paragraph.slice(0, 700),
          score
        })
      }
    }
  }
  scored.sort((left, right) => right.score - left.score)
  const picked: Retrieved[] = []
  const used = new Map<number, number>()
  for (const item of scored) {
    const count = used.get(item.chapterIdx) ?? 0
    if (count >= 2) continue
    used.set(item.chapterIdx, count + 1)
    picked.push(item)
    if (picked.length >= limit) break
  }
  picked.sort((left, right) => left.chapterIdx - right.chapterIdx)
  return picked
}

function bookHeader(project: Project): string {
  return [
    `书名：《${project.title}》`,
    project.author ? `作者：${project.author}` : '',
    project.genre ? `题材：${project.genre}` : '',
    project.description ? `简介：${project.description.slice(0, 600)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function createInsights(deps: InsightsDeps) {
  const { db } = deps

  async function askQuestion(input: {
    projectId: string
    chapterIdx: number
    question: string
    selection?: string
    allowSpoilers?: boolean
  }): Promise<QaAnswer> {
    const project = requireProject(db, input.projectId)
    const chapters = chapterContents(db, project.id).filter(
      (chapter) => chapter.content.trim().length > 0
    )
    if (chapters.length === 0) {
      throw new AppError('empty', '这本书还没有正文，暂时没有可检索的内容。')
    }
    const allowSpoilers = input.allowSpoilers === true
    const retrieved = retrieve(chapters, input.question, input.chapterIdx, allowSpoilers, 6)
    const sources: QaSource[] = retrieved.map((item) => ({
      chapterIdx: item.chapterIdx,
      chapterTitle: item.chapterTitle,
      excerpt: item.excerpt
    }))

    if (deps.writerMode() === 'builtin') {
      if (sources.length === 0) {
        return {
          answer: '本地检索没有找到和这个问题相关的段落。可以换一个更具体的问法，或在设置里接入模型后做整书问答。',
          sources: []
        }
      }
      const lines = sources.map(
        (source) => `第 ${source.chapterIdx} 章《${source.chapterTitle}》：${source.excerpt}`
      )
      return {
        answer: `内置引擎只做本地检索。和问题最接近的段落如下：\n\n${lines.join(
          '\n\n'
        )}\n\n想要连贯的归纳回答，可以在设置里接入兼容接口的模型。`,
        sources
      }
    }

    const context = retrieved
      .map(
        (item) =>
          `【第 ${item.chapterIdx} 章 · ${item.chapterTitle}】\n${item.excerpt}`
      )
      .join('\n\n')
    const system =
      '你是一位熟悉全书的小说阅读助手。只根据给出的原文片段回答，不要编造情节。引用观点时在句末用（第 N 章）标注来源。回答用中文，简洁清楚，先给结论再给依据。'
    const user = [
      bookHeader(project),
      `读者正在读第 ${input.chapterIdx} 章。`,
      input.selection ? `选中的文字：\n${input.selection.slice(0, 1200)}` : '',
      `问题：${input.question}`,
      '原文片段（按章节顺序）：',
      context || '（没有检索到直接相关的片段）',
      '如果原文不足以回答，请直接说明，不要猜测。'
    ]
      .filter(Boolean)
      .join('\n\n')

    const controller = new AbortController()
    try {
      const answer = await deps.complete(system, user, controller.signal)
      return { answer: answer.trim(), sources }
    } catch (error) {
      throw error
    }
  }

  function analysisPrompt(
    project: Project,
    chapter: { idx: number; title: string; content: string },
    previous: AnalysisBundle,
    nextChapter: { idx: number; title: string } | null
  ): { system: string; user: string } {
    const openForeshadows = previous.foreshadows
      .filter((item) => item.status === 'open')
      .slice(-12)
      .map((item) => `- 第 ${item.plantedChapter} 章：${item.text}`)
      .join('\n')
    const recentEvents = previous.events
      .slice(-10)
      .map((event) => `- 第 ${event.chapterIdx} 章 · ${event.title}：${event.detail.slice(0, 120)}`)
      .join('\n')
    const system =
      '你是小说编辑，负责做结构化阅读笔记。只根据正文提取，不编造。严格输出 JSON，不要 Markdown 代码块。'
    const user = [
      bookHeader(project),
      `当前分析第 ${chapter.idx} 章《${chapter.title}》。`,
      nextChapter ? `下一章是第 ${nextChapter.idx} 章《${nextChapter.title}》。` : '这是目前最后一章。',
      recentEvents ? `此前事件：\n${recentEvents}` : '',
      openForeshadows ? `尚未回收的伏笔：\n${openForeshadows}` : '',
      `正文：\n${chapter.content.slice(0, 12_000)}`,
      `只输出如下结构的 JSON：
{
  "events": [{"storyTime": "故事内时间，未知留空", "title": "事件短标题", "detail": "发生了什么，80字内", "characters": ["相关人物"]}],
  "knowledge": [{"character": "人物名", "fact": "这个人物在本章得知或确认的信息"}],
  "issues": [{"type": "timeline|name|ability|foreshadow|pov|logic", "detail": "可能的前后矛盾或疑点", "quote": "原文短引文"}],
  "foreshadows": [{"text": "本章埋下或回收的伏笔", "payoffChapter": null, "status": "open"}]
}
没有内容的数组留空。最多 8 个事件、10 条知识、6 个疑点、6 条伏笔。`
    ]
      .filter(Boolean)
      .join('\n\n')
    return { system, user }
  }

  function normalizeAnalysis(raw: unknown): ChapterAnalysisInput {
    const record =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {}
    const list = (value: unknown): Record<string, unknown>[] =>
      Array.isArray(value)
        ? value
            .map((item) =>
              item && typeof item === 'object' && !Array.isArray(item)
                ? (item as Record<string, unknown>)
                : {}
            )
            .filter((item) => Object.keys(item).length > 0)
        : []
    const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
    const issueTypes = new Set(['timeline', 'name', 'ability', 'foreshadow', 'pov', 'logic'])

    return {
      events: list(record['events']).map((item) => ({
        storyTime: text(item['storyTime']).slice(0, 80),
        title: text(item['title']).slice(0, 200),
        detail: text(item['detail']).slice(0, 2000),
        characters: Array.isArray(item['characters'])
          ? item['characters']
              .filter((name): name is string => typeof name === 'string')
              .map((name) => name.trim().slice(0, 40))
              .filter(Boolean)
              .slice(0, 12)
          : []
      })),
      knowledge: list(record['knowledge']).map((item) => ({
        character: text(item['character']).slice(0, 40),
        fact: text(item['fact']).slice(0, 600)
      })),
      issues: list(record['issues']).map((item) => {
        const type = text(item['type'])
        return {
          type: (issueTypes.has(type) ? type : 'logic') as ChapterAnalysisInput['issues'][number]['type'],
          detail: text(item['detail']).slice(0, 600),
          quote: text(item['quote']).slice(0, 300)
        }
      }),
      foreshadows: list(record['foreshadows']).map((item) => {
        const status = text(item['status'])
        const payoff = Number(item['payoffChapter'])
        return {
          text: text(item['text']).slice(0, 400),
          payoffChapter: Number.isFinite(payoff) && payoff > 0 ? Math.round(payoff) : null,
          status: (status === 'paid' || status === 'ignored' ? status : 'open') as
            | 'open'
            | 'paid'
            | 'ignored'
        }
      })
    }
  }

  async function analyzeChapterIds(
    project: Project,
    indices: number[],
    chapters: { idx: number; title: string; content: string }[]
  ): Promise<AnalyzeResult> {
    if (deps.writerMode() !== 'openai') {
      throw new AppError(
        'builtin_unsupported',
        '剧情分析需要模型接口。请先在设置里接入兼容接口的模型。'
      )
    }
    const result: AnalyzeResult = {
      analyzed: [],
      events: 0,
      knowledge: 0,
      issues: 0,
      foreshadows: 0,
      skipped: 0
    }
    const byIdx = new Map(chapters.map((chapter) => [chapter.idx, chapter]))
    for (const idx of indices) {
      const chapter = byIdx.get(idx)
      if (!chapter || chapter.content.trim().length < 40) {
        result.skipped += 1
        continue
      }
      const previous = getAnalysis(db, project.id)
      const next = chapters.find((item) => item.idx > idx) ?? null
      const prompt = analysisPrompt(project, chapter, previous, next)
      const raw = await deps.complete(prompt.system, prompt.user, new AbortController().signal)
      let parsed: unknown
      try {
        parsed = parseJsonLoose(raw)
      } catch {
        result.skipped += 1
        continue
      }
      const counts = replaceChapterAnalysis(db, project.id, idx, normalizeAnalysis(parsed))
      result.analyzed.push(idx)
      result.events += counts.events
      result.knowledge += counts.knowledge
      result.issues += counts.issues
      result.foreshadows += counts.foreshadows
      deps.emitAnalysisChanged(project.id)
    }
    return result
  }

  async function analyzeChapter(
    projectId: string,
    chapterIdx: number
  ): Promise<AnalyzeResult> {
    const project = requireProject(db, projectId)
    const chapters = chapterContents(db, project.id)
    return analyzeChapterIds(project, [chapterIdx], chapters)
  }

  async function analyzeBook(projectId: string, sampleSize = 12): Promise<AnalyzeResult> {
    const project = requireProject(db, projectId)
    const chapters = chapterContents(db, project.id).filter(
      (chapter) => chapter.content.trim().length > 40
    )
    if (chapters.length === 0) {
      throw new AppError('empty', '这本书还没有足够的正文可以分析。')
    }
    const limit = Math.min(
      SETTINGS_LIMITS.analysisSampleMax,
      Math.max(1, Math.round(sampleSize))
    )
    let picked = chapters.map((chapter) => chapter.idx)
    if (picked.length > limit) {
      const step = (picked.length - 1) / (limit - 1)
      picked = Array.from({ length: limit }, (_, index) => picked[Math.round(index * step)] ?? 1)
      picked = [...new Set(picked)]
    }
    return analyzeChapterIds(project, picked, chapters)
  }

  return { askQuestion, analyzeChapter, analyzeBook }
}

export type Insights = ReturnType<typeof createInsights>
