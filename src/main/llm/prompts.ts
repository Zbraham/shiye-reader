import type { ChapterOutline, Chunk, SetupDraft } from '@shared/types'
import { excerpt, truncateByTokens } from '@shared/text'

export interface PromptPair {
  system: string
  user: string
}

export function skeletonPrompt(draft: SetupDraft): PromptPair {
  const style = draft.styleSample.trim()
    ? `文风样例（只学质感，不要照搬内容）：\n${truncateByTokens(draft.styleSample, 800)}`
    : `文风要求：${draft.styleGuide || '克制、具体、不堆形容词。'}`
  return {
    system:
      '你是长篇连载小说的策划编辑。你只输出严格 JSON，不输出解释、前言或代码块标记。',
    user: [
      '为下面这部作品拟定故事骨架。',
      `主题：${draft.themePrompt}`,
      `题材：${draft.genre}　基调：${draft.tone}　视角：${draft.pov}`,
      `单章目标字数：${draft.targetLenPerChapter}`,
      style,
      '',
      '输出 JSON，结构如下：',
      JSON.stringify(
        {
          titles: ['书名一', '书名二', '书名三'],
          sellingPoint: '一句话卖点，30字内',
          synopsis: '故事梗概，150字内',
          characters: [
            {
              name: '姓名',
              identity: '身份',
              desire: '欲望',
              secret: '秘密'
            }
          ],
          world: ['世界观要点，5条以内'],
          chapters: [
            {
              title: '第一章标题',
              goals: ['必须发生的事件，3–5条'],
              hook: '结尾钩子，一句话'
            }
          ]
        },
        null,
        2
      ),
      '',
      '要求：',
      '- 书名 3 个，6–12 字，克制，不用感叹号，不出现“之”“纪元”这类空泛词。',
      '- 主要人物 3–6 个，姓名符合题材，欲望与秘密必须具体，能直接推动情节。',
      '- 世界观要点 3–6 条，只写会影响情节的规则或事实。',
      '- 前三章章纲各 3–5 条目标事件，事件之间有时间顺序；每章结尾钩子要具体。',
      '- 不要写成简介式排比，不要出现“命运的齿轮”一类套话。'
    ].join('\n')
  }
}

export interface OutlinePromptInput {
  title: string
  genre: string
  tone: string
  pov: string
  idx: number
  characters: { name: string; profile: string }[]
  recentSummaries: string[]
  previousHook: string
  directives: string[]
  planned: { title: string; goals: string[]; hook: string } | null
}

export function outlinePrompt(input: OutlinePromptInput): PromptPair {
  const characterLines = input.characters
    .map((character) => `- ${character.name}：${excerpt(character.profile, 80)}`)
    .join('\n')
  const directiveLines = input.directives.map((directive) => `- ${directive}`).join('\n')
  return {
    system: '你是长篇连载小说的结构编辑。只输出严格 JSON。',
    user: [
      `为《${input.title}》第 ${input.idx} 章写章纲。`,
      `题材：${input.genre}　基调：${input.tone}　视角：${input.pov}`,
      '主要人物：',
      characterLines,
      '',
      '近期剧情：',
      input.recentSummaries.length ? input.recentSummaries.join('\n') : '（这是开篇附近，尚无摘要）',
      input.previousHook ? `上一章结尾钩子：${input.previousHook}` : '',
      directiveLines ? `作者指令（优先满足）：\n${directiveLines}` : '',
      '',
      input.planned
        ? `原定方向（可微调，不要偏离）：标题《${input.planned.title}》；事件：${input.planned.goals.join('；')}；钩子：${input.planned.hook}`
        : '',
      '输出 JSON：',
      '{"title":"本章标题（6–14字）","goals":["必须发生的具体事件，3–5条"],"advance":["需要推进的旧伏笔"],"forbidden":["本章不能发生的事，0–2条"],"hook":"结尾钩子，40字内"}',
      '要求：事件具体可写，避免“两人关系升温”“真相浮出水面”这类空话；标题不要用问号或感叹号。'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export const SUMMARY_PROMPT: PromptPair = {
  system: '你是长篇小说编辑。只输出严格 JSON，不写解释。',
  user: [
    '把这一章压缩成结构化摘要，供后续写作参考。只输出 JSON。',
    '{"who_did_what":"120字内，按时间顺序","relationship_change":"关系变化，无则空字符串","new_info":"新出现的地点/物品/规则/秘密，无则空","foreshadow_planted":["新埋下的伏笔"],"foreshadow_paid":["已回收的伏笔"],"ending_hook":"结尾悬念，40字内"}',
    '只记录正文中确实发生的事，不要推测，不要评价文笔。'
  ].join('\n')
}

export function beatsPrompt(input: {
  title: string
  idx: number
  recent: string
  lastContent: string
  characters: string[]
}): PromptPair {
  return {
    system: '你是长篇小说的剧情策划。只输出严格 JSON。',
    user: [
      `《${input.title}》写到了第 ${input.idx} 章。`,
      `主要人物：${input.characters.join('、')}`,
      `最近剧情：${input.recent || '（开篇）'}`,
      `上一章结尾：${truncateByTokens(input.lastContent, 500, 'tail')}`,
      '',
      '推演三个彼此差异明显的后续走向，每个 100 字左右，只写“接下来会发生什么”，不写评价。',
      '三条路线在“谁采取主动、代价是什么、悬念指向何处”上必须不同。',
      '输出 JSON：{"beats":["走向一","走向二","走向三"]}'
    ].join('\n')
  }
}

export function selectionPrompt(input: {
  instruction: string
  chapterIdx: number
  chapterTitle: string
  outline: ChapterOutline | null
  chunks: Chunk[]
  maxTargets: number
}): PromptPair {
  const index = input.chunks
    .map((chunk) => {
      const displayId = displayChunkId(input.chapterIdx, chunk.idx)
      return `${displayId} | ${chunk.roleTag} | ${chunk.text.length}字 | ${excerpt(chunk.text, 30)}`
    })
    .join('\n')
  return {
    system:
      '你要修改一部已经写好的小说。你不能通读全文，只能通过块索引定位。只输出严格 JSON。',
    user: [
      `用户要求：${input.instruction}`,
      `章节：第 ${input.chapterIdx} 章《${input.chapterTitle}》，共 ${input.chunks.length} 块。`,
      input.outline ? `本章章纲：${input.outline.goals.join('；')}` : '',
      '',
      '块索引（id | 功能 | 字数 | 首句前 30 字）：',
      index,
      '',
      '输出严格 JSON：',
      '{"targets":[{"id":"块id","action":"rewrite|delete|insert_after|move","reason":"为什么必须改这块","hint":"改写要点"}],"global_note":""}',
      '',
      '规则：',
      `- 宁少勿多，只选必要的最小集合，最多 ${input.maxTargets} 块。`,
      '- 不确定的不要选。',
      '- 只选能直接满足要求的块，不要顺手优化文笔。',
      '- 无需改动时返回空数组。',
      '- 只能使用上面出现过的块 id。'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export function verifyPrompt(input: {
  instruction: string
  chapterIdx: number
  chunks: Chunk[]
  candidates: { id: string; action: string; reason: string; hint: string }[]
}): PromptPair {
  const byDisplay = new Map(
    input.chunks.map((chunk) => [displayChunkId(input.chapterIdx, chunk.idx), chunk])
  )
  const blocks = input.candidates.map((candidate) => {
    const index = input.chunks.findIndex(
      (chunk) => displayChunkId(input.chapterIdx, chunk.idx) === candidate.id
    )
    const before = index > 0 ? input.chunks[index - 1] : undefined
    const after = index >= 0 ? input.chunks[index + 1] : undefined
    const self = byDisplay.get(candidate.id)
    return [
      `【${candidate.id}】动作：${candidate.action}｜理由：${candidate.reason}｜要点：${candidate.hint}`,
      `前文：${before ? excerpt(before.text, 120) : '（章节开头）'}`,
      `本块：${self ? excerpt(self.text, 500) : '（缺失）'}`,
      `后文：${after ? excerpt(after.text, 120) : '（章节结尾）'}`
    ].join('\n')
  })
  return {
    system: '你是小说的严格编辑，负责复核修改范围。只输出严格 JSON。',
    user: [
      `用户要求：${input.instruction}`,
      '下面是初选的修改块及相邻上下文。请逐块确认：这一块是否真的必须改动才能满足要求？',
      '如果改动会破坏剧情功能、或可由相邻块完成，就不要确认。',
      '',
      blocks.join('\n\n'),
      '',
      '输出 JSON：{"confirmed":["块id", "..."]}。只列真正需要改的块。'
    ].join('\n')
  }
}

export function chunkRewritePrompt(input: {
  instruction: string
  hint: string
  roleTag: string
  before: string
  after: string
  original: string
  extra: string
}): PromptPair {
  return {
    system: '你是小说编辑。只输出改写后的正文，不要任何说明或引号包裹。',
    user: [
      `按用户要求改写下面的段落。`,
      `用户要求：${input.instruction}`,
      input.hint ? `本块要点：${input.hint}` : '',
      input.extra ? input.extra : '',
      '',
      '衔接上下文（仅供理解，不要输出）：',
      `【前块结尾】${excerpt(input.before, 180) || '（章节开头）'}`,
      `【后块开头】${excerpt(input.after, 180) || '（章节结尾）'}`,
      '',
      '待改写的原文：',
      input.original,
      '',
      '约束：',
      '- 人称、时态、文风、口吻与上下文一致。',
      '- 不引入新设定，不新增人物。',
      '- 保留本块承担的剧情功能，不要变成纯抒情。',
      `- 本块原字数 ${input.original.length} 字，改写后一般控制在 ±15%；用户明确要求扩写或精简时从其要求。`,
      '- 只输出正文。'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export function manualRewritePrompt(input: {
  mode: string
  instruction: string
  selected: string
  before: string
  after: string
}): PromptPair {
  const modeText: Record<string, string> = {
    rewrite: '按用户要求改写这段文字。',
    expand: '把这段文字扩写，信息密度不要下降，扩展到约 1.6 倍长度。',
    condense: '精简这段文字，保留所有关键信息，压缩到约 65% 长度。',
    tone: '换一种叙述语气重写这段文字，事件与信息保持不变。',
    continue: '从这段文字的末尾继续往下写，长度与上文相当。'
  }
  return {
    system: '你是小说编辑。只输出正文，不要说明。',
    user: [
      modeText[input.mode] ?? modeText.rewrite,
      input.instruction ? `用户要求：${input.instruction}` : '',
      '',
      `【前文】${excerpt(input.before, 240) || '（章节开头）'}`,
      '【选中文字】',
      input.selected,
      `【后文】${excerpt(input.after, 240) || '（章节结尾）'}`,
      '',
      '约束：人称、时态、文风与上下文一致；不新增人物；只输出正文。'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export function consistencyPrompt(input: {
  setting: string
  chapterTitle: string
  content: string
}): PromptPair {
  return {
    system: '你是小说校对员。只报告确定存在的冲突，不提文笔建议。只输出严格 JSON。',
    user: [
      '对照【设定与前情】检查【新正文】。',
      '',
      '【设定与前情】',
      truncateByTokens(input.setting, 1400),
      '',
      `【新正文：${input.chapterTitle}】`,
      truncateByTokens(input.content, 5000),
      '',
      '输出 JSON：',
      '{"issues":[{"type":"name|timeline|ability|foreshadow|pov","detail":"具体冲突，带上两边原文","chunk_hint":"定位用首句，20字内"}]}',
      '没有冲突返回 {"issues":[]}。只报告确定的矛盾，不要报告“可以更详细”。'
    ].join('\n')
  }
}

export const TEST_PROMPT: PromptPair = {
  system: '你是一个连接测试端点。',
  user: '只回复两个字：可用'
}

export function displayChunkId(chapterIdx: number, chunkIdx: number): string {
  return `c${String(chapterIdx).padStart(2, '0')}-${String(chunkIdx).padStart(2, '0')}`
}
