import { useEffect, useState } from 'react'
import type { Chapter } from '@shared/types'
import { useApp } from '../store'
import { errorText, unwrap } from '../lib'
import { onBack } from '../back'
import type { TextSelection } from './ProseView'
import { BusyLine } from './ui'

type ManualMode = 'rewrite' | 'expand' | 'condense' | 'tone' | 'continue'

const MODES: Array<{ value: ManualMode; label: string; hint: string }> = [
  { value: 'rewrite', label: '改写', hint: '想改成什么样？' },
  { value: 'expand', label: '扩写', hint: '补足哪些细节？' },
  { value: 'condense', label: '精简', hint: '只留下什么？' },
  { value: 'tone', label: '语气', hint: '换成什么语气？' },
  { value: 'continue', label: '续写', hint: '接下来往哪走？' }
]

interface SelectionToolbarProps {
  selection: TextSelection
  chapter: Chapter
  projectId: string
  onClose: () => void
}

export function SelectionToolbar({
  selection,
  chapter,
  projectId,
  onClose
}: SelectionToolbarProps): React.JSX.Element {
  const setDiff = useApp((state) => state.setDiff)
  const showToast = useApp((state) => state.showToast)
  const [mode, setMode] = useState<ManualMode>('rewrite')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [readyAt] = useState(() => Date.now() + 260)
  const coarsePointer =
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      // On touch screens the bar appears while the native selection handles
      // are still settling; do not dismiss it on those first pointer events.
      if (Date.now() < readyAt) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-selection-bar]')) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, readyAt])

  useEffect(() => onBack(onClose), [onClose])

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const preview = await unwrap(
        window.shiye.previewManual({
          projectId,
          chapterId: chapter.id,
          start: selection.start,
          end: selection.end,
          mode,
          instruction: instruction.trim()
        })
      )
      setDiff(preview)
      onClose()
    } catch (error) {
      showToast('error', errorText(error))
      setBusy(false)
    }
  }

  const width = 316
  const left = Math.max(
    16,
    Math.min(selection.rect.left, window.innerWidth - width - 16)
  )
  const below = window.innerHeight - selection.rect.bottom
  const top =
    below > 196
      ? selection.rect.bottom + 8
      : Math.max(16, selection.rect.top - 188)

  const activeHint = MODES.find((item) => item.value === mode)?.hint ?? ''

  return (
    <div
      className="selection-bar"
      data-selection-bar=""
      style={{ left, top, width }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="selection-modes">
        {MODES.map((item) => (
          <button
            key={item.value}
            aria-pressed={mode === item.value}
            disabled={busy}
            onClick={() => setMode(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <input
        className="input"
        autoFocus={!coarsePointer}
        maxLength={2000}
        value={instruction}
        placeholder={activeHint}
        disabled={busy}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !busy) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-quiet btn-sm" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? <BusyLine text="正在拟稿" /> : '预览'}
        </button>
      </div>
    </div>
  )
}
