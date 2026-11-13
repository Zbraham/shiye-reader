import { useState } from 'react'
import type { Chapter } from '@shared/types'
import { useApp } from '../store'
import { errorText, unwrap } from '../lib'
import { Dialog, Field, splitLines } from './ui'

interface OutlineDialogProps {
  chapter: Chapter
  onClose: () => void
}

export function OutlineDialog({ chapter, onClose }: OutlineDialogProps): React.JSX.Element {
  const refreshChapter = useApp((state) => state.refreshChapter)
  const showToast = useApp((state) => state.showToast)
  const outline = chapter.outline

  const [title, setTitle] = useState(outline?.title ?? chapter.title)
  const [goals, setGoals] = useState((outline?.goals ?? []).join('\n'))
  const [advance, setAdvance] = useState((outline?.advance ?? []).join('\n'))
  const [forbidden, setForbidden] = useState((outline?.forbidden ?? []).join('\n'))
  const [hook, setHook] = useState(outline?.hook ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await unwrap(
        window.shiye.updateOutline({
          chapterId: chapter.id,
          title: title.trim().slice(0, 60),
          goals: splitLines(goals).map((item) => item.slice(0, 200)).slice(0, 8),
          advance: splitLines(advance).map((item) => item.slice(0, 200)).slice(0, 8),
          forbidden: splitLines(forbidden).map((item) => item.slice(0, 200)).slice(0, 8),
          hook: hook.trim().slice(0, 300)
        })
      )
      await refreshChapter()
      showToast('info', '章纲已经改好。')
      onClose()
    } catch (cause) {
      setError(errorText(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="章纲"
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          {error ? <span className="error-text" style={{ marginRight: 'auto' }}>{error}</span> : null}
          <button className="btn btn-quiet" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '正在保存' : '保存'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="标题">
          <input
            className="input"
            maxLength={60}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="本章目标" hint="一行一条。写这一章要抵达哪里。">
          <textarea
            className="textarea"
            rows={3}
            value={goals}
            onChange={(event) => setGoals(event.target.value)}
          />
        </Field>
        <Field label="必须推进" hint="一行一条。哪些线索必须往前走。">
          <textarea
            className="textarea"
            rows={3}
            value={advance}
            onChange={(event) => setAdvance(event.target.value)}
          />
        </Field>
        <Field label="避免" hint="一行一条。不想在这一章出现的东西。">
          <textarea
            className="textarea"
            rows={2}
            value={forbidden}
            onChange={(event) => setForbidden(event.target.value)}
          />
        </Field>
        <Field label="结尾的钩子">
          <textarea
            className="textarea"
            rows={2}
            maxLength={300}
            value={hook}
            onChange={(event) => setHook(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  )
}
