import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe2,
  ImagePlus,
  Link2,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { countWords } from '@shared/text'
import {
  IMPORT_LIMITS,
  parseNovelFile,
  type ParsedBook,
  type ParsedChapter
} from '@shared/import'
import type { OpdsFeed } from '@shared/types'
import { useApp } from '../store'
import { errorText, formatWords, unwrap } from '../lib'
import { resizeImage } from './ReaderTools'
import { BusyLine, Dialog, Field } from './ui'

const FORMAT_LABEL: Record<ParsedBook['format'], string> = {
  txt: 'TXT 纯文本',
  md: 'Markdown',
  epub: 'EPUB',
  html: 'HTML 网页',
  docx: 'Word 文档',
  fb2: 'FB2 电子书',
  rtf: 'RTF 文档'
}

const ACCEPT =
  '.txt,.text,.md,.markdown,.html,.htm,.epub,.docx,.fb2,.rtf,.zip,text/plain,text/markdown,text/html,application/epub+zip,application/zip'

interface DraftEntry {
  key: string
  fileName: string
  book: ParsedBook
  title: string
  targetLen: number
  selected: boolean
}

let draftSeq = 0

function medianWords(book: ParsedBook): number {
  const lengths = book.chapters
    .map((chapter) => countWords(chapter.content))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)
  if (lengths.length === 0) return 2000
  const middle = Math.floor(lengths.length / 2)
  const value =
    lengths.length % 2 === 0
      ? ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2
      : (lengths[middle] ?? 0)
  return Math.min(6000, Math.max(600, Math.round(value)))
}

function wordsOf(chapters: ParsedChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0)
}

function samplesOf(book: ParsedBook): ParsedChapter[] {
  const head = book.chapters.slice(0, 2)
  const last = book.chapters[book.chapters.length - 1]
  if (last && !head.includes(last)) return [...head, last]
  return head
}

function newEntry(fileName: string, book: ParsedBook): DraftEntry {
  draftSeq += 1
  return {
    key: `draft-${Date.now()}-${draftSeq}`,
    fileName,
    book,
    title: book.title.slice(0, 60),
    targetLen: medianWords(book),
    selected: true
  }
}

export function ImportBookDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const openBook = useApp((state) => state.openBook)
  const refreshProjects = useApp((state) => state.refreshProjects)
  const showToast = useApp((state) => state.showToast)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const folderRef = useRef<HTMLInputElement | null>(null)
  const coverRef = useRef<HTMLInputElement | null>(null)
  const [tab, setTab] = useState<'file' | 'url' | 'opds'>('file')
  const [entries, setEntries] = useState<DraftEntry[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseLabel, setParseLabel] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const [editIdx, setEditIdx] = useState(0)
  const [editing, setEditing] = useState(false)

  const [url, setUrl] = useState('')
  const [urlName, setUrlName] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)

  const [opdsUrl, setOpdsUrl] = useState('')
  const [feed, setFeed] = useState<OpdsFeed | null>(null)
  const [feedBusy, setFeedBusy] = useState(false)
  const [downloading, setDownloading] = useState('')

  const active = entries.find((entry) => entry.key === activeKey) ?? entries[0] ?? null
  const book = active?.book ?? null
  const totalWords = book ? wordsOf(book.chapters) : 0
  const samples = book ? samplesOf(book) : []
  const currentChapter = book?.chapters[editIdx]
  const totalSelected = entries.filter((entry) => entry.selected).length

  useEffect(() => {
    setEditIdx(0)
    setEditing(false)
    // Only reset when switching to a different draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key])

  const patchEntry = (key: string, patch: Partial<DraftEntry>): void => {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry))
    )
  }

  const patchBook = (key: string, patch: Partial<ParsedBook>): void => {
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, book: { ...entry.book, ...patch } } : entry
      )
    )
  }

  const parseFiles = async (files: File[]): Promise<void> => {
    if (parsing || importing || files.length === 0) return
    setError('')
    setParsing(true)
    const added: DraftEntry[] = []
    const failures: string[] = []
    for (const file of files.slice(0, 20)) {
      setParseLabel(`正在解析 ${file.name}`)
      if (file.size > IMPORT_LIMITS.fileBytes) {
        failures.push(
          `${file.name} 有 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${
            IMPORT_LIMITS.fileBytes / 1024 / 1024
          } MB 上限。`
        )
        continue
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = await parseNovelFile({ name: file.name, bytes })
        added.push(newEntry(file.name, parsed))
      } catch (cause) {
        failures.push(`${file.name}：${cause instanceof Error ? cause.message : errorText(cause)}`)
      }
      // Let the UI breathe between large files.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const first = added[0]
    if (first) setActiveKey(first.key)
    setEntries((current) => [...current, ...added])
    if (failures.length > 0) setError(failures.slice(0, 3).join(' '))
    if (added.length > 1) {
      showToast('info', `已解析 ${added.length} 个文件，逐个确认后再导入。`)
    }
    setParsing(false)
    setParseLabel('')
  }

  const pickFiles = (): void => {
    if (parsing || importing) return
    inputRef.current?.click()
  }

  const takeRemote = (name: string, remote: ParsedBook): void => {
    if (entries.length >= 20) {
      setError('一次最多处理 20 本书。')
      return
    }
    const entry = newEntry(name, remote)
    setEntries((current) => [...current, entry])
    setActiveKey(entry.key)
    setTab('file')
    showToast('info', `已取回《${entry.title}》，确认后导入。`)
  }

  const fetchUrl = async (): Promise<void> => {
    if (!url.trim() || urlBusy || importing) return
    setUrlBusy(true)
    setError('')
    try {
      const remote = await unwrap(window.shiye.importFromUrl({ url: url.trim(), name: urlName.trim() }))
      takeRemote(remote.name, remote.book)
      setUrl('')
      setUrlName('')
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setUrlBusy(false)
    }
  }

  const browseFeed = async (target?: string): Promise<void> => {
    const nextUrl = (target ?? opdsUrl).trim()
    if (!nextUrl || feedBusy) return
    setFeedBusy(true)
    setError('')
    try {
      const result = await unwrap(window.shiye.browseOpds(nextUrl))
      setFeed(result)
      setOpdsUrl(nextUrl)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setFeedBusy(false)
    }
  }

  const downloadEntry = async (contentUrl: string): Promise<void> => {
    if (downloading || importing) return
    setDownloading(contentUrl)
    setError('')
    try {
      const remote = await unwrap(window.shiye.importFromOpds(contentUrl))
      takeRemote(remote.name, remote.book)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setDownloading('')
    }
  }

  const updateChapter = (patch: Partial<ParsedChapter>): void => {
    if (!active || !currentChapter) return
    const chapters = active.book.chapters.map((chapter, index) => {
      if (index !== editIdx) return chapter
      const next = { ...chapter, ...patch }
      // Rich HTML is a snapshot of the original paragraph layout. Once the
      // reader edits the text, that snapshot no longer matches and would hide
      // the edit behind the old rendering.
      if (Object.prototype.hasOwnProperty.call(patch, 'content')) delete next.html
      return next
    })
    patchBook(active.key, { chapters, words: wordsOf(chapters) })
  }

  const removeChapter = (): void => {
    if (!active || active.book.chapters.length <= 1) return
    const chapters = active.book.chapters.filter((_, index) => index !== editIdx)
    patchBook(active.key, { chapters, words: wordsOf(chapters) })
    setEditIdx((current) => Math.max(0, Math.min(chapters.length - 1, current)))
  }

  const applyCover = async (file: File): Promise<void> => {
    if (!active) return
    try {
      const data = await resizeImage(file)
      patchBook(active.key, { coverData: data })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorText(cause))
    }
  }

  const startImport = async (): Promise<void> => {
    const targets = entries.filter((entry) => entry.selected && entry.title.trim())
    if (targets.length === 0 || importing) return
    setImporting(true)
    setError('')
    let firstId = ''
    const failed: string[] = []
    let done = 0
    for (const entry of targets) {
      try {
        const project = await unwrap(
          window.shiye.importBook({
            title: entry.title.trim().slice(0, 60),
            genre: '导入',
            tone: '沿用原文',
            pov: '沿用原文',
            styleSample: entry.book.chapters[0]?.content.slice(0, 1200) ?? '',
            styleGuide: '严格延续原文的叙述人称、语气与节奏',
            targetLenPerChapter: Math.min(6000, Math.max(600, Math.round(entry.targetLen))),
            sourceFile: entry.fileName.slice(0, 260),
            author: entry.book.author?.slice(0, 80),
            series: entry.book.series?.slice(0, 80),
            publisher: entry.book.publisher?.slice(0, 80),
            language: entry.book.language?.slice(0, 30),
            description: entry.book.description?.slice(0, 4000),
            tags: entry.book.tags?.slice(0, 12),
            coverData: entry.book.coverData,
            chapters: entry.book.chapters.map((chapter) => ({
              title: chapter.title.slice(0, 120),
              content: chapter.content,
              ...(chapter.html ? { html: chapter.html } : {}),
              ...(chapter.volume ? { volume: chapter.volume.slice(0, 80) } : {}),
              ...(chapter.level ? { level: chapter.level } : {})
            }))
          })
        )
        if (!firstId) firstId = project.id
        done += 1
      } catch (cause) {
        failed.push(`《${entry.title}》：${errorText(cause)}`)
      }
    }
    await refreshProjects()
    if (done > 0) {
      onClose()
      if (firstId) await openBook(firstId, 1)
      showToast(
        'info',
        failed.length > 0
          ? `已导入 ${done} 本，${failed.length} 本失败：${failed[0]}`
          : done === 1
            ? '书已经放上书架。'
            : `${done} 本书已经放上书架。`
      )
    } else {
      setError(failed[0] ?? '导入没有完成。')
      setImporting(false)
    }
  }

  const removeDraft = (key: string): void => {
    setEntries((current) => current.filter((entry) => entry.key !== key))
    if (activeKey === key) setActiveKey('')
  }

  const formatFacts = useMemo(() => {
    if (!book) return []
    const facts = [
      FORMAT_LABEL[book.format],
      book.encoding,
      `${book.chapters.length} 章`,
      formatWords(totalWords)
    ]
    if (book.author) facts.push(book.author)
    return facts
  }, [book, totalWords])

  return (
    <Dialog
      title="导入小说"
      wide
      onClose={() => {
        if (!parsing && !importing && !urlBusy) onClose()
      }}
      footer={
        <>
          <button
            className="btn btn-quiet"
            disabled={parsing || importing || urlBusy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={!book || parsing || importing || totalSelected === 0}
            onClick={() => void startImport()}
          >
            {importing ? (
              <BusyLine text="正在建书" />
            ) : (
              <>
                <Upload size={14} strokeWidth={iconStroke} />
                导入{totalSelected > 1 ? ` ${totalSelected} 本` : '并阅读'}
              </>
            )}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void parseFiles(files)
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).filter((file) =>
            /\.(txt|text|md|markdown|html?|epub|docx|fb2|rtf|zip)$/iu.test(file.name)
          )
          event.target.value = ''
          if (files.length === 0) {
            setError('这个文件夹里没有支持的电子书文件。')
            return
          }
          void parseFiles(files)
        }}
      />
      <input
        ref={coverRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void applyCover(file)
        }}
      />

      <div className="seg import-tabs">
        <button aria-pressed={tab === 'file'} onClick={() => setTab('file')}>
          <FileText size={13} strokeWidth={iconStroke} />
          本地文件
        </button>
        <button aria-pressed={tab === 'url'} onClick={() => setTab('url')}>
          <Link2 size={13} strokeWidth={iconStroke} />
          链接导入
        </button>
        <button aria-pressed={tab === 'opds'} onClick={() => setTab('opds')}>
          <Globe2 size={13} strokeWidth={iconStroke} />
          OPDS 书库
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {tab === 'file' ? (
        <>
          <div
            className="import-drop"
            data-over={dragOver ? 'true' : 'false'}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              void parseFiles(Array.from(event.dataTransfer.files))
            }}
            onClick={pickFiles}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') pickFiles()
            }}
          >
            <Upload size={20} strokeWidth={iconStroke} />
            <div>
              <strong>拖入文件，或点击选择</strong>
              <p className="hint" style={{ margin: 0 }}>
                支持 TXT、Markdown、HTML、EPUB、DOCX、FB2、RTF 和 ZIP；可一次选多本。
              </p>
            </div>
            {parsing ? <BusyLine text={parseLabel || '正在解析'} /> : null}
          </div>
          <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <p className="hint" style={{ margin: 0 }}>
              解析只在本机进行，不会上传，也不会自动调用 AI。上限 {IMPORT_LIMITS.chapters} 章、
              {formatWords(IMPORT_LIMITS.totalChars)}字、单文件{' '}
              {IMPORT_LIMITS.fileBytes / 1024 / 1024} MB。
            </p>
            <button
              className="link-btn"
              disabled={parsing || importing}
              onClick={() => folderRef.current?.click()}
            >
              选择整个文件夹
            </button>
          </div>
        </>
      ) : null}

      {tab === 'url' ? (
        <div className="import-url">
          <p className="hint" style={{ marginTop: 0 }}>
            直接粘贴 TXT、EPUB、FB2 等文件的下载地址。服务器需要允许跨域访问。
          </p>
          <div className="row">
            <input
              className="input"
              value={url}
              placeholder="https://example.com/book.epub"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void fetchUrl()
              }}
            />
            <button
              className="btn btn-primary"
              disabled={!url.trim() || urlBusy}
              onClick={() => void fetchUrl()}
            >
              {urlBusy ? <BusyLine text="正在取回" /> : '取回'}
            </button>
          </div>
          <input
            className="input"
            value={urlName}
            maxLength={120}
            placeholder="文件名（可选，用于判断格式和书名）"
            onChange={(event) => setUrlName(event.target.value)}
          />
        </div>
      ) : null}

      {tab === 'opds' ? (
        <div className="import-opds">
          <p className="hint" style={{ marginTop: 0 }}>
            输入 OPDS 目录地址，浏览后逐本下载。也可以用 Calibre、Komga 等自建书库的 OPDS 地址。
          </p>
          <div className="row">
            <input
              className="input"
              value={opdsUrl}
              placeholder="https://example.com/opds"
              onChange={(event) => setOpdsUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void browseFeed()
              }}
            />
            <button
              className="btn btn-primary"
              disabled={!opdsUrl.trim() || feedBusy}
              onClick={() => void browseFeed()}
            >
              {feedBusy ? <BusyLine text="正在浏览" /> : '浏览'}
            </button>
          </div>
          {feed ? (
            <div className="opds-feed">
              <div className="opds-feed-head">
                <strong>{feed.title || '未命名书库'}</strong>
                <span className="hint">{feed.entries.length} 本</span>
              </div>
              {feed.entries.length === 0 ? <p className="hint">这个目录没有书。</p> : null}
              {feed.entries.map((item) => (
                <div className="opds-item" key={item.id || item.contentUrl}>
                  {item.coverUrl ? (
                    <img
                      className="opds-cover"
                      src={item.coverUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="opds-cover" data-empty="true">
                      <BookOpen size={16} strokeWidth={iconStroke} />
                    </span>
                  )}
                  <div className="opds-info">
                    <span className="opds-title">{item.title}</span>
                    <span className="hint">
                      {[item.author, item.format].filter(Boolean).join(' · ') || '未知格式'}
                    </span>
                    {item.summary ? <span className="opds-summary">{item.summary}</span> : null}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!item.contentUrl || downloading === item.contentUrl}
                    onClick={() => void downloadEntry(item.contentUrl)}
                  >
                    {downloading === item.contentUrl ? '取回中' : '取回'}
                  </button>
                </div>
              ))}
              {feed.nextUrl ? (
                <button
                  className="btn btn-quiet btn-sm"
                  disabled={feedBusy}
                  onClick={() => void browseFeed(feed.nextUrl ?? '')}
                >
                  下一页
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="import-queue">
          <span className="label">待导入 · {totalSelected} 本</span>
          {entries.map((entry) => (
            <div
              className="import-queue-item"
              key={entry.key}
              data-active={entry.key === active?.key}
              onClick={() => setActiveKey(entry.key)}
            >
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={entry.selected}
                  onChange={(event) => patchEntry(entry.key, { selected: event.target.checked })}
                />
                <span>{entry.title || entry.fileName}</span>
              </label>
              <span className="hint">
                {FORMAT_LABEL[entry.book.format]} · {entry.book.chapters.length} 章
              </span>
              <button
                className="icon-btn"
                aria-label="移到待导入列表外"
                title="移除"
                disabled={importing}
                onClick={() => removeDraft(entry.key)}
              >
                <X size={13} strokeWidth={iconStroke} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {book && active ? (
        <div className="import-preview">
          <div className="import-grid">
            <div>
              <span className="label">书名</span>
              <input
                className="input"
                maxLength={60}
                value={active.title}
                disabled={importing}
                onChange={(event) => patchEntry(active.key, { title: event.target.value })}
              />
            </div>
            <div>
              <span className="label">识别结果</span>
              <div className="import-facts">
                {formatFacts.map((fact, index) => (
                  <span className="badge" key={`${fact}-${index}`}>
                    {fact}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <details className="import-meta">
            <summary>书目信息与封面</summary>
            <div className="import-meta-grid">
              <Field label="作者">
                <input
                  className="input"
                  maxLength={80}
                  value={book.author ?? ''}
                  disabled={importing}
                  onChange={(event) => patchBook(active.key, { author: event.target.value })}
                />
              </Field>
              <Field label="系列">
                <input
                  className="input"
                  maxLength={80}
                  value={book.series ?? ''}
                  disabled={importing}
                  onChange={(event) => patchBook(active.key, { series: event.target.value })}
                />
              </Field>
              <Field label="出版社">
                <input
                  className="input"
                  maxLength={80}
                  value={book.publisher ?? ''}
                  disabled={importing}
                  onChange={(event) => patchBook(active.key, { publisher: event.target.value })}
                />
              </Field>
              <Field label="语言">
                <input
                  className="input"
                  maxLength={30}
                  value={book.language ?? ''}
                  disabled={importing}
                  onChange={(event) => patchBook(active.key, { language: event.target.value })}
                />
              </Field>
              <Field label="标签" hint="用顿号或逗号分开，最多 12 个。">
                <input
                  className="input"
                  maxLength={300}
                  value={(book.tags ?? []).join('、')}
                  disabled={importing}
                  onChange={(event) =>
                    patchBook(active.key, {
                      tags: event.target.value
                        .split(/[、,，]/u)
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                        .slice(0, 12)
                    })
                  }
                />
              </Field>
              <Field label="封面">
                <div className="row">
                  {book.coverData ? (
                    <img className="import-cover" src={book.coverData} alt="" />
                  ) : null}
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={importing}
                    onClick={() => coverRef.current?.click()}
                  >
                    <ImagePlus size={13} strokeWidth={iconStroke} />
                    {book.coverData ? '换封面' : '选封面'}
                  </button>
                  {book.coverData ? (
                    <button
                      className="btn btn-quiet btn-sm"
                      disabled={importing}
                      onClick={() => patchBook(active.key, { coverData: '' })}
                    >
                      移除
                    </button>
                  ) : null}
                </div>
              </Field>
            </div>
            <Field label="简介">
              <textarea
                className="input textarea"
                rows={3}
                maxLength={4000}
                value={book.description ?? ''}
                disabled={importing}
                onChange={(event) => patchBook(active.key, { description: event.target.value })}
              />
            </Field>
          </details>

          <Field
            label="续写时单章目标字数"
            hint="按导入章节的字数中位数给出，可自行调整。只在让 AI 接着写时使用。"
          >
            <div className="import-len">
              <input
                className="input"
                type="number"
                min={600}
                max={6000}
                step={100}
                value={active.targetLen}
                disabled={importing}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) patchEntry(active.key, { targetLen: next })
                }}
              />
              <span className="hint">字 / 章</span>
            </div>
          </Field>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">章节预览</span>
            <button className="link-btn" onClick={() => setEditing(!editing)}>
              {editing ? '收起编辑' : '编辑目录与正文'}
            </button>
          </div>

          {book.warnings.length > 0 ? (
            <div className="import-warnings">
              {book.warnings.slice(0, 5).map((warning, index) => (
                <p key={index}>· {warning}</p>
              ))}
            </div>
          ) : null}

          {editing ? (
            <div className="chapter-editor">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  <button
                    className="icon-btn"
                    aria-label="上一章"
                    disabled={editIdx <= 0}
                    onClick={() => setEditIdx(Math.max(0, editIdx - 1))}
                  >
                    <ChevronLeft size={15} strokeWidth={iconStroke} />
                  </button>
                  <span className="hint">
                    {editIdx + 1} / {book.chapters.length}
                  </span>
                  <button
                    className="icon-btn"
                    aria-label="下一章"
                    disabled={editIdx >= book.chapters.length - 1}
                    onClick={() => setEditIdx(Math.min(book.chapters.length - 1, editIdx + 1))}
                  >
                    <ChevronRight size={15} strokeWidth={iconStroke} />
                  </button>
                </div>
                <button
                  className="btn btn-quiet btn-sm"
                  disabled={book.chapters.length <= 1 || importing}
                  onClick={removeChapter}
                >
                  <Trash2 size={13} strokeWidth={iconStroke} />
                  删除本章
                </button>
              </div>
              {currentChapter ? (
                <>
                  <input
                    className="input"
                    maxLength={120}
                    value={currentChapter.title}
                    disabled={importing}
                    onChange={(event) => updateChapter({ title: event.target.value })}
                  />
                  <textarea
                    className="input textarea chapter-text"
                    rows={10}
                    value={currentChapter.content}
                    disabled={importing}
                    onChange={(event) => updateChapter({ content: event.target.value })}
                  />
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="hint">
                      {formatWords(countWords(currentChapter.content))}
                      {currentChapter.volume ? ` · ${currentChapter.volume}` : ''}
                      {currentChapter.html ? ' · 含排版' : ''}
                    </span>
                    <span className="hint">直接改文字会只保留纯文本排版。</span>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="import-samples">
              {samples.map((chapter, index) => {
                const isLast = index === samples.length - 1 && samples.length > 1
                return (
                  <div className="import-sample" key={`${chapter.title}-${index}`}>
                    <div className="import-sample-head">
                      <span>{chapter.title}</span>
                      <span className="hint">{formatWords(countWords(chapter.content))}</span>
                    </div>
                    <p>{chapter.content.slice(0, 140)}</p>
                    {isLast ? <span className="hint">……</span> : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}
