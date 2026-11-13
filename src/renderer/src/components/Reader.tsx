import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  PanelRight,
  RotateCcw,
  Settings2,
  Square
} from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { SETTINGS_LIMITS } from '@shared/constants'
import { countWords } from '@shared/text'
import { useApp } from '../store'
import { errorText, stripChapterPrefix, unwrap } from '../lib'
import { ProseView, type TextSelection } from './ProseView'
import { TocDrawer } from './TocDrawer'
import { SidePanel } from './SidePanel'
import { SelectionToolbar } from './SelectionToolbar'
import { DiffOverlay } from './DiffOverlay'
import { SettingsDialog } from './SettingsDialog'

export function Reader(): React.JSX.Element {
  const reader = useApp((state) => state.reader)
  const chapter = useApp((state) => state.chapter)
  const liveText = useApp((state) => state.liveText)
  const panelOpen = useApp((state) => state.panelOpen)
  const tocOpen = useApp((state) => state.tocOpen)
  const diff = useApp((state) => state.diff)
  const settingsOpen = useApp((state) => state.settingsOpen)
  const openLibrary = useApp((state) => state.openLibrary)
  const loadChapter = useApp((state) => state.loadChapter)
  const goPrev = useApp((state) => state.goPrev)
  const goNext = useApp((state) => state.goNext)
  const setPanelOpen = useApp((state) => state.setPanelOpen)
  const setTocOpen = useApp((state) => state.setTocOpen)
  const setSettingsOpen = useApp((state) => state.setSettingsOpen)
  const cancelGeneration = useApp((state) => state.cancelGeneration)
  const regenerate = useApp((state) => state.regenerate)
  const requestChapter = useApp((state) => state.requestChapter)
  const updateCursor = useApp((state) => state.updateCursor)
  const showToast = useApp((state) => state.showToast)

  const [barHidden, setBarHidden] = useState(true)
  const [progressVisible, setProgressVisible] = useState(false)
  const [selection, setSelection] = useState<TextSelection | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastTop = useRef(0)
  const hideTimer = useRef<number | undefined>(undefined)
  const saveAt = useRef(0)

  const chapterId = chapter?.id
  const generating = chapter?.status === 'generating'
  const active = chapter?.status === 'generating' || chapter?.status === 'queued'

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = 0
    lastTop.current = 0
    setBarHidden(true)
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [chapterId])

  useEffect(() => {
    return () => {
      window.clearTimeout(hideTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!generating) return
    const element = scrollRef.current
    if (!element) return
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 280
    if (nearBottom) element.scrollTop = element.scrollHeight
  }, [liveText, generating])

  const clearSelection = (): void => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  if (!reader) {
    return (
      <div className="reader-shell">
        <div className="reader-topbar">
          <button
            className="icon-btn"
            title="回到书架"
            aria-label="回到书架"
            onClick={openLibrary}
          >
            <ArrowLeft size={17} strokeWidth={iconStroke} />
          </button>
        </div>
        <div className="reader-scroll">
          <div className="chapter-holder">
            <h2>正在打开这本书</h2>
            <span className="quiet-caret" />
          </div>
        </div>
      </div>
    )
  }

  const total = Math.max(reader.chapters.length, chapter?.idx ?? 1)
  const currentIdx = chapter?.idx ?? 1
  const ratio = total > 0 ? Math.min(1, currentIdx / total) : 0
  const content = chapter ? liveText || chapter.content : ''
  const hasText = content.trim().length > 0
  const title = chapter ? stripChapterPrefix(chapter.title, chapter.idx) : ''
  const generic = chapter ? title === `第 ${chapter.idx} 章` : true

  const handleScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    const top = element.scrollTop
    const delta = top - lastTop.current
    if (top < 48) setBarHidden(false)
    else if (delta > 8) setBarHidden(true)
    else if (delta < -8) setBarHidden(false)
    lastTop.current = top

    setProgressVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setProgressVisible(false), 3000)

    const now = Date.now()
    if (chapter && element.scrollHeight > element.clientHeight + 4 && now - saveAt.current > 900) {
      saveAt.current = now
      const position = top / (element.scrollHeight - element.clientHeight)
      updateCursor(chapter.idx, Math.min(1, Math.max(0, position)))
    }
  }

  const staleAction = async (action: 'rewrite' | 'ignore'): Promise<void> => {
    if (!chapter) return
    try {
      await unwrap(window.shiye.staleAction(chapter.id, action))
      if (action === 'rewrite') showToast('info', '已经重新排进队列。')
    } catch (error) {
      showToast('error', errorText(error))
    }
  }

  let banner: React.ReactNode = null
  if (chapter) {
    if (chapter.status === 'generating') {
      banner = (
        <div className="reader-banner">
          <span>
            正在写这一章 · {countWords(content)} 字
            <span className="quiet-caret" />
          </span>
          <div className="banner-actions">
            <button className="btn btn-quiet btn-sm" onClick={() => void cancelGeneration()}>
              <Square size={12} strokeWidth={iconStroke} />
              停下
            </button>
          </div>
        </div>
      )
    } else if (chapter.error) {
      banner = (
        <div className="reader-banner" data-tone="danger">
          <span>上一稿没有写完：{chapter.error}</span>
          <div className="banner-actions">
            <button className="btn btn-quiet btn-sm" onClick={() => void regenerate()}>
              <RotateCcw size={12} strokeWidth={iconStroke} />
              重新生成
            </button>
          </div>
        </div>
      )
    } else if (chapter.status === 'stale') {
      banner = (
        <div className="reader-banner" data-tone="warn">
          <span>{chapter.staleReason || '前文有改动，这一章可能需要校对。'}</span>
          <div className="banner-actions">
            <button className="btn btn-quiet btn-sm" onClick={() => void staleAction('ignore')}>
              保留
            </button>
            <button className="btn btn-quiet btn-sm" onClick={() => void staleAction('rewrite')}>
              重写
            </button>
          </div>
        </div>
      )
    } else if (chapter.status === 'queued' && hasText) {
      banner = (
        <div className="reader-banner">
          <span>这一章正在排队重写。</span>
          <div className="banner-actions">
            <button className="btn btn-quiet btn-sm" onClick={() => void cancelGeneration()}>
              取消
            </button>
          </div>
        </div>
      )
    }
  }

  const showPlaceholder = chapter !== null && !hasText && !generating

  const toggleChrome = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        'button, a, input, textarea, select, label, .selection-bar, .reader-banner'
      )
    ) {
      return
    }
    const selected = window.getSelection()
    if (selected && !selected.isCollapsed && selected.toString().trim()) return
    if (tocOpen || panelOpen || diff || settingsOpen) return
    setBarHidden((hidden) => !hidden)
  }

  return (
    <div
      className="reader-shell"
      onMouseMove={(event) => {
        if (event.clientY <= 80 && barHidden) setBarHidden(false)
      }}
    >
      <div className="reader-topbar" data-hidden={barHidden ? 'true' : 'false'}>
        <button
          className="icon-btn"
          title="回到书架"
          aria-label="回到书架"
          onClick={openLibrary}
        >
          <ArrowLeft size={17} strokeWidth={iconStroke} />
        </button>
        <button
          className="icon-btn"
          data-toc-trigger=""
          title="目录"
          aria-label="目录"
          aria-pressed={tocOpen}
          onClick={() => setTocOpen(!tocOpen)}
        >
          <List size={17} strokeWidth={iconStroke} />
        </button>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            minWidth: 0,
            marginLeft: 2
          }}
        >
          <span className="topbar-title">{reader.project.title}</span>
          <span className="topbar-sub">
            {chapter ? `第 ${chapter.idx} 章` : '正在取回'}
          </span>
        </div>
        <div className="topbar-spacer" />
        <button
          className="icon-btn"
          title="写作面板"
          aria-label="写作面板"
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <PanelRight size={17} strokeWidth={iconStroke} />
        </button>
        <button
          className="icon-btn"
          title="设置"
          aria-label="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={17} strokeWidth={iconStroke} />
        </button>
      </div>

      {tocOpen || panelOpen ? (
        <div
          className="mobile-scrim"
          onClick={() => {
            setTocOpen(false)
            setPanelOpen(false)
          }}
        />
      ) : null}

      <TocDrawer
        open={tocOpen}
        chapters={reader.chapters}
        currentIdx={currentIdx}
        onClose={() => setTocOpen(false)}
        onPick={(idx) => {
          setTocOpen(false)
          if (idx !== chapter?.idx) void loadChapter(idx)
        }}
      />

      <div className="reader-grid" data-panel={panelOpen ? 'true' : 'false'}>
        <div
          className="reader-scroll"
          ref={scrollRef}
          onScroll={handleScroll}
          onClick={toggleChrome}
        >
          <article
            className="reader-article fade-in"
            key={chapter?.id ?? 'empty'}
          >
            {banner}

            {!chapter ? (
              <div className="chapter-holder">
                <h2>正在取回这一章</h2>
                <span className="quiet-caret" />
              </div>
            ) : showPlaceholder ? (
              <div className="chapter-holder">
                <h2>
                  {chapter.status === 'queued' ? '这一章在队列里' : '这一章还没开始'}
                </h2>
                <p>
                  {chapter.status === 'queued'
                    ? '前面还有任务。也可以让它先写。'
                    : '可以让它接着前文写下去。'}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => void requestChapter(chapter.idx)}
                >
                  {chapter.status === 'queued' ? '优先写这一章' : '开始写这一章'}
                </button>
              </div>
            ) : (
              <>
                <p className="chapter-kicker">第 {chapter.idx} 章</p>
                {!generic ? <h1 className="chapter-title">{title}</h1> : null}
                <ProseView
                  content={content}
                  streaming={generating}
                  onSelect={
                    active
                      ? undefined
                      : (next) => {
                          if (next.end - next.start > 2000) {
                            showToast('error', '一次最多改 2000 字，请分段选择。')
                            return
                          }
                          setSelection(next)
                        }
                  }
                />
                {hasText ? (
                  <>
                    <div className="chapter-end">· · ·</div>
                    <div className="chapter-nav">
                      <button
                        className="btn btn-quiet btn-sm"
                        disabled={chapter.idx <= 1}
                        onClick={() => void goPrev()}
                      >
                        <ChevronLeft size={14} strokeWidth={iconStroke} />
                        上一章
                      </button>
                      <span className="hint">第 {chapter.idx} 章</span>
                      <button
                        className="btn btn-quiet btn-sm"
                        disabled={chapter.idx >= SETTINGS_LIMITS.chaptersMax}
                        onClick={() => void goNext()}
                      >
                        下一章
                        <ChevronRight size={14} strokeWidth={iconStroke} />
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </article>
        </div>

        <SidePanel />
      </div>

      <div className="reader-mobilebar" data-hidden={barHidden ? 'true' : 'false'}>
        <button
          className="mobilebar-btn"
          aria-label="目录"
          onClick={() => setTocOpen(true)}
        >
          <List size={18} strokeWidth={iconStroke} />
          <span>目录</span>
        </button>
        <button
          className="mobilebar-btn"
          aria-label="上一章"
          disabled={!chapter || chapter.idx <= 1}
          onClick={() => void goPrev()}
        >
          <ChevronLeft size={18} strokeWidth={iconStroke} />
          <span>上一章</span>
        </button>
        <button
          className="mobilebar-count"
          aria-label="打开目录"
          onClick={() => setTocOpen(true)}
        >
          {currentIdx} / {total}
        </button>
        <button
          className="mobilebar-btn"
          aria-label="下一章"
          disabled={!chapter || chapter.idx >= SETTINGS_LIMITS.chaptersMax}
          onClick={() => void goNext()}
        >
          <ChevronRight size={18} strokeWidth={iconStroke} />
          <span>下一章</span>
        </button>
        <button
          className="mobilebar-btn"
          aria-label="写作面板"
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen(true)}
        >
          <PanelRight size={18} strokeWidth={iconStroke} />
          <span>面板</span>
        </button>
      </div>

      <div className="bottom-progress">
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <div
        className="progress-label"
        data-visible={progressVisible ? 'true' : 'false'}
        style={{
          right: panelOpen ? 'calc(var(--layout-panel) + 16px)' : 16
        }}
      >
        {currentIdx} / {total} 章
      </div>

      {selection && chapter && !active ? (
        <SelectionToolbar
          selection={selection}
          chapter={chapter}
          projectId={reader.project.id}
          onClose={clearSelection}
        />
      ) : null}

      {diff ? <DiffOverlay preview={diff} /> : null}
      {settingsOpen ? <SettingsDialog /> : null}
    </div>
  )
}
