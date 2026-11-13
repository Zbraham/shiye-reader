import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { STATUS_LABEL } from '@shared/constants'
import type { ChapterMeta } from '@shared/types'
import { stripChapterPrefix } from '../lib'

interface TocDrawerProps {
  open: boolean
  chapters: ChapterMeta[]
  currentIdx: number
  onClose: () => void
  onPick: (idx: number) => void
}

function labelOf(chapter: ChapterMeta): string {
  const label = stripChapterPrefix(chapter.title, chapter.idx)
  return label === `第 ${chapter.idx} 章` ? '尚未命名' : label
}

export function TocDrawer({
  open,
  chapters,
  currentIdx,
  onClose,
  onPick
}: TocDrawerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (ref.current?.contains(target)) return
      if (target.closest('[data-toc-trigger]')) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div className="toc-drawer" data-open={open ? 'true' : 'false'} ref={ref}>
      <div className="toc-head">
        <span className="toc-title">目录</span>
        <button className="icon-btn" onClick={onClose} title="收起目录" aria-label="收起目录">
          <X size={16} strokeWidth={iconStroke} />
        </button>
      </div>
      <div className="toc-list">
        {chapters.map((chapter, index) => {
          const previous = chapters[index - 1]
          const showVolume =
            Boolean(chapter.volume) && chapter.volume !== previous?.volume
          return (
            <div className="toc-entry" key={chapter.id}>
              {showVolume ? (
                <button
                  className="toc-volume"
                  onClick={() => onPick(chapter.idx)}
                  title={chapter.volume}
                >
                  {chapter.volume}
                </button>
              ) : null}
              <button
                className="toc-item"
                data-current={chapter.idx === currentIdx}
                data-level={chapter.level > 1 ? 'sub' : 'main'}
                onClick={() => onPick(chapter.idx)}
                title={`${STATUS_LABEL[chapter.status]} · ${chapter.wordCount} 字`}
              >
                <span className="toc-idx">{String(chapter.idx).padStart(2, '0')}</span>
                <span className="toc-label">{labelOf(chapter)}</span>
                <span className="status-dot" data-status={chapter.status} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
