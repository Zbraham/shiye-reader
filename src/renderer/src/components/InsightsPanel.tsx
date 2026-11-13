import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BookmarkCheck, Sparkles, Trash2 } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { SETTINGS_LIMITS } from '@shared/constants'
import type { AnalysisBundle, AnalysisIssueType } from '@shared/types'
import { useApp } from '../store'
import { errorText, unwrap } from '../lib'
import { BusyLine } from './ui'

const ISSUE_LABEL: Record<AnalysisIssueType, string> = {
  timeline: '时间',
  name: '人名',
  ability: '能力',
  foreshadow: '伏笔',
  pov: '视角',
  logic: '逻辑'
}

export function InsightsPanel(): React.JSX.Element {
  const reader = useApp((state) => state.reader)
  const chapter = useApp((state) => state.chapter)
  const showToast = useApp((state) => state.showToast)
  const loadChapter = useApp((state) => state.loadChapter)
  const [bundle, setBundle] = useState<AnalysisBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<'timeline' | 'issues' | 'foreshadow' | 'knowledge'>('timeline')

  const projectId = reader?.project.id ?? ''
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  const load = async (target = projectId): Promise<void> => {
    if (!target) return
    try {
      const data = await unwrap(window.shiye.getAnalysis(target))
      if (projectRef.current === target) setBundle(data)
    } catch (error) {
      if (projectRef.current === target) showToast('error', errorText(error))
    } finally {
      if (projectRef.current === target) setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    setBundle(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (!reader) return <div className="panel-note">正在取回这本书。</div>

  const analyzeChapter = async (): Promise<void> => {
    if (!chapter) return
    const target = projectId
    setBusy('chapter')
    try {
      const result = await unwrap(
        window.shiye.analyzeChapter({ projectId: target, chapterIdx: chapter.idx })
      )
      if (projectRef.current !== target) return
      showToast(
        'info',
        `第 ${chapter.idx} 章已梳理：事件 ${result.events}、设定 ${result.knowledge}、疑点 ${result.issues}、伏笔 ${result.foreshadows}。`
      )
      await load(target)
    } catch (error) {
      if (projectRef.current === target) showToast('error', errorText(error))
    } finally {
      if (projectRef.current === target) setBusy('')
    }
  }

  const analyzeBook = async (): Promise<void> => {
    const target = projectId
    setBusy('book')
    try {
      const total = reader.chapters.length
      const result = await unwrap(
        window.shiye.analyzeBook({
          projectId: target,
          sampleSize: Math.max(1, Math.min(SETTINGS_LIMITS.analysisSampleMax, total))
        })
      )
      if (projectRef.current !== target) return
      showToast(
        'info',
        `已梳理 ${result.analyzed.length} 章，跳过 ${result.skipped} 章；事件 ${result.events}、疑点 ${result.issues}、伏笔 ${result.foreshadows}。`
      )
      await load(target)
    } catch (error) {
      if (projectRef.current === target) showToast('error', errorText(error))
    } finally {
      if (projectRef.current === target) setBusy('')
    }
  }

  const clear = async (): Promise<void> => {
    const target = projectId
    setBusy('clear')
    try {
      await unwrap(window.shiye.clearAnalysis(target))
      if (projectRef.current !== target) return
      setBundle(null)
      await load(target)
    } catch (error) {
      if (projectRef.current === target) showToast('error', errorText(error))
    } finally {
      if (projectRef.current === target) setBusy('')
    }
  }

  const openIssues = bundle?.issues.filter((issue) => issue.status === 'open') ?? []
  const openForeshadows =
    bundle?.foreshadows.filter((item) => item.status === 'open') ?? []

  return (
    <>
      <section className="panel-section">
        <h3 className="panel-title">
          <span>全书洞察</span>
          <span className="badge">
            {bundle?.analyzedChapters.length ?? 0}/{reader.chapters.length} 章
          </span>
        </h3>
        <p className="panel-note">
          把已读章节整理成时间线、人物已知信息、前后矛盾和伏笔。需要配置在线模型；
          离线模式只能阅读和问答。
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy !== '' || !chapter}
            onClick={() => void analyzeChapter()}
          >
            {busy === 'chapter' ? <BusyLine text="正在读本章" /> : '梳理本章'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy !== ''}
            onClick={() => void analyzeBook()}
          >
            {busy === 'book' ? <BusyLine text="正在通读" /> : '梳理全书'}
          </button>
          {(bundle?.analyzedChapters.length ?? 0) > 0 ? (
            <button
              className="btn btn-quiet btn-sm"
              disabled={busy !== ''}
              onClick={() => void clear()}
            >
              <Trash2 size={13} strokeWidth={iconStroke} />
              清空
            </button>
          ) : null}
        </div>
      </section>

      <div className="seg panel-insight-tabs">
        <button aria-pressed={tab === 'timeline'} onClick={() => setTab('timeline')}>
          时间线
        </button>
        <button aria-pressed={tab === 'issues'} onClick={() => setTab('issues')}>
          疑点 {openIssues.length > 0 ? `(${openIssues.length})` : ''}
        </button>
        <button aria-pressed={tab === 'foreshadow'} onClick={() => setTab('foreshadow')}>
          伏笔 {openForeshadows.length > 0 ? `(${openForeshadows.length})` : ''}
        </button>
        <button aria-pressed={tab === 'knowledge'} onClick={() => setTab('knowledge')}>
          人物所知
        </button>
      </div>

      {loading ? <BusyLine text="正在取回梳理结果" /> : null}

      {!loading && tab === 'timeline' ? (
        <section className="panel-section">
          {(bundle?.events.length ?? 0) === 0 ? (
            <p className="hint">还没有时间线。先梳理一章，或让模型通读全书。</p>
          ) : (
            <div className="insight-list">
              {bundle?.events.map((event) => (
                <button
                  className="insight-item"
                  key={event.id}
                  onClick={() => void loadChapter(event.chapterIdx)}
                >
                  <span className="insight-meta">
                    第 {event.chapterIdx} 章
                    {event.storyTime ? ` · ${event.storyTime}` : ''}
                  </span>
                  <span className="insight-title">{event.title}</span>
                  {event.detail ? <span className="insight-text">{event.detail}</span> : null}
                  {event.characters.length > 0 ? (
                    <span className="chip-row">
                      {event.characters.slice(0, 6).map((name) => (
                        <span className="chip" key={name}>
                          {name}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && tab === 'issues' ? (
        <section className="panel-section">
          {(bundle?.issues.length ?? 0) === 0 ? (
            <p className="hint">还没有发现疑点。</p>
          ) : (
            <div className="insight-list">
              {bundle?.issues.map((issue) => (
                <div
                  className="insight-item"
                  data-dim={issue.status === 'ignored' ? 'true' : 'false'}
                  key={issue.id}
                >
                  <span className="insight-meta">
                    <AlertTriangle size={12} strokeWidth={iconStroke} />
                    第 {issue.chapterIdx} 章 · {ISSUE_LABEL[issue.type]}
                  </span>
                  <span className="insight-title">{issue.detail}</span>
                  {issue.quote ? <span className="insight-quote">{issue.quote}</span> : null}
                  <button
                    className="link-btn"
                    onClick={() =>
                      void (async () => {
                        try {
                          await unwrap(
                            window.shiye.setIssueStatus(
                              issue.id,
                              issue.status === 'open' ? 'ignored' : 'open'
                            )
                          )
                          await load()
                        } catch (error) {
                          showToast('error', errorText(error))
                        }
                      })()
                    }
                  >
                    {issue.status === 'open' ? '忽略这条' : '恢复'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && tab === 'foreshadow' ? (
        <section className="panel-section">
          {(bundle?.foreshadows.length ?? 0) === 0 ? (
            <p className="hint">还没有记录伏笔。</p>
          ) : (
            <div className="insight-list">
              {bundle?.foreshadows.map((item) => (
                <div
                  className="insight-item"
                  data-dim={item.status === 'ignored' ? 'true' : 'false'}
                  key={item.id}
                >
                  <span className="insight-meta">
                    <BookmarkCheck size={12} strokeWidth={iconStroke} />
                    第 {item.plantedChapter} 章埋下
                    {item.payoffChapter ? ` · 第 ${item.payoffChapter} 章回收` : ' · 尚未回收'}
                  </span>
                  <span className="insight-title">{item.text}</span>
                  <div className="row" style={{ gap: 8 }}>
                    {item.status !== 'paid' ? (
                      <button
                        className="link-btn"
                        onClick={() =>
                          void (async () => {
                            try {
                              await unwrap(window.shiye.setForeshadowStatus(item.id, 'paid'))
                              await load()
                            } catch (error) {
                              showToast('error', errorText(error))
                            }
                          })()
                        }
                      >
                        标为已回收
                      </button>
                    ) : null}
                    <button
                      className="link-btn"
                      onClick={() =>
                        void (async () => {
                          try {
                            await unwrap(
                              window.shiye.setForeshadowStatus(
                                item.id,
                                item.status === 'ignored' ? 'open' : 'ignored'
                              )
                            )
                            await load()
                          } catch (error) {
                            showToast('error', errorText(error))
                          }
                        })()
                      }
                    >
                      {item.status === 'ignored' ? '恢复' : '忽略'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && tab === 'knowledge' ? (
        <section className="panel-section">
          {(bundle?.knowledge.length ?? 0) === 0 ? (
            <p className="hint">还没有人物已知信息。</p>
          ) : (
            <div className="insight-list">
              {bundle?.knowledge.map((fact) => (
                <button
                  className="insight-item"
                  key={fact.id}
                  onClick={() => void loadChapter(fact.chapterIdx)}
                >
                  <span className="insight-meta">
                    <Sparkles size={12} strokeWidth={iconStroke} />
                    第 {fact.chapterIdx} 章 · {fact.character || '未署名'}
                  </span>
                  <span className="insight-title">{fact.fact}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  )
}
