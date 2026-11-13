import { useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { GENRES, POVS, SETTINGS_LIMITS, TONES } from '@shared/constants'
import type {
  CreateProjectInput,
  SetupDraft,
  StorySkeleton
} from '@shared/types'
import { useApp } from '../store'
import { errorText, unwrap } from '../lib'
import { BusyLine } from './ui'

const EMPTY_DRAFT: SetupDraft = {
  themePrompt: '',
  genre: '悬疑',
  tone: '克制',
  pov: '第三人称限知',
  targetLenPerChapter: 2200,
  styleSample: '',
  styleGuide: ''
}

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function LinesArea({
  initial,
  onChange,
  rows,
  placeholder
}: {
  initial: string[]
  onChange: (lines: string[]) => void
  rows?: number
  placeholder?: string
}): React.JSX.Element {
  const [text, setText] = useState(initial.join('\n'))
  return (
    <textarea
      className="textarea"
      rows={rows ?? 3}
      value={text}
      placeholder={placeholder}
      onChange={(event) => {
        setText(event.target.value)
        onChange(parseLines(event.target.value))
      }}
    />
  )
}

export function Setup(): React.JSX.Element {
  const openLibrary = useApp((state) => state.openLibrary)
  const openBook = useApp((state) => state.openBook)
  const showToast = useApp((state) => state.showToast)

  const [step, setStep] = useState<'draft' | 'skeleton'>('draft')
  const [draft, setDraft] = useState<SetupDraft>(EMPTY_DRAFT)
  const [skeleton, setSkeleton] = useState<StorySkeleton | null>(null)
  const [titleIndex, setTitleIndex] = useState(0)
  const [busy, setBusy] = useState<'skeleton' | 'book' | null>(null)
  const [error, setError] = useState('')

  const patchDraft = (patch: Partial<SetupDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setError('')
  }

  const patchSkeleton = (patch: Partial<StorySkeleton>): void => {
    setSkeleton((current) => (current ? { ...current, ...patch } : current))
    setError('')
  }

  const patchCharacter = (
    index: number,
    patch: Partial<StorySkeleton['characters'][number]>
  ): void => {
    setSkeleton((current) => {
      if (!current) return current
      return {
        ...current,
        characters: current.characters.map((character, position) =>
          position === index ? { ...character, ...patch } : character
        )
      }
    })
    setError('')
  }

  const patchChapter = (
    index: number,
    patch: Partial<StorySkeleton['chapters'][number]>
  ): void => {
    setSkeleton((current) => {
      if (!current) return current
      return {
        ...current,
        chapters: current.chapters.map((chapter, position) =>
          position === index ? { ...chapter, ...patch } : chapter
        )
      }
    })
    setError('')
  }

  const generateSkeleton = async (): Promise<void> => {
    if (draft.themePrompt.trim().length < 2) {
      setError('先写下一句话的念头。')
      return
    }
    setBusy('skeleton')
    setError('')
    try {
      const result = await unwrap(
        window.shiye.createSkeleton({
          ...draft,
          themePrompt: draft.themePrompt.trim(),
          styleSample: draft.styleSample.slice(0, SETTINGS_LIMITS.styleSampleMax)
        })
      )
      setSkeleton(result)
      setTitleIndex(0)
      setStep('skeleton')
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  const createBook = async (): Promise<void> => {
    if (!skeleton) return
    const title = (skeleton.titles[titleIndex] ?? skeleton.titles[0] ?? '').trim()
    if (!title) {
      setError('给这本书取一个名字。')
      return
    }
    const clean: StorySkeleton = {
      titles: skeleton.titles.map((item) => item.trim()).filter(Boolean).slice(0, 6),
      sellingPoint: skeleton.sellingPoint.trim().slice(0, 200),
      synopsis: skeleton.synopsis.trim().slice(0, 600),
      characters: skeleton.characters
        .map((character) => ({
          name: character.name.trim().slice(0, 40),
          identity: character.identity.trim().slice(0, 200),
          desire: character.desire.trim().slice(0, 200),
          secret: character.secret.trim().slice(0, 300)
        }))
        .filter((character) => character.name.length > 0)
        .slice(0, 8),
      world: skeleton.world.map((item) => item.trim()).filter(Boolean).slice(0, 10),
      chapters: skeleton.chapters
        .map((chapter) => ({
          title: chapter.title.trim().slice(0, 60),
          goals: chapter.goals.map((goal) => goal.trim()).filter(Boolean).slice(0, 8),
          hook: chapter.hook.trim().slice(0, 200)
        }))
        .filter((chapter) => chapter.title.length > 0)
        .slice(0, 5)
    }
    if (clean.titles.length === 0) clean.titles = [title]
    if (clean.characters.length === 0) {
      setError('至少留下一个人物。')
      return
    }
    if (clean.chapters.length === 0) {
      setError('至少留下一章的计划。')
      return
    }

    const input: CreateProjectInput = {
      title: title.slice(0, 60),
      themePrompt: draft.themePrompt.trim(),
      genre: draft.genre,
      tone: draft.tone,
      pov: draft.pov,
      targetLenPerChapter: draft.targetLenPerChapter,
      styleSample: draft.styleSample.slice(0, SETTINGS_LIMITS.styleSampleMax),
      styleGuide: draft.styleGuide.slice(0, 300),
      skeleton: clean
    }

    setBusy('book')
    setError('')
    try {
      const project = await unwrap(window.shiye.createBook(input))
      await openBook(project.id, 1)
      showToast('info', '书架已经放好，第一章开始落笔。')
    } catch (cause) {
      setError(errorText(cause))
      setBusy(null)
    }
  }

  const back = (): void => {
    if (busy) return
    if (step === 'skeleton') {
      setStep('draft')
      return
    }
    openLibrary()
  }

  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="setup-head">
          <button className="icon-btn" onClick={back} title="返回" aria-label="返回">
            <ArrowLeft size={17} strokeWidth={iconStroke} />
          </button>
          <span className="brand" style={{ fontSize: 17 }}>
            拾页
          </span>
          <span className="topbar-sub" style={{ marginLeft: 4 }}>
            {step === 'draft' ? '新书 · 构思' : '新书 · 骨架'}
          </span>
        </div>

        {step === 'draft' ? (
          <>
            <h1>新建一本书</h1>
            <p className="lead">
              先给一个念头，再决定人物的命运。骨架出来之后，每一处都可以改。
            </p>

            <div className="setup-block">
              <span className="label">一句话的念头</span>
              <textarea
                className="textarea"
                rows={4}
                maxLength={500}
                autoFocus
                value={draft.themePrompt}
                placeholder="例如：一个替人写信的盲人，收到一封写给自己的旧信。"
                onChange={(event) => patchDraft({ themePrompt: event.target.value })}
              />
              <div className="hint" style={{ marginTop: 6 }}>
                {draft.themePrompt.length} / 500
              </div>
            </div>

            <div className="setup-block">
              <span className="label">类型</span>
              <div className="chip-row">
                {GENRES.map((genre) => (
                  <button
                    key={genre}
                    className="chip"
                    aria-pressed={draft.genre === genre}
                    onClick={() => patchDraft({ genre })}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>

            <div className="setup-block">
              <span className="label">语气</span>
              <div className="chip-row">
                {TONES.map((tone) => (
                  <button
                    key={tone}
                    className="chip"
                    aria-pressed={draft.tone === tone}
                    onClick={() => patchDraft({ tone })}
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </div>

            <div className="setup-block">
              <span className="label">视角</span>
              <div className="chip-row">
                {POVS.map((pov) => (
                  <button
                    key={pov}
                    className="chip"
                    aria-pressed={draft.pov === pov}
                    onClick={() => patchDraft({ pov })}
                  >
                    {pov}
                  </button>
                ))}
              </div>
            </div>

            <div className="setup-block">
              <span className="label">单章字数</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  className="input"
                  style={{ width: 140 }}
                  type="number"
                  min={600}
                  max={6000}
                  step={100}
                  value={draft.targetLenPerChapter}
                  onChange={(event) =>
                    patchDraft({
                      targetLenPerChapter: Math.min(
                        6000,
                        Math.max(600, Number(event.target.value) || 600)
                      )
                    })
                  }
                />
                <span className="hint">字左右。写得长一些，章节的呼吸会更慢。</span>
              </div>
            </div>

            <div className="setup-block">
              <span className="label">风格参照（可选）</span>
              <textarea
                className="textarea"
                rows={3}
                maxLength={SETTINGS_LIMITS.styleSampleMax}
                value={draft.styleSample}
                placeholder="贴一段你喜欢的文字，作为行文的参照。"
                onChange={(event) => patchDraft({ styleSample: event.target.value })}
              />
            </div>

            <div className="setup-block">
              <span className="label">写作要求（可选）</span>
              <input
                className="input"
                maxLength={300}
                value={draft.styleGuide}
                placeholder="例如：少用比喻，对话短，场景具体。"
                onChange={(event) => patchDraft({ styleGuide: event.target.value })}
              />
            </div>

            <div className="wizard-foot">
              {error ? (
                <span className="error-text">{error}</span>
              ) : (
                <span className="hint">骨架会先给几个人名、几章计划。</span>
              )}
              <button
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void generateSkeleton()}
              >
                {busy === 'skeleton' ? <BusyLine text="正在铺开" /> : '生成故事骨架'}
              </button>
            </div>
          </>
        ) : (
          skeleton && (
            <>
              <h1>骨架</h1>
              <p className="lead">
                可以改。人物的欲望和秘密，决定后面每一章的走向。
              </p>

              <div className="setup-block">
                <span className="label">书名</span>
                <div className="chip-row" style={{ marginBottom: 10 }}>
                  {skeleton.titles.map((title, index) => (
                    <button
                      key={index}
                      className="chip"
                      aria-pressed={titleIndex === index}
                      onClick={() => setTitleIndex(index)}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <input
                  className="input"
                  maxLength={60}
                  value={skeleton.titles[titleIndex] ?? ''}
                  onChange={(event) => {
                    const next = skeleton.titles.map((item, index) =>
                      index === titleIndex ? event.target.value : item
                    )
                    patchSkeleton({ titles: next })
                  }}
                />
              </div>

              <div className="setup-block">
                <span className="label">一句话卖点</span>
                <input
                  className="input"
                  maxLength={200}
                  value={skeleton.sellingPoint}
                  onChange={(event) => patchSkeleton({ sellingPoint: event.target.value })}
                />
              </div>

              <div className="setup-block">
                <span className="label">故事梗概</span>
                <textarea
                  className="textarea"
                  rows={4}
                  maxLength={600}
                  value={skeleton.synopsis}
                  onChange={(event) => patchSkeleton({ synopsis: event.target.value })}
                />
              </div>

              <div className="setup-block">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6
                  }}
                >
                  <span className="label">人物</span>
                  <button
                    className="link-btn"
                    disabled={skeleton.characters.length >= 8}
                    onClick={() =>
                      patchSkeleton({
                        characters: [
                          ...skeleton.characters,
                          { name: '', identity: '', desire: '', secret: '' }
                        ]
                      })
                    }
                  >
                    再加一人
                  </button>
                </div>
                {skeleton.characters.map((character, index) => (
                  <div className="character-block" key={index}>
                    <div className="character-name-row">
                      <input
                        className="input"
                        maxLength={40}
                        value={character.name}
                        placeholder="姓名"
                        aria-label="姓名"
                        onChange={(event) =>
                          patchCharacter(index, { name: event.target.value })
                        }
                      />
                      <button
                        className="link-btn"
                        disabled={skeleton.characters.length <= 1}
                        onClick={() =>
                          patchSkeleton({
                            characters: skeleton.characters.filter(
                              (_, position) => position !== index
                            )
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                    <label className="character-field">
                      <span>身份</span>
                      <input
                        className="input"
                        maxLength={200}
                        value={character.identity}
                        placeholder="他靠什么活着"
                        onChange={(event) =>
                          patchCharacter(index, { identity: event.target.value })
                        }
                      />
                    </label>
                    <label className="character-field">
                      <span>想要什么</span>
                      <input
                        className="input"
                        maxLength={200}
                        value={character.desire}
                        placeholder="最想得到的东西"
                        onChange={(event) =>
                          patchCharacter(index, { desire: event.target.value })
                        }
                      />
                    </label>
                    <label className="character-field character-field-wide">
                      <span>藏着什么</span>
                      <input
                        className="input"
                        maxLength={300}
                        value={character.secret}
                        placeholder="不能被人知道的那件事"
                        onChange={(event) =>
                          patchCharacter(index, { secret: event.target.value })
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>

              <div className="setup-block">
                <span className="label">世界的规则</span>
                <LinesArea
                  initial={skeleton.world}
                  rows={4}
                  placeholder="一行一条。时代、地点、不能打破的规矩。"
                  onChange={(world) => patchSkeleton({ world })}
                />
              </div>

              <div className="setup-block">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6
                  }}
                >
                  <span className="label">前几章的计划</span>
                  <button
                    className="link-btn"
                    disabled={skeleton.chapters.length >= 5}
                    onClick={() =>
                      patchSkeleton({
                        chapters: [
                          ...skeleton.chapters,
                          { title: '', goals: [], hook: '' }
                        ]
                      })
                    }
                  >
                    <Plus size={12} strokeWidth={iconStroke} /> 加一章
                  </button>
                </div>
                {skeleton.chapters.map((chapter, index) => (
                  <div className="chapter-block" key={index}>
                    <div className="chapter-title-row">
                      <span className="badge">第 {index + 1} 章</span>
                      <input
                        className="input"
                        maxLength={60}
                        value={chapter.title}
                        placeholder="这一章的标题"
                        onChange={(event) =>
                          patchChapter(index, { title: event.target.value })
                        }
                      />
                      <button
                        className="link-btn"
                        disabled={skeleton.chapters.length <= 1}
                        onClick={() =>
                          patchSkeleton({
                            chapters: skeleton.chapters.filter(
                              (_, position) => position !== index
                            )
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                    <LinesArea
                      initial={chapter.goals}
                      rows={4}
                      placeholder="这一章要发生的事，一行一件。"
                      onChange={(goals) => patchChapter(index, { goals })}
                    />
                    <input
                      className="input"
                      maxLength={200}
                      style={{ marginTop: 8 }}
                      value={chapter.hook}
                      placeholder="章末留下的钩子"
                      onChange={(event) =>
                        patchChapter(index, { hook: event.target.value })
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="wizard-foot">
                {error ? (
                  <span className="error-text">{error}</span>
                ) : (
                  <span className="hint">确认之后，第一章会在后台开始写。</span>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-quiet"
                    disabled={busy !== null}
                    onClick={() => setStep('draft')}
                  >
                    返回修改
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy !== null}
                    onClick={() => void createBook()}
                  >
                    {busy === 'book' ? <BusyLine text="正在放上书架" /> : '开始写第一章'}
                  </button>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
