import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bookmark as BookmarkIcon,
  ChevronLeft,
  ChevronRight,
  Info,
  List,
  Maximize2,
  MoreHorizontal,
  PanelRight,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Type
} from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { SETTINGS_LIMITS } from '@shared/constants'
import { countWords } from '@shared/text'
import type { SearchHit } from '@shared/types'
import { useApp } from '../store'
import { errorText, stripChapterPrefix, unwrap } from '../lib'
import { ProseView, type TextSelection } from './ProseView'
import { TocDrawer } from './TocDrawer'
import { SidePanel } from './SidePanel'
import { SelectionToolbar } from './SelectionToolbar'
import { DiffOverlay } from './DiffOverlay'
import { SettingsDialog } from './SettingsDialog'
import {
  BookInfoDialog,
  BookmarksDialog,
  ReadingSettingsDialog,
  ReadingStatsDialog,
  SearchDialog
} from './ReaderTools'

export function Reader(): React.JSX.Element {
  const reader = useApp((state) => state.reader)
  const chapter = useApp((state) => state.chapter)
  const settings = useApp((state) => state.settings)
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
  const openPlot = useApp((state) => state.openPlot)
  const showToast = useApp((state) => state.showToast)

  const [barHidden, setBarHidden] = useState(true)
  const [progressVisible, setProgressVisible] = useState(false)
  const [selection, setSelection] = useState<TextSelection | null>(null)
  const [scrollRatio, setScrollRatio] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [readingSettingsOpen, setReadingSettingsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastTop = useRef(0)
  const hideTimer = useRef<number | undefined>(undefined)
  const saveAt = useRef(0)
  const ratioRef = useRef(0)
  const statsRef = useRef({ ratio: 0, chapterIdx: 0, at: Date.now() })
  const activeAt = useRef(Date.now())
  const pendingLocate = useRef<{ chapterIdx: number; offset: number } | null>(null)
  const locateTimer = useRef<number | undefined>(undefined)
  const pendingRatio = useRef<{ chapterIdx: number; ratio: number } | null>(null)
  const touchRef = useRef<{ x: number; y: number; at: number } | null>(null)
  // The stats ticker must not restart every time a chapter object is replaced
  // (cursor saves emit project:changed, streaming emits chapter:content).
  // Read the live values through a ref so the interval can outlive them.
  const statsInfo = useRef({ idx: 0, wordCount: 0, enabled: false, projectId: '' })
  statsInfo.current = {
    idx: chapter?.idx ?? 0,
    wordCount: chapter?.wordCount ?? 0,
    enabled: Boolean(reader && chapter && chapter.status !== 'generating'),
    projectId: reader?.project.id ?? ''
  }

  const chapterId = chapter?.id
  const generating = chapter?.status === 'generating'
  const active = chapter?.status === 'generating' || chapter?.status === 'queued'
  const paged = settings.pageMode === 'paged'
  const vertical = settings.vertical && !paged
  const horizontal = paged || vertical

  useEffect(() => {
    activeAt.current = Date.now()
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = 0
    element.scrollLeft = 0
    lastTop.current = 0
    setBarHidden(true)
    setSelection(null)
    window.getSelection()?.removeAllRanges()

    const pending = pendingLocate.current
    const pendingBookmark = pendingRatio.current
    const cross = useApp.getState().crossLocate
    const crossMatches = Boolean(
      cross &&
        reader &&
        cross.projectId === reader.project.id &&
        chapter &&
        cross.chapterIdx === chapter.idx
    )
    if (crossMatches) useApp.getState().setCrossLocate(null)
    const matches = Boolean(pending && chapter && pending.chapterIdx === chapter.idx) || crossMatches
    const bookmarkMatches = Boolean(
      pendingBookmark && chapter && pendingBookmark.chapterIdx === chapter.idx
    )
    if (matches) pendingLocate.current = null
    if (bookmarkMatches) pendingRatio.current = null
    const target = matches
      ? (crossMatches ? cross!.offset : pending!.offset) / Math.max(1, chapter?.content.length ?? 1)
      : bookmarkMatches
        ? pendingBookmark!.ratio
        : chapter?.lastOffsetRatio ?? 0
    const safe = Math.min(1, Math.max(0, target))
    ratioRef.current = safe
    statsRef.current = { ratio: safe, chapterIdx: chapter?.idx ?? 0, at: Date.now() }
    setScrollRatio(safe)
    if (safe <= 0.002) return
    const timer = window.setTimeout(() => {
      const node = scrollRef.current
      if (!node) return
      if (horizontal) {
        const span = Math.max(0, node.scrollWidth - node.clientWidth)
        node.scrollLeft = vertical ? -safe * span : safe * span
      } else {
        node.scrollTop = safe * Math.max(0, node.scrollHeight - node.clientHeight)
      }
      lastTop.current = horizontal
        ? Math.abs(node.scrollLeft)
        : node.scrollTop
    }, 140)
    return () => window.clearTimeout(timer)
    // Deliberately keyed on the chapter identity and layout mode only. Content
    // grows while a chapter streams; re-running this on every growth spurt
    // snapped the reader back to the top and hid the toolbar right after a tap.
  }, [chapterId, settings.pageMode, horizontal, vertical])

  useEffect(() => {
    if (!horizontal) return
    const element = scrollRef.current
    if (element) {
      const span = Math.max(0, element.scrollWidth - element.clientWidth)
      element.scrollTop = 0
      element.scrollLeft = vertical ? -ratioRef.current * span : ratioRef.current * span
    }
  }, [horizontal, vertical])

  useEffect(() => {
    // Typography changes reflow the text but leave the pixel scroll offset
    // untouched, which lands the reader on a different passage. Re-apply the
    // remembered ratio after the new layout has been measured.
    const node = scrollRef.current
    if (!node) return
    const apply = (): void => {
      if (horizontal) {
        const span = Math.max(0, node.scrollWidth - node.clientWidth)
        node.scrollLeft = vertical ? -ratioRef.current * span : ratioRef.current * span
      } else {
        node.scrollTop = ratioRef.current * Math.max(0, node.scrollHeight - node.clientHeight)
      }
      lastTop.current = horizontal ? Math.abs(node.scrollLeft) : node.scrollTop
    }
    const raf = window.requestAnimationFrame(apply)
    return () => window.cancelAnimationFrame(raf)
  }, [
    settings.readerFont,
    settings.fontSize,
    settings.lineHeight,
    settings.letterSpacing,
    settings.paragraphGap,
    settings.pageWidth,
    settings.justify,
    settings.convert,
    horizontal,
    vertical
  ])

  useEffect(() => {
    return () => {
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(locateTimer.current)
    }
  }, [])

  useEffect(() => {
    const locate = (event: Event): void => {
      const detail = (event as CustomEvent).detail as
        | { chapterIdx?: number; offset?: number }
        | undefined
      if (!detail || typeof detail.chapterIdx !== 'number' || typeof detail.offset !== 'number') return
      pendingLocate.current = { chapterIdx: detail.chapterIdx, offset: detail.offset }
      // A locate target that never gets consumed (the chapter failed to load)
      // must not linger and hijack a much later visit to the same chapter.
      window.clearTimeout(locateTimer.current)
      locateTimer.current = window.setTimeout(() => {
        pendingLocate.current = null
      }, 6000)
      const state = useApp.getState()
      if (state.chapter && state.chapter.idx === detail.chapterIdx) {
        void state.loadChapter(detail.chapterIdx)
      }
    }
    window.addEventListener('shiye:locate', locate)
    return () => window.removeEventListener('shiye:locate', locate)
  }, [])

  useEffect(() => {
    if (!statsInfo.current.enabled) return
    const timer = window.setInterval(() => {
      const info = statsInfo.current
      if (!info.enabled || !info.projectId) return
      if (document.visibilityState !== 'visible') return
      // Do not count time while the window is open but untouched.
      if (Date.now() - activeAt.current > 180_000) return
      const ratio = ratioRef.current
      const delta = Math.max(0, ratio - statsRef.current.ratio)
      const words =
        statsRef.current.chapterIdx === info.idx ? Math.round(delta * info.wordCount) : 0
      statsRef.current = { ratio, chapterIdx: info.idx, at: Date.now() }
      void window.shiye.recordReading({
        projectId: info.projectId,
        seconds: 25,
        words: Math.max(0, words)
      })
    }, 25_000)
    return () => window.clearInterval(timer)
  }, [reader?.project.id, chapter?.status])

  useEffect(() => {
    if (!immersive) return
    const exit = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setImmersive(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [immersive])

  useEffect(() => {
    if (!generating) return
    const element = scrollRef.current
    if (!element) return
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 280
    if (nearBottom) element.scrollTop = element.scrollHeight
  }, [liveText, generating])

  useEffect(() => {
    if (!horizontal) return
    const element = scrollRef.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      element.scrollLeft += vertical ? -event.deltaY : event.deltaY
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [horizontal, vertical, chapterId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      if (
        tocOpen ||
        panelOpen ||
        diff ||
        settingsOpen ||
        searchOpen ||
        infoOpen ||
        bookmarksOpen ||
        statsOpen ||
        readingSettingsOpen ||
        menuOpen
      ) {
        return
      }
      if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft' ||
        event.key === 'PageDown' ||
        event.key === 'PageUp'
      ) {
        activeAt.current = Date.now()
      }
      const pageKey = event.key === 'PageDown' || event.key === 'PageUp'
      const scrollNode = scrollRef.current
      if (pageKey && !horizontal && scrollNode) {
        // In scroll mode a page key should move one screen of text, not jump
        // to the next chapter.
        event.preventDefault()
        const delta = scrollNode.clientHeight * 0.9 * (event.key === 'PageDown' ? 1 : -1)
        scrollNode.scrollBy({ top: delta, behavior: 'smooth' })
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        void turnPage(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        void turnPage(-1)
      } else if (event.key === 'Escape' && immersive) {
        setImmersive(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    paged,
    horizontal,
    vertical,
    tocOpen,
    panelOpen,
    diff,
    settingsOpen,
    searchOpen,
    infoOpen,
    bookmarksOpen,
    statsOpen,
    readingSettingsOpen,
    menuOpen,
    immersive
  ])

  // Hooks must run before the early return below; computing this after
  // `if (!reader)` made the hook count change when the book finished opening.
  const currentIdx = chapter?.idx ?? 1
  const progress = useMemo(() => {
    let read = 0
    let all = 0
    for (const item of reader?.chapters ?? []) {
      all += item.wordCount
      if (item.idx < currentIdx) read += item.wordCount
      else if (item.idx === currentIdx) read += item.wordCount * scrollRatio
    }
    const percent = all > 0 ? Math.min(100, (read / all) * 100) : 0
    // 400 characters a minute is a calm Chinese reading pace.
    const minutes = Math.max(0, Math.round((all - read) / 400))
    return { percent, minutes }
  }, [reader?.chapters, currentIdx, scrollRatio])

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
  const content = chapter ? liveText || chapter.content : ''
  const hasText = content.trim().length > 0
  const title = chapter ? stripChapterPrefix(chapter.title, chapter.idx) : ''
  const generic = chapter ? title === `第 ${chapter.idx} 章` : true
  const imported = reader.project.source === 'imported'
  const lastIdx = reader.chapters[reader.chapters.length - 1]?.idx ?? currentIdx
  const atLast = chapter ? chapter.idx >= lastIdx : true
  const nextLimit = imported ? Math.max(currentIdx, lastIdx) : SETTINGS_LIMITS.chaptersMax
  const canContinue = Boolean(chapter && hasText && !active)

  const handleScroll = (): void => {
    activeAt.current = Date.now()
    const element = scrollRef.current
    if (!element) return
    const top = horizontal
      ? vertical
        ? Math.abs(element.scrollLeft)
        : element.scrollLeft
      : element.scrollTop
    const delta = top - lastTop.current
    if (top < 48) setBarHidden(false)
    else if (delta > 8) setBarHidden(true)
    else if (delta < -8) setBarHidden(false)
    lastTop.current = top

    setProgressVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setProgressVisible(false), 3000)

    const span = horizontal
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight
    if (span <= 4) {
      ratioRef.current = 0
      setScrollRatio(0)
      return
    }
    const position = Math.min(1, Math.max(0, top / span))
    ratioRef.current = position
    setScrollRatio(position)

    const now = Date.now()
    if (chapter && now - saveAt.current > 900) {
      saveAt.current = now
      updateCursor(chapter.idx, position)
    }
  }

  const setPosition = (ratio: number): void => {
    const element = scrollRef.current
    if (!element) return
    const safe = Math.min(1, Math.max(0, ratio))
    if (horizontal) {
      const span = Math.max(0, element.scrollWidth - element.clientWidth)
      element.scrollLeft = vertical ? -safe * span : safe * span
    } else {
      element.scrollTop = safe * Math.max(0, element.scrollHeight - element.clientHeight)
    }
    ratioRef.current = safe
    setScrollRatio(safe)
  }

  const turnPage = async (direction: 1 | -1): Promise<void> => {
    const element = scrollRef.current
    if (!element) return
    if (!horizontal) {
      await (direction > 0 ? goNext() : goPrev())
      return
    }
    // Turn by one column pitch, not by the visible width: the paged article is
    // a fixed-measure column that is narrower than the scroller, so using the
    // viewport width landed mid-column and skipped the start of the next one.
    const article = paged ? element.querySelector('.reader-article') : null
    let step = Math.max(120, element.clientWidth - 48)
    if (article) {
      const style = window.getComputedStyle(article)
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
      const gap = Number.parseFloat(style.columnGap) || 0
      const width = article.clientWidth - padding
      if (width > 0) step = Math.max(120, width + gap)
    }
    const span = element.scrollWidth - element.clientWidth
    const position = vertical ? -element.scrollLeft : element.scrollLeft
    const atEnd = position >= span - 8
    const atStart = position <= 8
    if (direction > 0 && atEnd) await goNext()
    else if (direction < 0 && atStart) await goPrev()
    else {
      element.scrollBy({
        left: direction * step * (vertical ? -1 : 1),
        behavior: 'smooth'
      })
    }
  }

  const locateInChapter = (hit: SearchHit): void => {
    const current = chapter
    if (!current) return
    const ratio = Math.min(1, Math.max(0, hit.matchOffset / Math.max(1, current.content.length)))
    if (current.idx !== hit.chapterIdx) {
      pendingLocate.current = { chapterIdx: hit.chapterIdx, offset: hit.matchOffset }
      void loadChapter(hit.chapterIdx)
      return
    }
    setPosition(ratio)
  }

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>): void => {
    const touch = event.touches[0]
    if (!touch) return
    activeAt.current = Date.now()
    touchRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() }
  }

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>): void => {
    const start = touchRef.current
    touchRef.current = null
    if (!start || active) return
    const selected = window.getSelection()
    if (selected && !selected.isCollapsed && selected.toString().trim()) return
    const touch = event.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return
    event.preventDefault()
    if (dx < 0) void turnPage(1)
    else void turnPage(-1)
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
      data-immersive={immersive ? 'true' : 'false'}
      data-reading-mode={paged ? 'paged' : 'scroll'}
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
            {chapter ? `第 ${chapter.idx} 章 · ${Math.round(scrollRatio * 100)}%` : '正在取回'}
          </span>
        </div>
        <div className="topbar-spacer" />
        <button
          className="icon-btn"
          title="全文搜索"
          aria-label="全文搜索"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={17} strokeWidth={iconStroke} />
        </button>
        <button
          className="icon-btn"
          title="书签"
          aria-label="书签"
          onClick={() => setBookmarksOpen(true)}
        >
          <BookmarkIcon size={17} strokeWidth={iconStroke} />
        </button>
        <button
          className="icon-btn"
          title="阅读设置"
          aria-label="阅读设置"
          onClick={() => setReadingSettingsOpen(true)}
        >
          <Type size={17} strokeWidth={iconStroke} />
        </button>
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
          title="更多"
          aria-label="更多"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={17} strokeWidth={iconStroke} />
        </button>
        {menuOpen ? (
          <div className="topbar-menu" onPointerDown={(event) => event.stopPropagation()}>
            <button
              onClick={() => {
                setMenuOpen(false)
                setStatsOpen(true)
              }}
            >
              <BarChart3 size={14} strokeWidth={iconStroke} />
              阅读统计
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                setInfoOpen(true)
              }}
            >
              <Info size={14} strokeWidth={iconStroke} />
              书目信息
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                setImmersive(true)
                setBarHidden(true)
              }}
            >
              <Maximize2 size={14} strokeWidth={iconStroke} />
              沉浸阅读
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                setSettingsOpen(true)
              }}
            >
              <Settings2 size={14} strokeWidth={iconStroke} />
              应用设置
            </button>
          </div>
        ) : null}
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
          data-mode={paged ? 'paged' : vertical ? 'vertical' : 'scroll'}
          onScroll={handleScroll}
          onClick={toggleChrome}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
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
                  content={generating ? content : chapter.content}
                  streaming={generating}
                  html={chapter.html}
                  convert={settings.convert}
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
                    {canContinue && !(imported && atLast) ? (
                      <div className="chapter-plot-entry">
                        <button
                          className="link-btn"
                          onClick={() =>
                            openPlot({
                              chapterIdx: chapter.idx,
                              startMode: 'after',
                              offset: null,
                              excerpt: ''
                            })
                          }
                        >
                          从这里改后续
                        </button>
                        <span className="hint">
                          保留本章，按你的方向重写后面 3 章
                        </span>
                      </div>
                    ) : null}
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
                        disabled={chapter.idx >= nextLimit}
                        onClick={() => void goNext()}
                      >
                        下一章
                        <ChevronRight size={14} strokeWidth={iconStroke} />
                      </button>
                    </div>
                    {imported && atLast ? (
                      <div className="chapter-book-end">
                        <p>故事到这里。</p>
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            openPlot({
                              chapterIdx: chapter.idx,
                              startMode: 'after',
                              offset: null,
                              excerpt: ''
                            })
                          }
                        >
                          从这里接着写 3 章
                        </button>
                        <span className="hint">
                          沿用原文的人称与语气，只往下多写这一小段。
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </article>
        </div>

        {horizontal && hasText ? (
          <>
            <button
              className="page-turn-btn"
              data-dir="prev"
              aria-label="上一页"
              onClick={() => void turnPage(-1)}
            >
              <ChevronLeft size={20} strokeWidth={iconStroke} />
            </button>
            <button
              className="page-turn-btn"
              data-dir="next"
              aria-label="下一页"
              onClick={() => void turnPage(1)}
            >
              <ChevronRight size={20} strokeWidth={iconStroke} />
            </button>
          </>
        ) : null}

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
          disabled={!chapter || chapter.idx >= nextLimit}
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
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <div
        className="progress-label"
        data-visible={progressVisible ? 'true' : 'false'}
        style={{
          right: panelOpen ? 'calc(var(--layout-panel) + 16px)' : 16
        }}
      >
        第 {currentIdx}/{total} 章 · 本章 {Math.round(scrollRatio * 100)}% · 全书{' '}
        {Math.round(progress.percent)}%
        {progress.minutes > 0 ? ` · 约剩 ${progress.minutes} 分钟` : ''}
      </div>
      {immersive ? (
        <button
          className="immersive-exit"
          title="退出沉浸模式"
          aria-label="退出沉浸模式"
          onClick={() => setImmersive(false)}
        >
          <Maximize2 size={16} strokeWidth={iconStroke} />
        </button>
      ) : null}
      {menuOpen ? (
        <div className="menu-scrim" onPointerDown={() => setMenuOpen(false)} />
      ) : null}

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
      {searchOpen ? (
        <SearchDialog
          projectId={reader.project.id}
          onClose={() => setSearchOpen(false)}
          onLocate={locateInChapter}
        />
      ) : null}
      {bookmarksOpen ? (
        <BookmarksDialog
          projectId={reader.project.id}
          chapter={chapter}
          ratio={scrollRatio}
          onClose={() => setBookmarksOpen(false)}
          onPick={(chapterIdx, targetRatio) => {
            if (chapter && chapter.idx === chapterIdx) {
              setPosition(targetRatio)
            } else {
              pendingRatio.current = { chapterIdx, ratio: targetRatio }
              void loadChapter(chapterIdx)
            }
          }}
        />
      ) : null}
      {statsOpen ? (
        <ReadingStatsDialog
          projectId={reader.project.id}
          onClose={() => setStatsOpen(false)}
        />
      ) : null}
      {readingSettingsOpen ? (
        <ReadingSettingsDialog onClose={() => setReadingSettingsOpen(false)} />
      ) : null}
      {infoOpen ? (
        <BookInfoDialog
          projectId={reader.project.id}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
    </div>
  )
}
