import { useEffect, useMemo, useState } from 'react'
import { Bookmark as BookmarkIcon, ImagePlus, Search, Star, Trash2 } from 'lucide-react'
import { SETTINGS_LIMITS } from '@shared/constants'
import { iconStroke, themeOrder, themes } from '@shared/tokens'
import type { ReaderFont } from '@shared/tokens'
import type {
  AppSettings,
  Bookmark,
  Chapter,
  ExportFormat,
  Project,
  ReadingStats,
  SearchHit
} from '@shared/types'
import { useApp } from '../store'
import { applyAppearance, errorText, formatTime, formatWords, unwrap } from '../lib'
import { BusyLine, Dialog, Field } from './ui'

const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'txt', label: 'TXT 纯文本' },
  { value: 'md', label: 'Markdown' },
  { value: 'epub', label: 'EPUB 电子书' },
  { value: 'docx', label: 'Word 文档' },
  { value: 'pdf', label: 'PDF（桌面端）' }
]

/* ------------------------------------------------------------------ */
/* Full-text search                                                    */
/* ------------------------------------------------------------------ */

export function SearchDialog({
  projectId,
  onClose,
  onLocate
}: {
  projectId: string
  onClose: () => void
  onLocate: (hit: SearchHit) => void
}): React.JSX.Element {
  const openBook = useApp((state) => state.openBook)
  const showToast = useApp((state) => state.showToast)
  const [scope, setScope] = useState<'book' | 'library'>('book')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      // The cleanup below flips `alive` off, so an in-flight search can no
      // longer clear the spinner. Clear it here or it stays on forever.
      setBusy(false)
      setHits([])
      setSearched(false)
      return
    }
    let alive = true
    setBusy(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await unwrap(
            window.shiye.search({
              projectId: scope === 'book' ? projectId : null,
              query: trimmed,
              limit: 80
            })
          )
          if (!alive) return
          setHits(result.hits)
          setTruncated(result.truncated)
          setSearched(true)
        } catch (error) {
          if (alive) showToast('error', errorText(error))
        } finally {
          if (alive) setBusy(false)
        }
      })()
    }, 260)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, scope, projectId, showToast])

  const pick = async (hit: SearchHit): Promise<void> => {
    onClose()
    if (hit.projectId !== projectId) {
      // Record the target before opening so the reader picks it up while mounting;
      // a timed event could fire before the new chapter has rendered.
      useApp.getState().setCrossLocate({
        projectId: hit.projectId,
        chapterIdx: hit.chapterIdx,
        offset: hit.matchOffset
      })
      await openBook(hit.projectId, hit.chapterIdx)
      return
    }
    onLocate(hit)
  }

  return (
    <Dialog title="全文搜索" wide onClose={onClose}>
      <div className="search-head">
        <div className="seg">
          <button aria-pressed={scope === 'book'} onClick={() => setScope('book')}>
            本书
          </button>
          <button aria-pressed={scope === 'library'} onClick={() => setScope('library')}>
            全部书架
          </button>
        </div>
        <div className="search-input">
          <Search size={15} strokeWidth={iconStroke} />
          <input
            className="input"
            autoFocus
            maxLength={120}
            value={query}
            placeholder="搜人名、句子、意象……"
            onChange={(event) => setQuery(event.target.value)}
          />
          {busy ? <BusyLine text="搜索中" /> : null}
        </div>
      </div>

      <div className="search-results">
        {!query.trim() ? (
          <p className="hint">输入关键词，按回车或稍等片刻。搜索只在本机数据库里进行。</p>
        ) : searched && hits.length === 0 ? (
          <p className="hint">没有找到。试试更短的关键词。</p>
        ) : (
          hits.map((hit) => (
            <button
              className="search-hit"
              key={`${hit.chapterId}-${hit.matchOffset}`}
              onClick={() => void pick(hit)}
            >
              <div className="search-hit-head">
                <span className="search-hit-title">
                  第 {hit.chapterIdx} 章 · {hit.chapterTitle}
                </span>
                {hit.projectId !== projectId ? (
                  <span className="badge">{hit.projectTitle}</span>
                ) : null}
              </div>
              <Snippet text={hit.snippet} query={query.trim()} />
            </button>
          ))
        )}
        {truncated ? <p className="hint">结果太多，只显示前 80 条。</p> : null}
      </div>
    </Dialog>
  )
}

function Snippet({ text, query }: { text: string; query: string }): React.JSX.Element {
  const parts = useMemo(() => {
    if (!query) return [{ text, hit: false }]
    const lower = text.toLowerCase()
    const needle = query.toLowerCase()
    const out: Array<{ text: string; hit: boolean }> = []
    let cursor = 0
    while (cursor < text.length) {
      const found = lower.indexOf(needle, cursor)
      if (found < 0) break
      if (found > cursor) out.push({ text: text.slice(cursor, found), hit: false })
      out.push({ text: text.slice(found, found + query.length), hit: true })
      cursor = found + query.length
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false })
    return out.length > 0 ? out : [{ text, hit: false }]
  }, [text, query])
  return (
    <p className="search-snippet">
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
      )}
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* Bookmarks                                                           */
/* ------------------------------------------------------------------ */

export function BookmarksDialog({
  projectId,
  chapter,
  ratio,
  onClose,
  onPick
}: {
  projectId: string
  chapter: Chapter | null
  ratio: number
  onClose: () => void
  onPick: (chapterIdx: number, ratio: number) => void
}): React.JSX.Element {
  const showToast = useApp((state) => state.showToast)
  const [items, setItems] = useState<Bookmark[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    try {
      setItems(await unwrap(window.shiye.listBookmarks(projectId)))
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const add = async (): Promise<void> => {
    if (!chapter) return
    setBusy(true)
    try {
      // Slice around the bookmarked page, not the chapter opening: with only a
      // ratio stored, every bookmark in a long chapter looked identical.
      const body = chapter.content
      const anchor = Math.round(Math.min(1, Math.max(0, ratio)) * body.length)
      const start = Math.max(0, Math.min(body.length, anchor - 50))
      const excerpt = body.slice(start, start + 160) || body.slice(0, 160)
      await unwrap(
        window.shiye.addBookmark({
          projectId,
          chapterId: chapter.id,
          chapterIdx: chapter.idx,
          ratio,
          label: chapter.title,
          excerpt
        })
      )
      await load()
      showToast('info', '书签已经夹在这一页。')
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (bookmarkId: string): Promise<void> => {
    try {
      await unwrap(window.shiye.removeBookmark(bookmarkId))
      setItems((list) => list.filter((item) => item.id !== bookmarkId))
    } catch (error) {
      showToast('error', errorText(error))
    }
  }

  return (
    <Dialog
      title="书签"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!chapter || busy} onClick={() => void add()}>
          {busy ? <BusyLine text="正在夹" /> : '夹在当前页'}
        </button>
      }
    >
      {loading ? <BusyLine text="正在取书签" /> : null}
      {!loading && items.length === 0 ? (
        <p className="hint">还没有书签。读到一半时夹一枚，下次回来就能找到。</p>
      ) : null}
      <div className="bookmark-list">
        {items.map((item) => (
          <div className="bookmark-item" key={item.id}>
            <button
              className="bookmark-main"
              onClick={() => {
                onClose()
                onPick(item.chapterIdx, item.ratio)
              }}
            >
              <span className="bookmark-title">
                <BookmarkIcon size={13} strokeWidth={iconStroke} />
                第 {item.chapterIdx} 章
              </span>
              <span className="bookmark-excerpt">{item.excerpt || item.label}</span>
              <span className="hint">
                {Math.round(item.ratio * 100)}% · {formatTime(item.createdAt)}
              </span>
            </button>
            <button
              className="icon-btn"
              title="删除书签"
              aria-label="删除书签"
              onClick={() => void remove(item.id)}
            >
              <Trash2 size={14} strokeWidth={iconStroke} />
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Reading statistics                                                  */
/* ------------------------------------------------------------------ */

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

export function ReadingStatsDialog({
  projectId,
  onClose
}: {
  projectId: string | null
  onClose: () => void
}): React.JSX.Element {
  const showToast = useApp((state) => state.showToast)
  const [stats, setStats] = useState<ReadingStats | null>(null)
  const [scope, setScope] = useState<'book' | 'all'>(projectId ? 'book' : 'all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const result = await unwrap(
          window.shiye.readingStats(scope === 'book' ? projectId : null)
        )
        if (alive) setStats(result)
      } catch (error) {
        if (alive) showToast('error', errorText(error))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [scope, projectId, showToast])

  const max = Math.max(1, ...(stats?.days.map((day) => day.seconds) ?? [1]))

  return (
    <Dialog title="阅读统计" onClose={onClose}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={scope === 'book'} disabled={!projectId} onClick={() => setScope('book')}>
          这本书
        </button>
        <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
          全部
        </button>
      </div>
      {loading ? <BusyLine text="正在算" /> : null}
      {stats ? (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-value">{duration(stats.todaySeconds)}</span>
              <span className="hint">今天</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{duration(stats.totalSeconds)}</span>
              <span className="hint">累计</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats.streakDays} 天</span>
              <span className="hint">连续阅读</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{formatWords(stats.totalWords)}</span>
              <span className="hint">读过字数</span>
            </div>
          </div>
          <div className="stat-chart">
            {stats.days.map((day) => (
              <div className="stat-bar" key={day.day} title={`${day.day} · ${duration(day.seconds)}`}>
                <span style={{ height: `${Math.max(2, (day.seconds / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <p className="hint">最近 30 天，每根柱子是一天。</p>
          {scope === 'all' && stats.bookSeconds.length > 0 ? (
            <div className="panel-section" style={{ marginTop: 4 }}>
              <h3 className="panel-title">读得最多的书</h3>
              {stats.bookSeconds.slice(0, 5).map((book) => (
                <div className="stat-book" key={book.projectId}>
                  <span>{book.title}</span>
                  <span>{duration(book.seconds)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Quick reading settings                                              */
/* ------------------------------------------------------------------ */

const FONTS: Array<{ value: ReaderFont; label: string }> = [
  { value: 'serif', label: '宋体' },
  { value: 'sans', label: '黑体' },
  { value: 'kai', label: '楷体' },
  { value: 'ui', label: '系统' }
]

export function ReadingSettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useApp((state) => state.settings)
  const saveSettings = useApp((state) => state.saveSettings)
  const [draft, setDraft] = useState<AppSettings>({ ...settings })
  const [saving, setSaving] = useState(false)

  const patch = (next: Partial<AppSettings>): void => {
    setDraft((current) => {
      const merged = { ...current, ...next }
      applyAppearance(merged)
      return merged
    })
  }

  const close = (): void => {
    applyAppearance(settings)
    onClose()
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const saved = await saveSettings({
      theme: draft.theme,
      fontSize: draft.fontSize,
      readerFont: draft.readerFont,
      indent: draft.indent,
      pageMode: draft.pageMode,
      lineHeight: draft.lineHeight,
      letterSpacing: draft.letterSpacing,
      paragraphGap: draft.paragraphGap,
      pageWidth: draft.pageWidth,
      justify: draft.justify,
      brightness: draft.brightness,
      vertical: draft.vertical,
      convert: draft.convert
    })
    setSaving(false)
    // saveSettings reverts and toasts on failure; keep the dialog open so the
    // reader can see what happened instead of closing as if it succeeded.
    if (saved) onClose()
    else applyAppearance(draft)
  }

  return (
    <Dialog
      title="阅读设置"
      wide
      onClose={close}
      footer={
        <>
          <button className="btn btn-quiet" onClick={close}>
            取消
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? <BusyLine text="正在保存" /> : '保存'}
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <Field label="主题">
          <div className="theme-row">
            {themeOrder.map((name) => (
              <button
                key={name}
                className="theme-swatch"
                data-theme-swatch={name}
                aria-pressed={draft.theme === name}
                title={themes[name].label}
                onClick={() => patch({ theme: name })}
              >
                <span style={{ background: themes[name].colors.bg, color: themes[name].colors.text }}>
                  Aa
                </span>
                <small>{themes[name].label}</small>
              </button>
            ))}
          </div>
        </Field>

        <Field label="字体">
          <div className="seg">
            {FONTS.map((font) => (
              <button
                key={font.value}
                aria-pressed={draft.readerFont === font.value}
                onClick={() => patch({ readerFont: font.value })}
              >
                {font.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={`字号 · ${draft.fontSize}px`}>
          <input
            type="range"
            min={SETTINGS_LIMITS.fontSizeMin}
            max={SETTINGS_LIMITS.fontSizeMax}
            step={1}
            value={draft.fontSize}
            onChange={(event) => patch({ fontSize: Number(event.target.value) })}
          />
        </Field>

        <Field label={`行高 · ${draft.lineHeight.toFixed(2)}`}>
          <input
            type="range"
            min={1.4}
            max={2.6}
            step={0.05}
            value={draft.lineHeight}
            onChange={(event) => patch({ lineHeight: Number(event.target.value) })}
          />
        </Field>

        <Field label={`字距 · ${draft.letterSpacing.toFixed(2)}em`}>
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.01}
            value={draft.letterSpacing}
            onChange={(event) => patch({ letterSpacing: Number(event.target.value) })}
          />
        </Field>

        <Field label={`段距 · ${draft.paragraphGap.toFixed(2)}em`}>
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.05}
            value={draft.paragraphGap}
            onChange={(event) => patch({ paragraphGap: Number(event.target.value) })}
          />
        </Field>

        <Field label={`版心 · ${draft.pageWidth}px`}>
          <input
            type="range"
            min={520}
            max={980}
            step={20}
            value={draft.pageWidth}
            onChange={(event) => patch({ pageWidth: Number(event.target.value) })}
          />
        </Field>

        <Field label={`亮度 · ${Math.round(draft.brightness * 100)}%`}>
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={draft.brightness}
            onChange={(event) => patch({ brightness: Number(event.target.value) })}
          />
        </Field>

        <Field label="翻页">
          <div className="seg">
            <button
              aria-pressed={draft.pageMode === 'scroll'}
              onClick={() => patch({ pageMode: 'scroll' })}
            >
              滚动
            </button>
            <button
              aria-pressed={draft.pageMode === 'paged'}
              onClick={() => patch({ pageMode: 'paged' })}
            >
              翻页
            </button>
          </div>
        </Field>

        <Field label="排版">
          <div className="seg">
            <button aria-pressed={!draft.justify} onClick={() => patch({ justify: false })}>
              自然对齐
            </button>
            <button aria-pressed={draft.justify} onClick={() => patch({ justify: true })}>
              两端对齐
            </button>
          </div>
        </Field>

        <Field label="文字方向">
          <div className="seg">
            <button aria-pressed={!draft.vertical} onClick={() => patch({ vertical: false })}>
              横排
            </button>
            <button aria-pressed={draft.vertical} onClick={() => patch({ vertical: true })}>
              竖排
            </button>
          </div>
        </Field>

        <Field label="简繁转换" hint="只改变显示，不改动原文。">
          <div className="seg">
            <button
              aria-pressed={draft.convert === 'none'}
              onClick={() => patch({ convert: 'none' })}
            >
              原文
            </button>
            <button
              aria-pressed={draft.convert === 's2t'}
              onClick={() => patch({ convert: 's2t' })}
            >
              简转繁
            </button>
            <button
              aria-pressed={draft.convert === 't2s'}
              onClick={() => patch({ convert: 't2s' })}
            >
              繁转简
            </button>
          </div>
        </Field>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Book information and metadata                                       */
/* ------------------------------------------------------------------ */

export function BookInfoDialog({
  projectId,
  onClose
}: {
  projectId: string
  onClose: () => void
}): React.JSX.Element {
  const reader = useApp((state) => state.reader)
  const showToast = useApp((state) => state.showToast)
  const refreshProjects = useApp((state) => state.refreshProjects)
  const [project, setProject] = useState<Project | null>(
    reader && reader.project.id === projectId ? reader.project : null
  )
  const [draft, setDraft] = useState({
    title: project?.title ?? '',
    author: project?.author ?? '',
    series: project?.series ?? '',
    publisher: project?.publisher ?? '',
    language: project?.language ?? '',
    description: project?.description ?? '',
    tags: (project?.tags ?? []).join('、'),
    rating: project?.rating ?? 0,
    readStatus: project?.readStatus ?? 'none',
    coverData: project?.coverData ?? ''
  })
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (project) return
    let alive = true
    void (async () => {
      try {
        const data = await unwrap(window.shiye.readProject(projectId))
        if (!alive) return
        setProject(data.project)
        setDraft({
          title: data.project.title,
          author: data.project.author,
          series: data.project.series,
          publisher: data.project.publisher,
          language: data.project.language,
          description: data.project.description,
          tags: data.project.tags.join('、'),
          rating: data.project.rating,
          readStatus: data.project.readStatus,
          coverData: data.project.coverData
        })
      } catch (cause) {
        if (alive) setError(errorText(cause))
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, project])

  const pickCover = async (file: File): Promise<void> => {
    try {
      const data = await resizeImage(file)
      setDraft((current) => ({ ...current, coverData: data }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorText(cause))
    }
  }

  const save = async (): Promise<void> => {
    if (!draft.title.trim()) {
      setError('书名不能为空。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await unwrap(
        window.shiye.updateProjectMeta(projectId, {
          title: draft.title.trim(),
          author: draft.author.trim(),
          series: draft.series.trim(),
          publisher: draft.publisher.trim(),
          language: draft.language.trim(),
          description: draft.description.trim(),
          tags: draft.tags
            .split(/[、,，]/u)
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 12),
          rating: Math.max(0, Math.min(5, Math.round(draft.rating))),
          readStatus: draft.readStatus,
          coverData: draft.coverData
        })
      )
      await refreshProjects()
      showToast('info', '书目信息已经更新。')
      onClose()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const exportAs = async (format: ExportFormat): Promise<void> => {
    setExporting(format)
    try {
      const result = await unwrap(window.shiye.exportBook(projectId, format))
      showToast('info', `已导出 ${result.chapters} 章，共 ${formatWords(result.words)}。`)
    } catch (cause) {
      const message = errorText(cause)
      if (!message.includes('取消')) showToast('error', message)
    } finally {
      setExporting('')
    }
  }

  return (
    <Dialog
      title="书目信息"
      wide
      onClose={onClose}
      footer={
        <>
          {error ? <span className="error-text" style={{ marginRight: 'auto' }}>{error}</span> : null}
          <button className="btn btn-quiet" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy || !project} onClick={() => void save()}>
            {busy ? <BusyLine text="正在保存" /> : '保存'}
          </button>
        </>
      }
    >
      {!project ? (
        <BusyLine text="正在取书目" />
      ) : (
        <>
          <div className="book-info-head">
            <div className="book-info-cover">
              {draft.coverData ? (
                <img src={draft.coverData} alt="" />
              ) : (
                <span>{draft.title.slice(0, 1) || '书'}</span>
              )}
              <label className="btn btn-ghost btn-sm">
                <ImagePlus size={13} strokeWidth={iconStroke} />
                换封面
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void pickCover(file)
                  }}
                />
              </label>
            </div>
            <div className="book-info-fields">
              <Field label="书名">
                <input
                  className="input"
                  maxLength={60}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </Field>
              <div className="import-grid">
                <Field label="作者">
                  <input
                    className="input"
                    maxLength={80}
                    value={draft.author}
                    onChange={(event) => setDraft({ ...draft, author: event.target.value })}
                  />
                </Field>
                <Field label="系列">
                  <input
                    className="input"
                    maxLength={80}
                    value={draft.series}
                    onChange={(event) => setDraft({ ...draft, series: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="import-grid">
            <Field label="出版社">
              <input
                className="input"
                maxLength={80}
                value={draft.publisher}
                onChange={(event) => setDraft({ ...draft, publisher: event.target.value })}
              />
            </Field>
            <Field label="语言">
              <input
                className="input"
                maxLength={30}
                value={draft.language}
                onChange={(event) => setDraft({ ...draft, language: event.target.value })}
              />
            </Field>
          </div>

          <Field label="标签" hint="用顿号或逗号分隔，最多 12 个。">
            <input
              className="input"
              maxLength={200}
              value={draft.tags}
              onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            />
          </Field>

          <Field label="简介">
            <textarea
              className="textarea"
              rows={3}
              maxLength={4000}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>

          <div className="import-grid">
            <Field label="阅读状态">
              <select
                className="input"
                value={draft.readStatus}
                onChange={(event) =>
                  setDraft({ ...draft, readStatus: event.target.value as Project['readStatus'] })
                }
              >
                <option value="none">未标</option>
                <option value="want">想读</option>
                <option value="reading">在读</option>
                <option value="done">读完</option>
                <option value="dropped">弃读</option>
              </select>
            </Field>
            <Field label="评分">
              <div className="rating-row">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    className="icon-btn"
                    aria-label={`${star} 星`}
                    onClick={() => setDraft({ ...draft, rating: draft.rating === star ? 0 : star })}
                  >
                    <Star
                      size={17}
                      strokeWidth={iconStroke}
                      fill={star <= draft.rating ? 'currentColor' : 'none'}
                    />
                  </button>
                ))}
                <span className="hint">{draft.rating > 0 ? `${draft.rating} 星` : '未评分'}</span>
              </div>
            </Field>
          </div>

          <div className="panel-section">
            <h3 className="panel-title">导出</h3>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {EXPORT_FORMATS.map((item) => (
                <button
                  key={item.value}
                  className="btn btn-ghost btn-sm"
                  disabled={exporting !== ''}
                  onClick={() => void exportAs(item.value)}
                >
                  {exporting === item.value ? <BusyLine text="导出中" /> : item.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** Resizes a cover to fit the 400k data-URL budget without external libraries. */
export async function resizeImage(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024) throw new Error('封面图片不要超过 12 MB。')
  const bitmap = await createImageBitmap(file)
  const maxW = 480
  const maxH = 720
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('这个系统无法处理封面图片。')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  let quality = 0.86
  let data = canvas.toDataURL('image/jpeg', quality)
  while (data.length > 380_000 && quality > 0.4) {
    quality -= 0.08
    data = canvas.toDataURL('image/jpeg', quality)
  }
  if (data.length > 400_000) throw new Error('封面压缩后仍然太大，请换一张更小的图片。')
  return data
}
