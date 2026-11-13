import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Sparkles, Square } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { STATUS_LABEL } from '@shared/constants'
import {
  planPlot,
  PlotPlanError,
  type PlotPlan
} from '@shared/plot/plan'
import { useApp, type PlotAnchor } from '../store'
import { errorText, formatWords, unwrap } from '../lib'
import { VersionDialog } from './VersionDialog'
import { BusyLine, Dialog } from './ui'

function planErrorText(error: unknown): string {
  if (error instanceof PlotPlanError) return error.message
  return error instanceof Error ? error.message : '这个起点无法改写。'
}

function targetRange(plan: PlotPlan): string {
  const first = plan.units[0]?.chapterIdx ?? 0
  const last = plan.units[2]?.chapterIdx ?? 0
  return first === last ? `第 ${first} 章` : `第 ${first}–${last} 章`
}

export function PlotPanel(): React.JSX.Element | null {
  const reader = useApp((state) => state.reader)
  const chapter = useApp((state) => state.chapter)
  const plotAnchor = useApp((state) => state.plotAnchor)
  const plotDirection = useApp((state) => state.plotDirection)
  const plotBatch = useApp((state) => state.plotBatch)
  const plotStatus = useApp((state) => state.plotStatus)
  const plotMessage = useApp((state) => state.plotMessage)
  const setPlotAnchor = useApp((state) => state.setPlotAnchor)
  const setPlotDirection = useApp((state) => state.setPlotDirection)
  const beginPlotBatch = useApp((state) => state.beginPlotBatch)
  const stopPlotBatch = useApp((state) => state.stopPlotBatch)
  const refreshReader = useApp((state) => state.refreshReader)
  const refreshChapter = useApp((state) => state.refreshChapter)
  const showToast = useApp((state) => state.showToast)

  const [beats, setBeats] = useState<string[]>([])
  const [beatsBusy, setBeatsBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<{
    anchor: PlotAnchor
    direction: string
  } | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)

  const anchorKey = plotAnchor
    ? `${plotAnchor.chapterIdx}:${plotAnchor.startMode}:${plotAnchor.offset ?? ''}`
    : ''

  useEffect(() => {
    setBeats([])
  }, [anchorKey])

  // Opening the panel on an untouched chapter starts from "keep this chapter".
  useEffect(() => {
    if (plotAnchor || !chapter) return
    setPlotAnchor({
      chapterIdx: chapter.idx,
      startMode: 'after',
      offset: null,
      excerpt: ''
    })
  }, [plotAnchor, chapter, setPlotAnchor])

  const chapterCount = reader?.chapters[reader.chapters.length - 1]?.idx ?? 0

  const plan = useMemo<{ value: PlotPlan | null; error: string }>(() => {
    if (!plotAnchor || chapterCount < 1) return { value: null, error: '' }
    try {
      return {
        value: planPlot({
          fromIdx: plotAnchor.chapterIdx,
          startMode: plotAnchor.startMode,
          startOffset: plotAnchor.offset,
          chapterCount,
          batchSize: 3
        }),
        error: ''
      }
    } catch (error) {
      return { value: null, error: planErrorText(error) }
    }
  }, [plotAnchor, chapterCount])

  if (!reader) return null

  const target = plan.value
  const running = plotStatus === 'running'
  const anchorChapter = plotAnchor
    ? reader.chapters.find((item) => item.idx === plotAnchor.chapterIdx)
    : undefined
  const anchorHasText = (anchorChapter?.wordCount ?? 0) > 0

  const chooseMode = (mode: 'after' | 'include'): void => {
    if (!plotAnchor || running) return
    setPlotAnchor({ ...plotAnchor, startMode: mode, offset: null, excerpt: '' })
  }

  const requestBeats = async (): Promise<void> => {
    if (!plotAnchor) return
    setBeatsBusy(true)
    try {
      const result = await unwrap(
        window.shiye.plotBeats({
          projectId: reader.project.id,
          fromIdx: plotAnchor.chapterIdx,
          startMode: plotAnchor.startMode,
          startOffset: plotAnchor.offset
        })
      )
      setBeats(result.beats)
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setBeatsBusy(false)
    }
  }

  const execute = async (
    anchor: PlotAnchor,
    direction: string
  ): Promise<void> => {
    setBusy(true)
    try {
      const result = await unwrap(
        window.shiye.plotRewrite({
          projectId: reader.project.id,
          fromIdx: anchor.chapterIdx,
          startMode: anchor.startMode,
          startOffset: anchor.offset,
          direction,
          batchSize: 3
        })
      )
      setPlotAnchor(anchor)
      beginPlotBatch(result, direction)
      setConfirming(null)
      await refreshReader()
      await refreshChapter()
      const first = result.units[0]?.idx ?? 0
      const last = result.units[result.units.length - 1]?.idx ?? 0
      showToast(
        'info',
        `已开始改写第 ${first}–${last} 章，旧稿已存入版本历史。`
      )
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const askRewrite = (): void => {
    if (!plotAnchor || !target || running) return
    if (!plotDirection.trim()) {
      showToast('error', '先写一句希望故事往哪走。')
      return
    }
    setConfirming({ anchor: plotAnchor, direction: plotDirection.trim() })
  }

  const continueBatch = (): void => {
    if (!plotBatch || !plotDirection.trim() || running) return
    setConfirming({
      anchor: {
        chapterIdx: plotBatch.replaceTo,
        startMode: 'after',
        offset: null,
        excerpt: ''
      },
      direction: plotDirection.trim()
    })
  }

  const rangeLines: string[] = []
  if (target) {
    const n = plotAnchor?.chapterIdx ?? 0
    if (plotAnchor?.startMode === 'after') {
      rangeLines.push(`保留第 ${n} 章；重写${targetRange(target)}。`)
    } else if (plotAnchor?.startMode === 'include') {
      rangeLines.push(
        `连同第 ${n} 章一起重写，并续写第 ${n + 1}–${n + 2} 章。`
      )
    } else if (plotAnchor) {
      rangeLines.push(
        `保留第 ${n} 章前 ${plotAnchor.offset ?? 0} 字到段末，改写其后内容与第 ${
          n + 1
        }–${n + 2} 章。`
      )
    }
    if (target.created.length > 0) {
      const created = target.created
      rangeLines.push(
        created.length === 1
          ? `第 ${created[0]} 章尚不存在，会新建。`
          : `第 ${created[0]}–${created[created.length - 1]} 章尚不存在，会新建。`
      )
    }
    if (target.staleFrom <= chapterCount) {
      rangeLines.push(`第 ${target.staleFrom} 章起标记为待校对。`)
    }
    rangeLines.push('被替换章节的旧稿会先存入版本历史，可对比或恢复。')
  }

  const canRun = Boolean(
    target && !running && !busy && plotDirection.trim() && (anchorHasText || plotAnchor?.startMode === 'include')
  )

  return (
    <div className="plot-panel">
      <section className="panel-section">
        <h3 className="panel-title">
          <span>从哪一段开始改写</span>
          {plotAnchor ? <span className="badge">第 {plotAnchor.chapterIdx} 章</span> : null}
        </h3>

        {plotAnchor ? (
          <>
            {plotAnchor.startMode === 'paragraph' ? (
              <div className="plot-anchor">
                <div className="plot-anchor-head">
                  <span>第 {plotAnchor.chapterIdx} 章 · 保留到段末</span>
                  <span className="badge">段落起点</span>
                </div>
                {plotAnchor.excerpt ? (
                  <p className="plot-excerpt">“{plotAnchor.excerpt}”</p>
                ) : null}
                <p className="hint">
                  已保留 {formatWords(plotAnchor.offset ?? 0)}的原文，从段末之后接着写。
                </p>
              </div>
            ) : (
              <>
                <div className="seg">
                  <button
                    aria-pressed={plotAnchor.startMode === 'after'}
                    disabled={running}
                    onClick={() => chooseMode('after')}
                  >
                    保留本章
                  </button>
                  <button
                    aria-pressed={plotAnchor.startMode === 'include'}
                    disabled={running}
                    onClick={() => chooseMode('include')}
                  >
                    连同本章
                  </button>
                </div>
                <p className="hint">
                  {plotAnchor.startMode === 'after'
                    ? `把第 ${plotAnchor.chapterIdx} 章当作前文，从这里往后换一条路。`
                    : `第 ${plotAnchor.chapterIdx} 章的旧正文也会被替换。`}
                </p>
              </>
            )}
          </>
        ) : (
          <p className="panel-empty">正在定位这一章。</p>
        )}

        {plan.error ? <p className="error-text">{plan.error}</p> : null}
      </section>

      {target ? (
        <section className="panel-section">
          <h3 className="panel-title">这一次的范围</h3>
          <div className="plot-range">
            {rangeLines.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
          <div className="plot-targets">
            {target.units.map((unit) => (
              <div className="plot-target" key={unit.chapterIdx}>
                <span>第 {unit.chapterIdx} 章</span>
                <span className="hint">
                  {target.created.includes(unit.chapterIdx)
                    ? '新写'
                    : unit.keepPrefixChars > 0
                      ? '续写后半章'
                      : '替换'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel-section">
        <h3 className="panel-title">
          <span>方向</span>
          <span className="actions">
            <button
              className="link-btn"
              disabled={beatsBusy || running || busy || !plotAnchor}
              onClick={() => void requestBeats()}
            >
              {beats.length > 0 ? '换三个走向' : '想三个走向'}
            </button>
          </span>
        </h3>
        <textarea
          className="textarea"
          rows={4}
          maxLength={2000}
          value={plotDirection}
          disabled={running}
          placeholder="例如：让她在雨夜认出写信的人，但先不揭穿；下一章把旧信烧掉。"
          onChange={(event) => setPlotDirection(event.target.value)}
        />
        <span className="hint">
          方向只作用于这一次的三章；写的还是原来的文风与人称。
        </span>
        {beatsBusy ? <BusyLine text="正在想三个走向" /> : null}
        {beats.length > 0 ? (
          <>
            {beats.map((beat, index) => (
              <button
                type="button"
                className="beat-item beat-action"
                key={index}
                disabled={running}
                title="用这个方向改写后续"
                onClick={() => {
                  setPlotDirection(beat)
                  showToast('info', '已经放进方向框。')
                }}
              >
                <span className="badge">{index + 1}</span>
                <p>{beat}</p>
              </button>
            ))}
            <p className="panel-empty" style={{ marginTop: 2 }}>
              点一条，放进上面的方向框。
            </p>
          </>
        ) : null}
      </section>

      <section className="panel-section">
        <h3 className="panel-title">
          <span>改写</span>
          <span className="badge">每次 3 章</span>
        </h3>
        {running ? (
          <div className="plot-running">
            <BusyLine text="正在按方向往下写" />
            <button
              className="btn btn-quiet btn-sm"
              onClick={() => void stopPlotBatch()}
            >
              <Square size={12} strokeWidth={iconStroke} />
              停止本批
            </button>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!canRun || busy}
            onClick={askRewrite}
          >
            {busy ? (
              <BusyLine text="正在启动" />
            ) : (
              <>
                <Sparkles size={14} strokeWidth={iconStroke} />
                改写后续 3 章
              </>
            )}
          </button>
        )}
        {!anchorHasText && plotAnchor?.startMode !== 'include' ? (
          <p className="error-text">这一章还没有正文，无法据此续写。</p>
        ) : null}
      </section>

      {plotBatch ? (
        <section className="panel-section">
          <h3 className="panel-title">
            <span>本批进度</span>
            <span className="badge">
              {plotStatus === 'running'
                ? '写作中'
                : plotStatus === 'done'
                  ? '已完成'
                  : plotStatus === 'failed'
                    ? '中途停下'
                    : '已停止'}
            </span>
          </h3>
          {plotBatch.units.map((unit) => {
            const meta = reader.chapters.find((item) => item.idx === unit.idx)
            const status = meta?.status ?? 'outline'
            return (
              <div className="plot-progress-row" key={unit.idx}>
                <span className="plot-progress-idx">第 {unit.idx} 章</span>
                <span className="plot-progress-state" data-status={status}>
                  {STATUS_LABEL[status]}
                </span>
                {unit.versionId ? (
                  <button
                    className="link-btn"
                    onClick={() => setVersionId(unit.versionId)}
                  >
                    旧稿
                  </button>
                ) : (
                  <span className="hint">新写</span>
                )}
              </div>
            )
          })}
          {plotMessage ? <p className="error-text">{plotMessage}</p> : null}
          {plotStatus === 'done' ? (
            <div className="plot-followup">
              <button
                className="btn btn-ghost btn-sm"
                disabled={!plotDirection.trim()}
                onClick={continueBatch}
              >
                <RotateCcw size={13} strokeWidth={iconStroke} />
                再写 3 章
              </button>
              <span className="hint">从第 {plotBatch.replaceTo} 章末继续。</span>
            </div>
          ) : plotStatus === 'stopped' || plotStatus === 'failed' ? (
            <div className="plot-followup">
              <button
                className="btn btn-ghost btn-sm"
                disabled={!plotAnchor || !plotDirection.trim() || busy}
                onClick={() => {
                  if (!plotAnchor || !plotDirection.trim()) return
                  setConfirming({
                    anchor: plotAnchor,
                    direction: plotDirection.trim()
                  })
                }}
              >
                <RotateCcw size={13} strokeWidth={iconStroke} />
                重新改这三章
              </button>
              <span className="hint">
                {plotAnchor
                  ? '本批停在中途，会从原来的起点重来，不跳过后面的章节。'
                  : '本批停在中途，请回到正文重新选择起点。'}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {confirming ? (
        <Dialog
          title="确认改写后续 3 章"
          onClose={() => {
            if (!busy) setConfirming(null)
          }}
          footer={
            <>
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => setConfirming(null)}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void execute(confirming.anchor, confirming.direction)}
              >
                {busy ? <BusyLine text="正在启动" /> : '开始改写'}
              </button>
            </>
          }
        >
          {(() => {
            try {
              const next = planPlot({
                fromIdx: confirming.anchor.chapterIdx,
                startMode: confirming.anchor.startMode,
                startOffset: confirming.anchor.offset,
                chapterCount,
                batchSize: 3
              })
              const first = next.units[0]?.chapterIdx ?? 0
              const last = next.units[2]?.chapterIdx ?? 0
              return (
                <div className="plot-confirm">
                  <p>
                    {confirming.anchor.startMode === 'after'
                      ? `保留第 ${confirming.anchor.chapterIdx} 章，重写第 ${first}–${last} 章。`
                      : confirming.anchor.startMode === 'include'
                        ? `连同第 ${confirming.anchor.chapterIdx} 章一起重写，范围到第 ${last} 章。`
                        : `保留第 ${confirming.anchor.chapterIdx} 章到段末，重写其后内容与第 ${first + 1}–${last} 章。`}
                  </p>
                  <div className="plot-confirm-direction">
                    <span className="label">方向</span>
                    <p>{confirming.direction}</p>
                  </div>
                  <p className="hint">
                    旧稿会先存进版本历史。开始后会依次写完这三章，失败就停，
                    不会用旧稿硬接下一章。
                  </p>
                </div>
              )
            } catch (error) {
              return <p className="error-text">{planErrorText(error)}</p>
            }
          })()}
        </Dialog>
      ) : null}

      {versionId ? (
        <VersionDialog versionId={versionId} onClose={() => setVersionId(null)} />
      ) : null}
    </div>
  )
}
