import { useEffect, useMemo, useState } from 'react'
import { diffChars } from 'diff'
import { X } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import type { RewriteEdit, RewritePreview } from '@shared/types'
import { useApp } from '../store'
import { errorText, formatCount, unwrap } from '../lib'
import { onBack } from '../back'
import { BusyLine } from './ui'

const ACTION_LABEL: Record<RewriteEdit['action'], string> = {
  rewrite: '改写',
  delete: '删除',
  insert_after: '插入',
  move: '移动'
}

function InlineDiff({ edit }: { edit: RewriteEdit }): React.JSX.Element {
  if (edit.action === 'delete') {
    return <span className="remove">{edit.before}</span>
  }
  if (edit.action === 'insert_after') {
    return (
      <>
        <span>{edit.before}</span>
        <br />
        <span className="add">{edit.after}</span>
      </>
    )
  }
  const parts = diffChars(edit.before, edit.after)
  return (
    <>
      {parts.map((part, index) =>
        part.added ? (
          <span className="add" key={index}>
            {part.value}
          </span>
        ) : part.removed ? (
          <span className="remove" key={index}>
            {part.value}
          </span>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </>
  )
}

export function DiffOverlay({ preview }: { preview: RewritePreview }): React.JSX.Element {
  const setDiff = useApp((state) => state.setDiff)
  const refreshChapter = useApp((state) => state.refreshChapter)
  const showToast = useApp((state) => state.showToast)

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preview.edits.map((edit) => edit.chunkId))
  )
  const [busy, setBusy] = useState(false)

  const chapterLabel = useMemo(
    () => `第 ${preview.chapterIdx} 章`,
    [preview.chapterIdx]
  )

  const discard = (): void => {
    if (busy) return
    void window.shiye.discardRewrite(preview.id)
    setDiff(null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') discard()
    }
    window.addEventListener('keydown', onKey)
    const removeBack = onBack(discard)
    return () => {
      window.removeEventListener('keydown', onKey)
      removeBack()
    }
  })

  const toggle = (chunkId: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(chunkId)) next.delete(chunkId)
      else next.add(chunkId)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    const ids = preview.edits
      .map((edit) => edit.chunkId)
      .filter((chunkId) => selected.has(chunkId))
    if (ids.length === 0) return
    setBusy(true)
    try {
      const result = await unwrap(
        window.shiye.applyRewrite(
          preview.id,
          ids.length === preview.edits.length ? undefined : ids
        )
      )
      await refreshChapter()
      setDiff(null)
      showToast(
        'info',
        result.staleChapters.length > 0
          ? `已经改好。后面 ${result.staleChapters.length} 章需要校对。`
          : '改动已经落到正文里。'
      )
    } catch (error) {
      showToast('error', errorText(error))
      setBusy(false)
    }
  }

  const chosen = preview.edits.filter((edit) => selected.has(edit.chunkId)).length
  const all = chosen === preview.edits.length

  return (
    <div className="diff-overlay">
      <div className="diff-head">
        <span className="diff-head-title">改动预览</span>
        <span className="hint">{chapterLabel}</span>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {formatCount(preview.beforeWordCount)} 字 → {formatCount(preview.afterWordCount)} 字
        </span>
        <button className="icon-btn" onClick={discard} title="关闭" aria-label="关闭">
          <X size={16} strokeWidth={iconStroke} />
        </button>
      </div>

      <div className="diff-scroll">
        <div className="diff-inner">
          <p className="diff-summary">
            {preview.instruction
              ? `按「${preview.instruction}」改动，绿色为新增，红色为删去。`
              : '绿色为新增，红色为删去。'}
            {preview.globalNote ? ` ${preview.globalNote}` : ''}
          </p>
          {preview.edits.map((edit) => (
            <div className="diff-card" key={edit.chunkId}>
              <div className="diff-card-head">
                <span className="badge">{edit.displayId}</span>
                <span>{ACTION_LABEL[edit.action]}</span>
                <span className="grow" />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    className="target-check"
                    type="checkbox"
                    checked={selected.has(edit.chunkId)}
                    disabled={busy}
                    onChange={() => toggle(edit.chunkId)}
                  />
                  采纳
                </label>
              </div>
              <div className="diff-text">
                <InlineDiff edit={edit} />
              </div>
              {edit.reason ? <div className="diff-reason">{edit.reason}</div> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="diff-foot">
        <span className="count">
          已选 {chosen} / {preview.edits.length} 处
        </span>
        <button className="btn btn-quiet" disabled={busy} onClick={discard}>
          放弃改动
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || chosen === 0}
          onClick={() => void apply()}
        >
          {busy ? <BusyLine text="正在落笔" /> : all ? '全部应用' : `应用 ${chosen} 处`}
        </button>
      </div>
    </div>
  )
}
