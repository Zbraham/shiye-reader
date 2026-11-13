import { useEffect, useState } from 'react'
import { RefreshCw, Trash2, X } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { DIRECTIVE_SCOPES, STATUS_LABEL } from '@shared/constants'
import type {
  ConsistencyIssue,
  DirectiveScope,
  RewriteTarget,
  VersionMeta
} from '@shared/types'
import { useApp } from '../store'
import { errorText, formatTime, unwrap } from '../lib'
import { OutlineDialog } from './OutlineDialog'
import { VersionDialog } from './VersionDialog'
import { BusyLine, Dialog } from './ui'

const ISSUE_LABEL: Record<ConsistencyIssue['type'], string> = {
  name: '人名',
  timeline: '时间',
  ability: '能力',
  foreshadow: '伏笔',
  pov: '视角'
}

function stateLines(key: string, value: string): string[] {
  if (key === '伏笔') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (!item || typeof item !== 'object') return ''
            const record = item as Record<string, unknown>
            const text = typeof record.text === 'string' ? record.text.trim() : ''
            const chapter = typeof record.chapter === 'number' ? record.chapter : 0
            if (!text) return ''
            return chapter > 0 ? `${text}（第 ${chapter} 章）` : text
          })
          .filter(Boolean)
          .slice(-6)
      }
    } catch {
      return []
    }
  }
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
}

export function SidePanel(): React.JSX.Element {
  const reader = useApp((state) => state.reader)
  const chapter = useApp((state) => state.chapter)
  const panelOpen = useApp((state) => state.panelOpen)
  const panelTab = useApp((state) => state.panelTab)
  const setPanelTab = useApp((state) => state.setPanelTab)
  const setPanelOpen = useApp((state) => state.setPanelOpen)
  const setDiff = useApp((state) => state.setDiff)
  const showToast = useApp((state) => state.showToast)
  const regenerate = useApp((state) => state.regenerate)
  const jobs = useApp((state) => state.jobs)

  const [directiveText, setDirectiveText] = useState('')
  const [scope, setScope] = useState<DirectiveScope>('本章')
  const [directiveBusy, setDirectiveBusy] = useState(false)
  const [directiveOff, setDirectiveOff] = useState('')

  const [beats, setBeats] = useState<string[]>([])
  const [beatsBusy, setBeatsBusy] = useState(false)

  const [instruction, setInstruction] = useState('')
  const [targets, setTargets] = useState<RewriteTarget[] | null>(null)
  const [globalNote, setGlobalNote] = useState('')
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set())
  const [selectBusy, setSelectBusy] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [fixBusy, setFixBusy] = useState('')

  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const chapterId = chapter?.id
  const chapterVersion = chapter?.version
  const locked = chapter?.status === 'generating' || chapter?.status === 'queued'

  useEffect(() => {
    setBeats([])
    setTargets(null)
    setSelectedTargets(new Set())
    setGlobalNote('')
    setInstruction('')
    setFixBusy('')
    setVersionId(null)
    setOutlineOpen(false)
    setDeleteOpen(false)
  }, [chapterId])

  useEffect(() => {
    if (!panelOpen || panelTab !== 'edit' || !chapterId) return
    let alive = true
    setVersionsLoading(true)
    void (async () => {
      try {
        const list = await unwrap(window.shiye.listVersions(chapterId))
        if (alive) setVersions(list)
      } catch {
        if (alive) setVersions([])
      } finally {
        if (alive) setVersionsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [panelOpen, panelTab, chapterId, chapterVersion])

  if (!reader) {
    return <aside className="side-panel" data-open="false" />
  }

  const pendingDirectives = reader.directives.filter(
    (directive) => directive.status === 'pending'
  )
  const activeJob = chapter
    ? jobs.find((job) => job.chapterId === chapter.id && job.status !== 'done')
    : undefined

  const addDirective = async (): Promise<void> => {
    if (!chapter || !directiveText.trim()) return
    setDirectiveBusy(true)
    try {
      await unwrap(
        window.shiye.createDirective({
          projectId: reader.project.id,
          scope,
          content: directiveText.trim()
        })
      )
      setDirectiveText('')
      showToast('info', '指令已经排进队列。')
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setDirectiveBusy(false)
    }
  }

  const removeDirective = async (directiveId: string): Promise<void> => {
    setDirectiveOff(directiveId)
    try {
      await unwrap(window.shiye.deactivateDirective(reader.project.id, directiveId))
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setDirectiveOff('')
    }
  }

  const makeBeats = async (): Promise<void> => {
    if (!chapter) return
    setBeatsBusy(true)
    try {
      const result = await unwrap(
        window.shiye.createBeats(reader.project.id, chapter.idx)
      )
      setBeats(result.beats)
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setBeatsBusy(false)
    }
  }

  const findTargets = async (): Promise<void> => {
    if (!chapter) return
    if (!instruction.trim()) {
      showToast('error', '先写一句想怎么改。')
      return
    }
    setSelectBusy(true)
    try {
      const result = await unwrap(
        window.shiye.selectTargets(chapter.id, instruction.trim())
      )
      setTargets(result.targets)
      setGlobalNote(result.globalNote)
      setSelectedTargets(new Set(result.targets.map((target) => target.chunkId)))
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setSelectBusy(false)
    }
  }

  const previewRewrite = async (): Promise<void> => {
    if (!chapter) return
    if (!instruction.trim()) {
      showToast('error', '先写一句想怎么改。')
      return
    }
    setPreviewBusy(true)
    try {
      const ids =
        targets === null
          ? []
          : targets
              .map((target) => target.chunkId)
              .filter((chunkId) => selectedTargets.has(chunkId))
      const preview = await unwrap(
        window.shiye.previewRewrite(chapter.id, instruction.trim(), ids)
      )
      setDiff(preview)
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setPreviewBusy(false)
    }
  }

  const fixIssue = async (issue: ConsistencyIssue): Promise<void> => {
    if (!chapter) return
    setFixBusy(issue.detail)
    try {
      const preview = await unwrap(
        window.shiye.fixIssues(chapter.id, `${ISSUE_LABEL[issue.type]}：${issue.detail}`)
      )
      setDiff(preview)
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setFixBusy('')
    }
  }

  const removeChapter = async (): Promise<void> => {
    if (!chapter) return
    setDeleting(true)
    try {
      await unwrap(window.shiye.deleteChapter(chapter.id))
      setDeleteOpen(false)
      showToast('info', '这一章已经删去，后面的章往前挪了。')
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setDeleting(false)
    }
  }

  const outline = chapter?.outline ?? null

  return (
    <aside className="side-panel" data-open={panelOpen ? 'true' : 'false'}>
      <div className="panel-head">
        <div className="panel-tabs">
          <button
            className="panel-tab"
            aria-pressed={panelTab === 'write'}
            onClick={() => setPanelTab('write')}
          >
            写作
          </button>
          <button
            className="panel-tab"
            aria-pressed={panelTab === 'edit'}
            onClick={() => setPanelTab('edit')}
          >
            编辑
          </button>
        </div>
        <button
          className="icon-btn"
          title="收起面板"
          aria-label="收起面板"
          onClick={() => setPanelOpen(false)}
        >
          <X size={16} strokeWidth={iconStroke} />
        </button>
      </div>

      <div className="panel-body">
        {panelTab === 'write' ? (
          <>
            <section className="panel-section">
              <h3 className="panel-title">
                <span>本章</span>
                {chapter ? (
                  <span className="badge">{STATUS_LABEL[chapter.status]}</span>
                ) : null}
              </h3>
              {chapter ? (
                <>
                  <div className="outline-line">
                    {outline?.goals.length ? (
                      outline.goals.slice(0, 3).map((goal, index) => (
                        <div key={index}>· {goal}</div>
                      ))
                    ) : (
                      <span className="muted">还没有细纲。开始写时会先拟一份。</span>
                    )}
                  </div>
                  {outline?.hook ? (
                    <div className="panel-note">钩子：{outline.hook}</div>
                  ) : null}
                  {activeJob ? (
                    <div className="job-line">
                      {activeJob.status === 'running' ? (
                        <BusyLine text={activeJob.label} />
                      ) : (
                        <span>{activeJob.label} · 排在队里</span>
                      )}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      onClick={() => setOutlineOpen(true)}
                    >
                      编辑章纲
                    </button>
                    <button
                      className="btn btn-quiet btn-sm"
                      disabled={locked}
                      onClick={() => void regenerate()}
                    >
                      <RefreshCw size={13} strokeWidth={iconStroke} />
                      重写本章
                    </button>
                  </div>
                </>
              ) : (
                <p className="panel-note">正在取回这一章。</p>
              )}
            </section>

            <section className="panel-section">
              <h3 className="panel-title">指令</h3>
              <div className="chip-row">
                {DIRECTIVE_SCOPES.map((item) => (
                  <button
                    key={item}
                    className="chip"
                    aria-pressed={scope === item}
                    onClick={() => setScope(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <textarea
                className="textarea"
                rows={3}
                maxLength={2000}
                value={directiveText}
                placeholder="例如：让这一章停在雨里，不要揭穿她的身份。"
                onChange={(event) => setDirectiveText(event.target.value)}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8
                }}
              >
                <span className="hint">会取消并重排受影响的章节。</span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={directiveBusy || !directiveText.trim()}
                  onClick={() => void addDirective()}
                >
                  {directiveBusy ? <BusyLine text="正在记下" /> : '下达'}
                </button>
              </div>
              {pendingDirectives.length > 0 ? (
                <div>
                  {pendingDirectives.map((directive) => (
                    <div className="directive-item" key={directive.id}>
                      <div className="directive-main">
                        <div className="directive-text">{directive.content}</div>
                        <div className="directive-meta">
                          <span className="badge">{directive.scope}</span>
                          <span>等待写入</span>
                        </div>
                      </div>
                      <button
                        className="icon-btn"
                        title="撤销这条指令"
                        aria-label="撤销这条指令"
                        disabled={directiveOff === directive.id}
                        onClick={() => void removeDirective(directive.id)}
                      >
                        <X size={14} strokeWidth={iconStroke} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel-empty">还没有指令。故事要往哪拐，写在这里。</p>
              )}
            </section>

            <section className="panel-section">
              <h3 className="panel-title">
                <span>三个节拍</span>
                <span className="actions">
                  <button className="link-btn" disabled={beatsBusy} onClick={() => void makeBeats()}>
                    {beats.length > 0 ? '换三个' : '想一下'}
                  </button>
                </span>
              </h3>
              {beatsBusy ? (
                <BusyLine text="正在想" />
              ) : beats.length > 0 ? (
                <>
                  {beats.map((beat, index) => (
                    <button
                      type="button"
                      className="beat-item beat-action"
                      key={index}
                      title="用这个方向写一条指令"
                      onClick={() => {
                        setDirectiveText(beat)
                        setScope('本章')
                        showToast('info', '已经放进指令框。')
                      }}
                    >
                      <span className="badge">{index + 1}</span>
                      <p>{beat}</p>
                    </button>
                  ))}
                  <p className="panel-empty" style={{ marginTop: 2 }}>
                    点一条，放进上面的指令框。
                  </p>
                </>
              ) : (
                <p className="panel-empty">卡住时，点一下，看看这一章还能往哪走。</p>
              )}
            </section>

            {reader.characters.length > 0 ? (
              <section className="panel-section">
                <h3 className="panel-title">人物</h3>
                {reader.characters.slice(0, 8).map((character) => {
                  const state = [character.state.location, character.state.condition, character.state.intent]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <div className="beat-item" key={character.id}>
                      <p>
                        <strong style={{ fontWeight: 500 }}>{character.name}</strong>
                        {state ? <span className="muted">　{state}</span> : null}
                      </p>
                    </div>
                  )
                })}
              </section>
            ) : null}

            {reader.storyState.length > 0 ? (
              <section className="panel-section">
                <h3 className="panel-title">故事状态</h3>
                {reader.storyState.map((entry) => {
                  const lines = stateLines(entry.key, entry.value)
                  if (lines.length === 0) return null
                  return (
                    <div className="state-group" key={entry.key}>
                      <div className="state-key">{entry.key}</div>
                      <ul className="state-list">
                        {lines.map((line, index) => (
                          <li key={`${entry.key}-${index}`}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </section>
            ) : null}
          </>
        ) : (
          <>
            <section className="panel-section">
              <h3 className="panel-title">改写</h3>
              <textarea
                className="textarea"
                rows={3}
                maxLength={2000}
                value={instruction}
                disabled={locked}
                placeholder="例如：删掉解释，只留下动作。"
                onChange={(event) => setInstruction(event.target.value)}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8
                }}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={selectBusy || locked || !instruction.trim()}
                  onClick={() => void findTargets()}
                >
                  {selectBusy ? <BusyLine text="正在找" /> : '找出改动点'}
                </button>
                {targets ? (
                  <span className="hint">
                    选中 {selectedTargets.size} / {targets.length} 段
                  </span>
                ) : (
                  <span className="hint">也可以直接预览</span>
                )}
              </div>

              {targets ? (
                <>
                  <div className="panel-note">{globalNote}</div>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--color-muted)'
                    }}
                  >
                    <input
                      className="target-check"
                      type="checkbox"
                      checked={selectedTargets.size === targets.length}
                      onChange={(event) =>
                        setSelectedTargets(
                          event.target.checked
                            ? new Set(targets.map((target) => target.chunkId))
                            : new Set()
                        )
                      }
                    />
                    全选
                  </label>
                  {targets.map((target) => (
                    <div className="target-item" key={target.chunkId}>
                      <input
                        className="target-check"
                        type="checkbox"
                        checked={selectedTargets.has(target.chunkId)}
                        onChange={() =>
                          setSelectedTargets((current) => {
                            const next = new Set(current)
                            if (next.has(target.chunkId)) next.delete(target.chunkId)
                            else next.add(target.chunkId)
                            return next
                          })
                        }
                      />
                      <div className="target-main">
                        <div className="target-head">
                          <span className="target-id">{target.displayId}</span>
                          <span className="badge">{target.roleTag}</span>
                        </div>
                        <div className="target-text">{target.text}</div>
                        {target.reason ? (
                          <div className="target-reason">{target.reason}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <p className="panel-empty">
                  先写要求，再决定改哪几段。也可以直接预览，让引擎自己挑。
                </p>
              )}

              <button
                className="btn btn-primary btn-sm"
                disabled={previewBusy || locked || !instruction.trim()}
                onClick={() => void previewRewrite()}
              >
                {previewBusy ? <BusyLine text="正在改" /> : '预览改动'}
              </button>
            </section>

            <section className="panel-section">
              <h3 className="panel-title">问题</h3>
              {chapter && chapter.issues.length > 0 ? (
                chapter.issues.map((issue, index) => (
                  <div className="issue-row" key={index}>
                    <span className="badge">{ISSUE_LABEL[issue.type]}</span>
                    <p>{issue.detail}</p>
                    <button
                      className="link-btn"
                      disabled={fixBusy !== '' || locked}
                      onClick={() => void fixIssue(issue)}
                    >
                      {fixBusy === issue.detail ? '正在改' : '修正'}
                    </button>
                  </div>
                ))
              ) : (
                <p className="panel-empty">没有发现明显的问题。</p>
              )}
            </section>

            <section className="panel-section">
              <h3 className="panel-title">旧稿</h3>
              {versionsLoading ? (
                <BusyLine text="正在取回" />
              ) : versions.length > 0 ? (
                versions.map((version) => (
                  <div className="version-row" key={version.id}>
                    <span className="grow" title={version.reason}>
                      {formatTime(version.createdAt)} · {version.reason || '存档'}
                    </span>
                    <button className="link-btn" onClick={() => setVersionId(version.id)}>
                      查看
                    </button>
                  </div>
                ))
              ) : (
                <p className="panel-empty">还没有旧稿。改写之前会自动留一份。</p>
              )}
            </section>

            <section className="panel-section">
              <h3 className="panel-title">这一章</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={locked}
                  onClick={() => void regenerate()}
                >
                  <RefreshCw size={13} strokeWidth={iconStroke} />
                  重新生成
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} strokeWidth={iconStroke} />
                  删除
                </button>
              </div>
            </section>
          </>
        )}
      </div>

      {outlineOpen && chapter ? (
        <OutlineDialog chapter={chapter} onClose={() => setOutlineOpen(false)} />
      ) : null}

      {versionId ? (
        <VersionDialog versionId={versionId} onClose={() => setVersionId(null)} />
      ) : null}

      {deleteOpen && chapter ? (
        <Dialog
          title="删除这一章"
          onClose={() => {
            if (!deleting) setDeleteOpen(false)
          }}
          footer={
            <>
              <button
                className="btn btn-quiet"
                disabled={deleting}
                onClick={() => setDeleteOpen(false)}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                disabled={deleting}
                onClick={() => void removeChapter()}
              >
                {deleting ? '正在删除' : '确认删除'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.85 }}>
            将删除第 {chapter.idx} 章的正文、章纲与旧稿，后面的章会依次往前挪。此操作无法撤销。
          </p>
        </Dialog>
      ) : null}
    </aside>
  )
}
