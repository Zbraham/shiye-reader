import type {
  ChapterOutline,
  ConsistencyIssue,
  RewriteTarget,
  SetupDraft,
  StorySkeleton,
  TestModelResult
} from '@shared/types'
import { countWords, excerpt, hashText } from '@shared/text'
import type {
  BeatsTaskInput,
  ChapterSummary,
  ChapterWriteInput,
  CheckTaskInput,
  ManualRewriteTaskInput,
  OutlineTaskInput,
  RewriteChunkTaskInput,
  SelectionTaskInput,
  SummaryTaskInput,
  VerifyTaskInput,
  Writer
} from './types'


/* ------------------------------------------------------------------ */
/* Deterministic pseudo-random helpers                                 */
/* ------------------------------------------------------------------ */

function seedOf(text: string): number {
  const hex = hashText(text)
  return Number.parseInt(hex, 16) >>> 0
}

function makeRng(seedText: string): () => number {
  let state = seedOf(seedText) || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length))
  return items[index] as T
}

function pickMany<T>(rng: () => number, items: readonly T[], count: number): T[] {
  const pool = items.slice()
  const result: T[] = []
  while (pool.length > 0 && result.length < count) {
    const index = Math.floor(rng() * pool.length)
    const [item] = pool.splice(index, 1)
    if (item !== undefined) result.push(item)
  }
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------ */
/* Story kits                                                          */
/* ------------------------------------------------------------------ */

interface StoryKit {
  city: string
  places: string[]
  object: string
  motif: string
  clue: string
  antagonistRole: string
  wound: string
  dialogue: string[]
  hooks: string[]
  chapterTitles: string[]
  titles: string[]
}

const KITS: Record<string, StoryKit> = {
  悬疑: {
    city: '临川',
    places: ['旧港', '钟楼', '南街旧书店', '渡口旅店', '河西仓库', '临川医院'],
    object: '一封没有寄出的信',
    motif: '雾',
    clue: '别相信第一个告诉你答案的人',
    antagonistRole: '师兄',
    wound: '父亲失踪的那个雨夜',
    dialogue: [
      '钟楼那边昨夜有人上去过',
      '信封上的字不是他的',
      '你师兄今天来过',
      '别一个人去',
      '你父亲最后一次来，也是这样的天气'
    ],
    hooks: [
      '门外的人敲了三下门，停一停，又敲两下。',
      '灯灭的瞬间，桌上的信少了一页。',
      '他终于看清照片背面那个人的脸——那是他自己。',
      '电话那头没有声音，只有很轻的呼吸。'
    ],
    chapterTitles: ['雾中来客', '第二封信', '钟楼之下', '没有寄出的地址', '渡口的灯'],
    titles: ['雾中灯', '第七封信', '回声', '无人知晓的夜晚', '潮汐之下']
  },
  都市: {
    city: '江城',
    places: ['夜班公交', '天台', '二十四小时便利店', '老小区', '江边步道', '旧写字楼'],
    object: '一张被折过很多次的照片',
    motif: '雨',
    clue: '三年前的账，从来没有平过',
    antagonistRole: '合伙人',
    wound: '三年前那次失败的合伙',
    dialogue: [
      '那笔钱不是我拿的',
      '你还在查那件事',
      '他昨天来找过我',
      '这城市没有真正关门的地方',
      '你别再往前走了'
    ],
    hooks: [
      '电梯门合上前，他看见走廊尽头站着一个人。',
      '手机屏幕亮了，是一张刚刚拍下的照片——拍的是他。',
      '公交到站，没有人上车，也没有人下车。',
      '她终于开口：“那晚我也在。”'
    ],
    chapterTitles: ['夜班', '旧账', '天台的风', '没有人下车', '江面'],
    titles: ['在城市的背面', '夜班公交', '不响的电话', '三十七度', '江面有风']
  },
  古言: {
    city: '长安',
    places: ['长乐坊', '城西驿站', '旧宅', '曲江池', '宫墙外', '南市'],
    object: '半枚玉印',
    motif: '雪',
    clue: '旧宅的西墙，第三块砖是空的',
    antagonistRole: '表兄',
    wound: '母家获罪那一年',
    dialogue: [
      '这玉印不该在你手里',
      '表兄昨夜来过',
      '宫里的人已经知道了',
      '你当真要查下去',
      '那年的卷宗，少了一页'
    ],
    hooks: [
      '门外传来靴声，停在她的院前。',
      '烛火一暗，信纸上多了一行新墨。',
      '他抬起头，看见她袖口露出半枚玉印。',
      '宫里来人了。'
    ],
    chapterTitles: ['雪夜归人', '半枚玉印', '旧宅西墙', '曲江无波', '宫门'],
    titles: ['春山有信', '长门旧事', '锦书难托', '半城烟雨', '折枝']
  },
  幻想: {
    city: '白露城',
    places: ['旧神的花园', '月落塔', '北门集市', '断桥', '地下书库', '风谷'],
    object: '一枚会发烫的种子',
    motif: '风',
    clue: '月落之前，不要说出它的名字',
    antagonistRole: '引路人',
    wound: '第一次听见风说话的那天',
    dialogue: [
      '它昨天晚上发过光',
      '引路人来找过你',
      '塔上的人换了',
      '你听见了吗',
      '旧神从不白白给出东西'
    ],
    hooks: [
      '种子在他掌心里裂开了一道细缝。',
      '整座城的灯，在同一瞬间熄灭。',
      '风里传来一个熟悉的声音，叫着他的名字。',
      '塔顶的门开了。'
    ],
    chapterTitles: ['风的名字', '种子', '月落塔', '无灯之夜', '北方'],
    titles: ['风的名字', '月落之城', '北方有塔', '旧神的花园', '白露为霜']
  },
  科幻: {
    city: '环城',
    places: ['观测站', '地下十七层', '轨道电梯', '静默海', '旧数据舱', '第三码头'],
    object: '失重舱的黑匣子',
    motif: '星尘',
    clue: '记录不是断了，是被人剪掉了四十七秒',
    antagonistRole: '站长',
    wound: '哥哥失踪的那次出舱',
    dialogue: [
      '这段记录不该存在',
      '站长昨天调过权限',
      '你哥哥最后一次出舱，是单人的',
      '静默海那边又亮了',
      '别相信系统的时间'
    ],
    hooks: [
      '舷窗外，有什么东西跟着他们转了一个角度。',
      '黑匣子自己响了。',
      '系统时间跳回了四十七秒之前。',
      '通讯频道里传来一个死去多年的声音。'
    ],
    chapterTitles: ['失重', '四十七秒', '静默海', '第三码头', '回环'],
    titles: ['静默航线', '失重纪年', '第二地球', '光年之外', '环城以北']
  },
  武侠: {
    city: '洛水',
    places: ['南山客栈', '渡口', '破庙', '镖局后院', '竹林', '洛水桥'],
    object: '一柄没有铭文的刀',
    motif: '雨',
    clue: '刀柄里藏着一张名单',
    antagonistRole: '师兄',
    wound: '师父死在洛水桥上的那一夜',
    dialogue: [
      '这刀不是你的',
      '师兄昨夜过了江',
      '镖局里少了个人',
      '你还要查到什么时候',
      '师父死前见过他'
    ],
    hooks: [
      '桥那头传来刀出鞘的声音。',
      '他低头，看见刀身上映出两个人的影子。',
      '雨里有人叫了他的名字。',
      '客栈的门从外面被闩上了。'
    ],
    chapterTitles: ['洛水夜雨', '无铭刀', '南山旧客', '渡口', '竹林'],
    titles: ['刀上霜', '江湖夜雨', '南山旧客', '一剑霜寒', '洛水无声']
  },
  现实: {
    city: '河阳',
    places: ['人民医院', '老纺织厂', '菜市场', '河堤', '出租屋', '车站'],
    object: '一张欠条',
    motif: '风',
    clue: '签名下面的日期，是父亲走后的第三年',
    antagonistRole: '厂长',
    wound: '父亲下岗那年冬天',
    dialogue: [
      '这张欠条你从哪儿拿的',
      '厂长上个月还来过',
      '厂里早就没人了',
      '你爸当年不是那样的人',
      '别去厂里'
    ],
    hooks: [
      '病房里的监护仪忽然快了一拍。',
      '他在欠条背面摸到另一个名字。',
      '厂房的灯，在深夜亮了。',
      '母亲说：“有些事，过去了就过去了。”'
    ],
    chapterTitles: ['河堤', '欠条', '纺织厂', '冬天', '回去'],
    titles: ['河阳旧事', '纺织厂的春天', '欠条', '河堤', '普通的一天']
  },
  青春: {
    city: '南城',
    places: ['旧操场', '天台', '书店', '晚自习教室', '河桥', '公交站'],
    object: '一本借出去的笔记',
    motif: '夏夜',
    clue: '最后一页写着一个没有拨出去的号码',
    antagonistRole: '同班的男生',
    wound: '毕业前那个没说出口的下午',
    dialogue: [
      '这本笔记不是你的',
      '他昨天来问过',
      '你还要等到什么时候',
      '那天我看见你了',
      '毕业以后，你还会回来吗'
    ],
    hooks: [
      '操场的灯一盏一盏灭下去。',
      '笔记里夹着一张车票，日期是明天。',
      '她在楼梯口站住，没有回头。',
      '手机震了一下，是那个号码。'
    ],
    chapterTitles: ['夏夜未完', '旧操场', '借你的笔记', '河桥', '毕业之前'],
    titles: ['夏夜未完', '旧操场', '借你的笔记', '十七岁的风', '南城以南']
  }
}

function kitFor(genre: string, seed: string): StoryKit {
  const base = KITS[genre] ?? KITS['悬疑']
  if (!base) throw new Error('缺少故事素材')
  const rng = makeRng(`${genre}:${seed}`)
  const places = pickMany(rng, base.places, 5)
  return {
    ...base,
    places,
    object: base.object,
    clue: base.clue,
    motif: base.motif
  }
}

const NAME_POOL = [
  '沈砚',
  '陆沉',
  '江晚',
  '顾清和',
  '林蔓',
  '周叙',
  '温野',
  '苏迟',
  '许照',
  '陈默',
  '唐棠',
  '贺川'
]

const IDENTITIES: Record<string, string[]> = {
  悬疑: ['报社记者', '旧书店老板', '刑警队顾问', '档案室管理员'],
  都市: ['夜班司机', '广告公司文案', '小饭馆老板', '房屋中介'],
  古言: ['没落的侯府庶女', '太常寺小吏', '司天监女官', '行商'],
  幻想: ['守塔人', '草药师', '游方术士', '抄书人'],
  科幻: ['观测员', '维修工程师', '领航员', '档案分析员'],
  武侠: ['游侠', '镖师', '客栈掌柜', '捕快'],
  现实: ['护士', '下岗工人', '出租车司机', '小学老师'],
  青春: ['高三学生', '校刊编辑', '书店店员', '转学生']
}

const DESIRES = [
  '查清一桩被压下去的旧事',
  '找到一个人，问一句为什么',
  '离开这座城，但一直没能走成',
  '守住一间快要关门的铺子',
  '把欠下的债还清'
]

const SECRETS = [
  '那晚他其实在场，只是一直没说',
  '东西一直在她手里，只是换了地方',
  '他与那个人早就认识',
  '最后一次见面时，他说了谎',
  '那份名单上原本有他的名字'
]

function uniqueNames(rng: () => number, count: number): string[] {
  const chosen = pickMany(rng, NAME_POOL, count)
  while (chosen.length < count) chosen.push(`无名${chosen.length}`)
  return chosen
}

function protagonistIdentity(genre: string, rng: () => number): string {
  return pick(rng, IDENTITIES[genre] ?? IDENTITIES['悬疑'] ?? ['记者'])
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

function buildSkeleton(draft: SetupDraft): StorySkeleton {
  const kit = kitFor(draft.genre, draft.themePrompt)
  const rng = makeRng(`skeleton:${draft.genre}:${draft.themePrompt}`)
  const names = uniqueNames(rng, 4)
  const [hero, ally, rival, witness] = names as [string, string, string, string]
  const premise = draft.themePrompt.replace(/\s+/g, ' ').trim()
  const hintedRole = premise.match(/一个([^，。；、\n]{2,14})/u)?.[1]?.trim() ?? ''
  const role =
    hintedRole.length >= 2 ? hintedRole : protagonistIdentity(draft.genre, rng)
  const placeA = kit.places[0] ?? kit.city
  const placeB = kit.places[1] ?? kit.city
  const placeC = kit.places[2] ?? kit.city
  const hookA = kit.hooks[0] ?? '门外有人敲门。'
  const hookB = kit.hooks[1] ?? '灯忽然灭了。'
  const hookC = kit.hooks[2] ?? '电话响了。'

  const titleOptions = pickMany(rng, kit.titles, 3)
  while (titleOptions.length < 3) titleOptions.push(`${kit.city}旧事`)

  const sellingPoint = premise
    ? excerpt(premise.replace(/[。！？!?]$/u, ''), 60)
    : `一桩旧事，把${hero}和${kit.object}重新绑在一起。`
  const premiseTail = premise
    ? `${premise}${/[。！？!?]$/u.test(premise) ? '' : '。'}${hero}想查清${kit.wound}，却发现${kit.antagonistRole}${rival}也在找同一样东西。线索指向${placeB}，而${kit.motif}一直没有停。`
    : `在${kit.city}，${hero}因为${kit.object}被卷进一桩早已结案的旧事。${hero}想查清${kit.wound}，却发现${kit.antagonistRole}${rival}也在找同一样东西。线索指向${placeB}，而${kit.motif}一直没有停。`

  return {
    titles: titleOptions,
    sellingPoint,
    synopsis: premiseTail,
    characters: [
      {
        name: hero,
        identity: role,
        desire: pick(rng, DESIRES),
        secret: pick(rng, SECRETS)
      },
      {
        name: ally,
        identity: pick(rng, IDENTITIES[draft.genre] ?? IDENTITIES['悬疑'] ?? ['旧书店老板']),
        desire: `帮${hero}把这件事查到底，同时保住${placeA}`,
        secret: '早就知道一部分真相，却挑着说'
      },
      {
        name: rival,
        identity: `${kit.antagonistRole}`,
        desire: `先一步拿到${kit.object}`,
        secret: '与那桩旧事直接有关'
      },
      {
        name: witness,
        identity: '最后一个见过关键人物的人',
        desire: '不再被打扰',
        secret: '手里留着一样别人以为已经烧掉的东西'
      }
    ],
    world: [
      `${kit.city}临水而建，${kit.motif}多的夜里，旧城区的路会封掉一半。`,
      `${placeA}已经开了很多年，熟客都记账，账本从不给外人看。`,
      `${kit.object}出现过三次，每一次之后都有人离开${kit.city}。`,
      `旧案卷宗存在${placeC}，调阅需要两个人签字。`,
      `${kit.antagonistRole}这一支在${kit.city}经营多年，很少亲自出面。`
    ],
    chapters: [
      {
        title: kit.chapterTitles[0] ?? '开篇',
        goals: [
          `${hero}在${placeA}拿到${kit.object}`,
          `${hero}与${ally}第一次交换线索`,
          `${rival}察觉到有人在查旧事`,
          `结尾停在一个不完整的发现上`
        ],
        hook: hookA
      },
      {
        title: kit.chapterTitles[1] ?? '第二章',
        goals: [
          `${hero}确认${kit.object}与${kit.wound}有关`,
          `${ally}透露${rival}近日的异常行踪`,
          `两人前往${placeB}寻找知情人`,
          `线索被提前一步取走`
        ],
        hook: hookB
      },
      {
        title: kit.chapterTitles[2] ?? '第三章',
        goals: [
          `${hero}在${placeB}找到被留下的痕迹`,
          `${rival}第一次正面出现`,
          `${hero}意识到身边的人隐瞒了事情`,
          `旧案的时间线出现一处对不上的地方`
        ],
        hook: hookC
      }
    ]
  }
}

/* ------------------------------------------------------------------ */
/* Outline                                                             */
/* ------------------------------------------------------------------ */

function buildOutline(input: OutlineTaskInput): ChapterOutline {
  const kit = kitFor(input.project.genre, input.project.themePrompt)
  const rng = makeRng(`outline:${input.project.id}:${input.idx}`)
  const names = input.characters.map((character) => character.name)
  const hero = names[0] ?? '他'
  const ally = names[1] ?? '旧友'
  const rival = names[2] ?? kit.antagonistRole
  const place = pick(rng, kit.places)
  const place2 = pick(rng, kit.places)
  const extraIdx = input.idx - kit.chapterTitles.length - 1
  const extraPlace =
    kit.places[extraIdx % Math.max(1, kit.places.length)] ?? place
  const tailIndex =
    Math.floor(extraIdx / Math.max(1, kit.places.length)) % TITLE_TAILS.length
  const tailCandidate = TITLE_TAILS[tailIndex] ?? '夜话'
  const extraTail = extraPlace.includes(tailCandidate[0] ?? '')
    ? (TITLE_TAILS[(tailIndex + 3) % TITLE_TAILS.length] ?? tailCandidate)
    : tailCandidate
  const title =
    input.planned?.title ??
    (input.idx <= kit.chapterTitles.length
      ? (kit.chapterTitles[input.idx - 1] ?? `第${input.idx}章`)
      : `${extraPlace}${extraTail}`)
  const plannedGoals = input.planned?.goals ?? []
  const goals =
    plannedGoals.length > 0
      ? plannedGoals.slice(0, 5)
      : [
          `${hero}在${place}追查${kit.object}的下落`,
          `${ally}带来一条与${kit.clue}有关的新消息`,
          `${rival}抢先一步动身，${hero}被迫改变计划`,
          `${hero}在${place2}发现一处时间对不上的细节`
        ]
  const advance = [
    `${kit.object}的来历`,
    `第${Math.max(1, input.idx - 2)}章提过的${kit.clue.slice(0, 10)}`
  ]
  const firstDirective = input.directives[0]
  if (firstDirective) {
    goals.push(`落实作者新指令：${firstDirective}`)
  }
  return {
    title,
    goals,
    advance,
    forbidden: ['不要提前揭晓全部真相', '不要新增未登记的重要人物'],
    hook: input.planned?.hook ?? (kit.hooks[input.idx % kit.hooks.length] ?? '门外有人敲门。')
  }
}

/* ------------------------------------------------------------------ */
/* Chapter prose                                                       */
/* ------------------------------------------------------------------ */

const ATMOSPHERE = [
  '风从河面过来，带着一股潮湿的腥气。他把领口扣好，沿着墙根往前走。',
  '巷子里没有人。只有一只猫蹲在垃圾桶上，听见脚步，跳下去，不见了。',
  '远处有火车经过，声音闷闷的，像从地底下传上来。',
  '屋子里有一股旧纸和樟脑混在一起的味道，时间久了，连呼吸都觉得发涩。',
  '玻璃上映出他的影子，又被人从外面走过的影子盖住。',
  '灯闪了一下。他抬头看，灯泡上积着一层薄灰。',
  '桌上的茶已经凉了，杯壁挂着一圈褐色的痕。',
  '时间过了很久，久到雨声都变了。',
  '他把窗帘拉开一条缝。街对面停着一辆没有熄火的车。',
  '楼下有人在搬东西，铁皮刮过地面，发出很短的一声响。',
  '墙上的钟慢了七分钟。他看了两次，才确认不是自己眼花。',
  '街道尽头的铺子已经上了板，只有门缝里透出一点光。',
  '手机没有信号。屏幕右上角空着，像被人擦掉了一块。',
  '他数了数口袋里的东西：钥匙、零钱、那张纸。没有少。',
  '有人在楼上走动，脚步很轻，来回走了三趟。',
  '窗外有车经过，灯光扫过墙面，又很快退回去。',
  '他把手插进口袋，指尖碰到一张折过的收据。',
  '楼上有人关窗，玻璃轻轻震了一下。',
  '巷口的招牌坏了半截，剩下的字在风里晃。',
  '远处传来一声闷响，像什么东西倒在地上。',
  '他停下来听了一会儿，声音又没有了。',
  '路灯下有一小片干的地面，其余地方都湿着。',
  '门把手上有一层薄灰，像是很久没人碰过。',
  '他看了一眼时间，表盘上的数字有些模糊。',
  '街角有人在等车，帽檐压得很低。',
  '空气里有煤烟味，混着雨后泥土的气息。',
  '楼道里的声控灯坏了，他摸着扶手往下走。',
  '窗台上放着一只空杯子，杯口有一道缺口。',
  '他听见自己的脚步在空屋子里回响。',
  '墙皮脱落了一小块，露出底下更深的一层。'
]

const TIME_WORDS = ['傍晚', '清晨', '夜里', '午后', '天快亮时', '入夜以后']
const TITLE_TAILS = [
  '夜话',
  '旧事',
  '来客',
  '回声',
  '暗门',
  '微光',
  '雨声',
  '未眠',
  '残页',
  '归途'
]
const OPENERS = [
  (place: string, motif: string, time: string): string =>
    `${motif}是${time}开始的。${place}外的路灯亮了一排，光落在积水里，被车轮碾碎又合上。`,
  (place: string, motif: string, time: string): string =>
    `${time}，${place}的门开了半扇。${motif}从檐口滴下来，落在石阶上，声音很轻。`,
  (place: string, motif: string, time: string): string =>
    `${motif}下了一整${time.includes('夜') ? '夜' : '天'}。${place}里只亮着一盏灯，玻璃上蒙着一层水汽。`
]

function buildChapterText(input: ChapterWriteInput): string {
  const kit = kitFor(input.project.genre, input.project.themePrompt)
  const rng = makeRng(`chapter:${input.project.id}:${input.chapterIdx}`)
  const names = input.characters.map((character) => character.name)
  const hero = names[0] ?? '沈砚'
  const ally = names[1] ?? '陆沉'
  const rival = names[2] ?? kit.antagonistRole
  const placeA = pick(rng, kit.places)
  const placeB = pick(rng, kit.places)
  const placeC = pick(rng, kit.places)
  const time = pick(rng, TIME_WORDS)
  const opener = pick(rng, OPENERS)(placeA, kit.motif, time)
  const hook = input.outline?.hook?.trim() || pick(rng, kit.hooks)
  const dialogueA = pick(rng, kit.dialogue)
  const dialogueB = pick(rng, kit.dialogue.filter((line) => line !== dialogueA))
  const atmospherePool = pickMany(rng, ATMOSPHERE, ATMOSPHERE.length)
  const takeAtmosphere = (): string => atmospherePool.shift() ?? ''
  const atmosphere1 = takeAtmosphere()
  const atmosphere2 = takeAtmosphere()
  const atmosphere3 = takeAtmosphere()
  const atmosphere4 = takeAtmosphere()

  const fullParagraphs: string[] = [
    opener,
    `${hero}在门口站了一会儿，把伞收好，肩头还是湿了一片。${placeA}里没有别的客人，柜台后的灯照着一小片桌面，其余地方都暗着。`,
    `“你来了。”${ally}抬起头，看见是他，又把目光落回手里的账本上，“比约的晚了半个时辰。”`,
    `${hero}没有坐下。“路上有人跟着。”他把伞靠在门边，水顺着伞骨滴到地上。`,
    `${ally}把杯子往他面前推了推，没有接话。杯子里是凉的，他也没有喝。`,
    `${kit.object}就放在柜台底下。${hero}把它拿出来的时候，指尖碰到一处不平整的地方。翻过来，背面有一行很浅的铅笔字：${kit.clue}。`,
    `${hero}的指尖顺着字迹摸过去。最后一笔拖得很长，像是写到一半被人打断。他捏着那张纸，过了很久，才把它重新折好。`,
    `${hero}把纸凑近灯，指腹在纸背上慢慢摸过去，摸到一小块发硬的痕迹，像是夹过什么东西，后来又被人取走了。`,
    `门上的铃响了一声。${rival}站在门口，肩上落着${kit.motif}。他没有进来，只朝这边看了一眼，目光在${kit.object}上停了半秒。`,
    `“这么巧。”${rival}说。`,
    `${ally}的手停在半空。${hero}把${kit.object}收进袖口，慢慢站起来。“你跟踪我。”`,
    `“我只是顺路。”${rival}笑了一下，“你不该碰这个东西。”`,
    atmosphere1,
    `${hero}没有回答。他绕过柜台，往门口走。经过${rival}身边时，两个人都停了一瞬，谁也没有让开。`,
    `${ally}在身后低声说：“他从来不走这条路。”${hero}把袖口按紧，没有回头。`,
    `${placeB}离这里不远，走路要穿过两条巷子。${kit.motif}小了些，但风更冷。${hero}没走大路，沿着墙根走，鞋底踩过积水，声音被风盖住。`,
    `${placeB}的门虚掩着。里面没有开灯，只有里间漏出一条细光。${atmosphere2}`,
    `${hero}在门外站了几秒，听见里面有很轻的翻页声。他抬手，又放下。`,
    `“进来吧。”里面的人说。声音很旧，像很久没有跟人说过话。`,
    `那人是${kit.antagonistRole}从前的帮手，如今一个人守着这间屋子。${hero}提起${kit.object}，对方沉默了很久。`,
    `“${dialogueA}。”那人终于说，“我只知道这么多。”`,
    `${hero}把“${dialogueB}”这句话在心里翻了一遍。有些答案不是不知道，只是还没到说的时候。`,
    `“还有一件事。”那人看着${hero}，“别一个人去${placeC}。”`,
    atmosphere3,
    `${hero}起身要走，那人忽然叫住他：“你父亲最后一次来，也是这样的天气。”`,
    `他停在门口，没有回头。很多年前的那个${kit.motif}夜又浮上来，细节清楚得不像回忆。`,
    `出门时，${kit.motif}已经小了。${hero}没有直接去${placeC}，先绕到街口的公用电话亭，拨了一个很久没拨的号码。`,
    `电话响了七声。他正要挂断，那头接起来，没有人说话。`,
    `“是我。”${hero}说。`,
    `呼吸声近了一点，又远了。随后是忙音。`,
    `他站在电话亭里，听着自己的呼吸。玻璃上有一层雾气，他抬手擦掉，街对面停着一辆没有熄火的车。`,
    `纸条上的地址他认得。那是${kit.wound}之后，他们搬离的地方。`,
    `${placeC}的灯还亮着。${hero}听见前面有车停着，发动机没有熄，热风一阵阵吹过来。`,
    `${atmosphere4}`,
    `他走到近前，车窗降下来一半。里面的人没有下车，只递出一张纸。`,
    `纸上只有一个地址，和一行小字：今晚。`,
    `他把纸翻过来，背面有一道很浅的折痕，正好和${kit.object}上的缺角对上。`,
    `${hero}把纸收好，站在原地。风把${kit.motif}吹到脸上，凉得清醒。`,
    '车里的人没有再说别的。车窗升上去，隔着一层玻璃，那张脸变得模糊。',
    `${hero}把纸收进内袋，指尖在折痕上停了一下。那上面的地址，总会有人念给他听。`,
    '他想起那人递纸时的手。指节上有旧伤，虎口有一道浅浅的疤。',
    '街对面的铺子关了灯。卷帘门拉到一半，里面堆着几只纸箱。',
    '他沿着来时的路往回走。经过电话亭时，里面的灯还亮着。',
    '电话亭的地上有一枚硬币，边缘磨得发亮。他弯腰捡起来，又放回去。',
    '巷口那辆没有熄火的车已经走了，地上留着一小片深色的水印。',
    '他走到路口，停下来等灯。身边的人换了一拨，没有人看他。',
    '绿灯亮了。他没有立刻走，等一辆自行车从面前过去。',
    `风把外套的下摆掀起来。他把手按下去，摸到袖口里${kit.object}的轮廓。`,
    '回到住处时，楼道的灯还是不亮。他摸着墙上了三层，钥匙在手里攥出了汗。',
    '门锁转了两圈才开。屋里没有开灯，窗帘缝里透进一道街灯。',
    '他把纸放在桌上，又把信放在旁边。两样东西并排摆着，像一句没有说完的话。',
    '窗外有车经过。他没有起身，只听着声音远了，才把台灯拧亮。',
    hook
  ]

  const shortOrder = [0, 1, 5, 8, 10, 13, 18, 20, 34, 35, 42, 46, 49, 52]
  const mediumOrder = [
    0, 1, 2, 3, 5, 6, 8, 10, 13, 14, 15, 16, 18, 19, 20, 21, 24, 26, 27, 28, 32,
    34, 35, 36, 38, 39, 41, 43, 44, 45, 47, 48, 50, 51, 52
  ]
  const order =
    input.maxWords < 900 ? shortOrder : input.maxWords < 1500 ? mediumOrder : null
  const paragraphs = order
    ? order
        .map((index) => fullParagraphs[index])
        .filter((item): item is string => typeof item === 'string')
    : fullParagraphs.slice()

  let text = paragraphs.join('\n\n')
  let words = countWords(text)
  let extra = 0
  while (words < input.minWords && extra < 26) {
    const filler = takeAtmosphere()
    if (!filler) break
    const span = Math.max(2, paragraphs.length - 4)
    const insertAt = 2 + Math.floor((extra * 7 + input.chapterIdx * 3) % span)
    paragraphs.splice(insertAt, 0, filler)
    text = paragraphs.join('\n\n')
    words = countWords(text)
    extra += 1
  }

  while (words > input.maxWords && paragraphs.length > 12) {
    const removableIndex = paragraphs.length - 6
    paragraphs.splice(removableIndex, 1)
    text = paragraphs.join('\n\n')
    words = countWords(text)
  }

  const fact = `<!--NEW_FACT: {"key":"地点","value":"${placeC}"}-->`
  return `${text.trim()}\n\n${fact}`
}

/* ------------------------------------------------------------------ */
/* Summary, beats, rewrites                                            */
/* ------------------------------------------------------------------ */

function buildSummary(input: SummaryTaskInput): ChapterSummary {
  const kit = kitFor(input.project.genre, input.project.themePrompt)
  const names = input.characterNames
  const hero = names[0] ?? '他'
  const ally = names[1] ?? '旧友'
  const rival = names[2] ?? kit.antagonistRole
  const place = kit.places[input.chapterIdx % kit.places.length] ?? kit.city
  const who = `${hero}在${place}与${ally}见面，确认了${kit.object}上的线索；${rival}随后出现，双方没有动手，但彼此都明白了对方的来意。${hero}从旧人处得到一个新地址，决定当晚过去。`
  return {
    who_did_what: who.slice(0, 118),
    relationship_change: `${hero}与${ally}的信任多了一层，但也开始互相试探。`,
    new_info: `${place}；${kit.object}；一张写有地址的纸条`,
    foreshadow_planted:
      input.chapterIdx % 2 === 0
        ? [`${kit.object}背面还有第二行字，尚未辨认`]
        : [],
    foreshadow_paid: input.chapterIdx > 4 ? [`第${Math.max(1, input.chapterIdx - 2)}章的地址线索`] : [],
    ending_hook: `第${input.chapterIdx}章结尾出现的新地址与${rival}的车有关。`
  }
}

function buildBeats(input: BeatsTaskInput): string[] {
  const kit = kitFor(input.project.genre, input.project.themePrompt)
  const names = input.characterNames
  const hero = names[0] ?? '他'
  const ally = names[1] ?? '旧友'
  const rival = names[2] ?? kit.antagonistRole
  const place = kit.places[input.idx % kit.places.length] ?? kit.city
  return [
    `${hero}决定先去找${ally}，把${kit.object}交出去，换取进入${place}的机会。代价是要承认自己一直在撒谎。`,
    `${rival}先一步拿走线索，${hero}只能跟着对方留下的痕迹走。跟踪途中，他发现自己被另一个人反跟踪。`,
    `${hero}不再追查旧事，转而护住身边的人。可就在他准备收手时，${ally}拿出了一样不该出现的东西。`
  ]
}

function selectTargets(input: SelectionTaskInput): {
  targets: RewriteTarget[]
  globalNote: string
} {
  const instruction = input.instruction
  const wantDelete = /删掉|删除|去掉|删去/.test(instruction)
  const wantInsert = /插入|加一段|补一段|新增一段/.test(instruction)
  const wantDialogue = /对话|吵架|吵|说|谈/.test(instruction)
  const wantDescription = /描写|场景|景色|氛围/.test(instruction)
  const wantPsych = /心理|内心|想法/.test(instruction)
  const wantExpand = /扩写|展开|加长/.test(instruction)
  const wantCondense = /精简|缩短|压缩/.test(instruction)

  const tokens = instruction
    .replace(/[^一-鿿A-Za-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2)
  const grams: string[] = []
  for (const token of tokens) {
    for (let i = 0; i <= token.length - 2; i += 1) {
      const gram = token.slice(i, i + 2)
      if (gram.trim()) grams.push(gram)
    }
  }

  const scored = input.chunks.map((chunk) => {
    let score = 0
    for (const gram of grams) {
      if (chunk.text.includes(gram)) score += 2
    }
    if (wantDialogue && chunk.roleTag === '对话') score += 6
    if (wantDescription && chunk.roleTag === '描写') score += 6
    if (wantPsych && chunk.roleTag === '心理') score += 6
    if (wantDelete && (chunk.roleTag === '描写' || chunk.roleTag === '信息')) score += 2
    return { chunk, score }
  })
  scored.sort((a, b) => b.score - a.score || b.chunk.text.length - a.chunk.text.length)
  const best = scored.slice(0, /几|多处|都|整体/.test(instruction) ? 3 : 1)
  const meaningful = best.filter((item) => item.score > 0)
  const chosen = (meaningful.length > 0 ? meaningful : best.slice(0, 1)).slice(
    0,
    input.maxTargets
  )
  if (chosen.length === 0) return { targets: [], globalNote: '' }

  const targets: RewriteTarget[] = chosen.map(({ chunk }, index) => {
    const action = wantDelete
      ? 'delete'
      : wantInsert && index === 0
        ? 'insert_after'
        : 'rewrite'
    const hint = wantExpand
      ? '扩写细节，保持原有事件顺序'
      : wantCondense
        ? '压缩冗余表达，保留信息'
        : instruction
    return {
      chunkId: chunk.id,
      displayId: `c${String(input.chapterIdx).padStart(2, '0')}-${String(chunk.idx).padStart(2, '0')}`,
      idx: chunk.idx,
      text: chunk.text,
      roleTag: chunk.roleTag,
      action,
      reason: '这一块直接承载了用户要求对应的内容，改动范围最小。',
      hint
    }
  })
  return {
    targets,
    globalNote: wantDelete
      ? '将移除所选段落，不改动其余内容。'
      : '只改写选中的段落，前后文保持不动。'
  }
}

function applyRewrite(input: RewriteChunkTaskInput): string {
  const instruction = input.instruction
  const original = input.original
  if (/精简|压缩|缩短/.test(instruction)) {
    const sentences = original.split(/(?<=[。！？…])/).filter(Boolean)
    const keep = Math.max(1, Math.ceil(sentences.length * 0.7))
    return sentences.slice(0, keep).join('').trim()
  }
  if (/扩写|展开|加长/.test(instruction)) {
    return `${original.trim()}他停了停，像是在等一个不会来的回答。远处的声音低下去，只剩下呼吸。`.trim()
  }
  let result = original
    .replace(/忽然/g, '这时')
    .replace(/立刻/g, '随即')
    .replace(/看着/g, '望向')
    .replace(/说道/g, '说')
  if (result === original) {
    result = `他停了停。${original.trim()}他没有再问。`
  }
  return result.trim()
}

function applyManual(input: ManualRewriteTaskInput): string {
  const original = input.selected.trim()
  switch (input.mode) {
    case 'expand':
      return `${original}他停了一下，听见远处有门合上的声音。那声音很轻，却让他把后半句话咽了回去。`.trim()
    case 'condense': {
      const sentences = original.split(/(?<=[。！？…])/).filter(Boolean)
      const keep = Math.max(1, Math.ceil(sentences.length * 0.65))
      return sentences.slice(0, keep).join('').trim()
    }
    case 'tone':
      return `后来回想起来，那一幕并不清楚。${original}`.trim()
    case 'continue':
      return `${original}\n\n他往前走了一步。门后的声音停了，像是也在等他。`.trim()
    default:
      return applyRewrite({
        instruction: input.instruction,
        hint: input.instruction,
        roleTag: '信息',
        before: input.before,
        after: input.after,
        original,
        chapterTitle: input.chapterTitle
      })
  }
}

/* ------------------------------------------------------------------ */
/* Writer implementation                                               */
/* ------------------------------------------------------------------ */

export class BuiltinWriter implements Writer {
  readonly mode = 'builtin' as const

  async streamChapter(
    input: ChapterWriteInput,
    onDelta: (text: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    const text = buildChapterText(input)
    const size = 18
    for (let index = 0; index < text.length; index += size) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      onDelta(text.slice(index, index + size))
      await sleep(10)
    }
    return text
  }

  async writeSkeleton(draft: SetupDraft, signal: AbortSignal): Promise<StorySkeleton> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(650)
    return buildSkeleton(draft)
  }

  async writeOutline(input: OutlineTaskInput, signal: AbortSignal): Promise<ChapterOutline> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(120)
    return buildOutline(input)
  }

  async summarize(input: SummaryTaskInput, signal: AbortSignal): Promise<ChapterSummary> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(180)
    return buildSummary(input)
  }

  async beats(input: BeatsTaskInput, signal: AbortSignal): Promise<string[]> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(420)
    return buildBeats(input)
  }

  async selectTargets(
    input: SelectionTaskInput,
    signal: AbortSignal
  ): Promise<{ targets: RewriteTarget[]; globalNote: string }> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(300)
    return selectTargets(input)
  }

  async verifyTargets(input: VerifyTaskInput, signal: AbortSignal): Promise<string[]> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(150)
    return input.candidates.map((candidate) => candidate.chunkId)
  }

  async rewriteChunk(input: RewriteChunkTaskInput, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(260)
    return applyRewrite(input)
  }

  async rewriteManual(input: ManualRewriteTaskInput, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(320)
    return applyManual(input)
  }

  async check(input: CheckTaskInput, signal: AbortSignal): Promise<ConsistencyIssue[]> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    void input
    await sleep(100)
    return []
  }

  async test(signal: AbortSignal): Promise<TestModelResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return { ok: true, detail: '内置演示无需网络，可直接使用。', latencyMs: 0 }
  }
}

