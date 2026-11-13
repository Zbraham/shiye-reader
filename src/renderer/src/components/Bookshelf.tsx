import { useEffect, useMemo, useState } from 'react'
import {
  BookMarked,
  CheckSquare,
  Cloud,
  Copy,
  Download,
  FolderPlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import type { ExportFormat, ProjectBrief, Shelf } from '@shared/types'
import { useApp } from '../store'
import { errorText, formatTime, formatWords, unwrap } from '../lib'
import { BusyLine, Dialog, Field } from './ui'
import { ImportBookDialog } from './ImportBookDialog'
import { SettingsDialog } from './SettingsDialog'
import { BookInfoDialog } from './ReaderTools'

type SortKey = 'recent' | 'title' | 'author' | 'created'
type StatusFilter = 'all' | ProjectBrief['readStatus']
type SourceFilter = 'all' | ProjectBrief['source']

const STATUS_LABEL: Record<ProjectBrief['readStatus'], string> = {
  none: '未标',
  want: '想读',
  reading: '在读',
  done: '读完',
  dropped: '弃读'
}

const EXPORT_LABEL: Record<ExportFormat, string> = {
  txt: '导出 TXT',
  md: '导出 Markdown',
  epub: '导出 EPUB',
  docx: '导出 Word',
  pdf: '导出 PDF'
}

export function Bookshelf(): React.JSX.Element {
  const projects = useApp((state) => state.projects)
  const dataDir = useApp((state) => state.dataDir)
  const openSetup = useApp((state) => state.openSetup)
  const openBook = useApp((state) => state.openBook)
  const settingsOpen = useApp((state) => state.settingsOpen)
  const setSettingsOpen = useApp((state) => state.setSettingsOpen)
  const refreshProjects = useApp((state) => state.refreshProjects)
  const showToast = useApp((state) => state.showToast)

  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ProjectBrief | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [infoFor, setInfoFor] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [shelfId, setShelfId] = useState<string | null>(null)
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [shelfManagerOpen, setShelfManagerOpen] = useState(false)
  const [addingToShelf, setAddingToShelf] = useState(false)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const [duplicates, setDuplicates] = useState<Record<string, string[]>>({})
  const [duplicatesBusy, setDuplicatesBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!menuFor) return
    const close = (): void => setMenuFor(null)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuFor])

  const loadShelves = async (): Promise<void> => {
    try {
      setShelves(await unwrap(window.shiye.listShelves()))
    } catch {
      setShelves([])
    }
  }

  useEffect(() => {
    void loadShelves()
  }, [])

  useEffect(() => {
    const listener = (): void => {
      void loadShelves()
    }
    window.addEventListener('shiye:shelves-changed', listener)
    return () => window.removeEventListener('shiye:shelves-changed', listener)
  }, [])

  const currentShelf = shelves.find((shelf) => shelf.id === shelfId) ?? null
  const shelfIds = useMemo(
    () => new Set(currentShelf?.projectIds ?? []),
    [currentShelf]
  )

  useEffect(() => {
    if (shelfId && !shelves.some((shelf) => shelf.id === shelfId)) setShelfId(null)
  }, [shelfId, shelves])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = projects.filter((project) => {
      if (source !== 'all' && project.source !== source) return false
      if (status !== 'all' && project.readStatus !== status) return false
      if (shelfId && !shelfIds.has(project.id)) return false
      if (!needle) return true
      return [project.title, project.author, project.series, ...project.tags]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    const sorted = [...list]
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    else if (sort === 'author') sorted.sort((a, b) => a.author.localeCompare(b.author, 'zh-CN'))
    else if (sort === 'created') sorted.sort((a, b) => b.createdAt - a.createdAt)
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    return sorted
  }, [projects, query, source, status, sort, shelfId, shelfIds])

  const toggleSelected = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exportBook = async (project: ProjectBrief, format: ExportFormat): Promise<void> => {
    setMenuFor(null)
    try {
      const result = await unwrap(window.shiye.exportBook(project.id, format))
      showToast('info', `已导出 ${result.chapters} 章，共 ${formatWords(result.words)}。`)
    } catch (error) {
      const message = errorText(error)
      if (!message.includes('取消')) showToast('error', message)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await unwrap(window.shiye.deleteProject(pendingDelete.id))
      setPendingDelete(null)
      await refreshProjects()
      showToast('info', '这本书已经移出书架。')
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setDeleting(false)
    }
  }

  const batchDelete = async (): Promise<void> => {
    if (selected.size === 0) return
    if (!window.confirm(`确定删除选中的 ${selected.size} 本书？正文、版本和人物设定都会删掉，无法撤销。`)) {
      return
    }
    setDeleting(true)
    try {
      await unwrap(window.shiye.deleteProjects([...selected]))
      setSelected(new Set())
      setSelectMode(false)
      await refreshProjects()
      showToast('info', '选中的书已经删除。')
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setDeleting(false)
    }
  }

  const findDuplicates = async (): Promise<void> => {
    setDuplicatesBusy(true)
    setDuplicatesOpen(true)
    try {
      const groups = await unwrap(window.shiye.findDuplicates())
      setDuplicates(groups)
    } catch (error) {
      showToast('error', errorText(error))
      setDuplicates({})
    } finally {
      setDuplicatesBusy(false)
    }
  }

  const runSync = async (): Promise<void> => {
    const settings = useApp.getState().settings
    if (!settings.syncUrl.trim()) {
      showToast('info', '先到设置里填写 WebDAV 地址。')
      setSettingsOpen(true)
      return
    }
    setSyncing(true)
    try {
      const result = await unwrap(window.shiye.runSync())
      await refreshProjects()
      await loadShelves()
      showToast('info', result.message)
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setSyncing(false)
    }
  }

  const bookById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )

  return (
    <div className="library">
      <div className="library-inner">
        <header className="library-header">
          <div className="brand">
            拾页<small>本地连载写作</small>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="icon-btn"
              title="多设备同步"
              aria-label="多设备同步"
              disabled={syncing}
              onClick={() => void runSync()}
            >
              {syncing ? (
                <RefreshCw size={17} strokeWidth={iconStroke} className="spin" />
              ) : (
                <Cloud size={17} strokeWidth={iconStroke} />
              )}
            </button>
            <button
              className="icon-btn"
              title="设置"
              aria-label="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} strokeWidth={iconStroke} />
            </button>
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              <Upload size={15} strokeWidth={iconStroke} />
              导入小说
            </button>
            <button className="btn btn-primary" onClick={openSetup}>
              <Plus size={15} strokeWidth={iconStroke} />
              新建一本书
            </button>
          </div>
        </header>

        <div className="library-sub">
          <span>{projects.length > 0 ? `书架 · ${projects.length} 本` : '书架'}</span>
          <span title={dataDir}>数据保存在本机</span>
        </div>

        {projects.length > 0 ? (
          <div className="library-toolbar">
            <div className="library-search">
              <Search size={15} strokeWidth={iconStroke} />
              <input
                className="input"
                value={query}
                maxLength={80}
                placeholder="搜书名、作者、标签"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button className="icon-btn" aria-label="清除搜索" onClick={() => setQuery('')}>
                  <X size={13} strokeWidth={iconStroke} />
                </button>
              ) : null}
            </div>
            <div className="library-filters">
              <select
                className="input"
                value={source}
                onChange={(event) => setSource(event.target.value as SourceFilter)}
              >
                <option value="all">全部来源</option>
                <option value="generated">生成</option>
                <option value="imported">导入</option>
              </select>
              <select
                className="input"
                value={status}
                onChange={(event) => setStatus(event.target.value as StatusFilter)}
              >
                <option value="all">全部状态</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="recent">最近更新</option>
                <option value="created">最近加入</option>
                <option value="title">按书名</option>
                <option value="author">按作者</option>
              </select>
              <button
                className="btn btn-ghost btn-sm"
                aria-pressed={selectMode}
                onClick={() => {
                  setSelectMode(!selectMode)
                  setSelected(new Set())
                }}
              >
                <CheckSquare size={14} strokeWidth={iconStroke} />
                {selectMode ? '完成' : '管理'}
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => void findDuplicates()}>
                <Copy size={14} strokeWidth={iconStroke} />
                查重
              </button>
            </div>
          </div>
        ) : null}

        {shelves.length > 0 ? (
          <div className="shelf-row">
            <button
              className="chip"
              aria-pressed={shelfId === null}
              onClick={() => setShelfId(null)}
            >
              全部
            </button>
            {shelves.map((shelf) => (
              <button
                key={shelf.id}
                className="chip"
                aria-pressed={shelfId === shelf.id}
                onClick={() => setShelfId(shelfId === shelf.id ? null : shelf.id)}
              >
                <BookMarked size={12} strokeWidth={iconStroke} />
                {shelf.name}
                <span className="chip-count">{shelf.projectIds.length}</span>
              </button>
            ))}
            <button
              className="icon-btn"
              title="管理书架"
              aria-label="管理书架"
              onClick={() => setShelfManagerOpen(true)}
            >
              <FolderPlus size={15} strokeWidth={iconStroke} />
            </button>
          </div>
        ) : (
          <div className="shelf-row">
            <button className="chip" onClick={() => setShelfManagerOpen(true)}>
              <FolderPlus size={12} strokeWidth={iconStroke} />
              新建书架
            </button>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="empty">
            <h2>书架还空着</h2>
            <p>给一个念头从头写，或者把已经下载好的小说放进来读。</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={openSetup}>
                新建一本书
              </button>
              <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
                <Upload size={15} strokeWidth={iconStroke} />
                导入本地小说
              </button>
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <h2>没有符合的书</h2>
            <p>换个关键词，或者清掉筛选条件。</p>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setQuery('')
                setSource('all')
                setStatus('all')
                setShelfId(null)
              }}
            >
              清空筛选
            </button>
          </div>
        ) : (
          <div className="book-grid">
            {shown.map((project) => (
              <div
                className="book-card"
                key={project.id}
                data-selected={selected.has(project.id) ? 'true' : 'false'}
              >
                <button
                  className="book-cover"
                  data-cover={project.coverIndex % 5}
                  onClick={() => {
                    if (selectMode) toggleSelected(project.id)
                    else void openBook(project.id)
                  }}
                  title={`打开《${project.title}》`}
                >
                  {project.coverData ? (
                    <img className="cover-image" src={project.coverData} alt="" />
                  ) : null}
                  {selectMode ? (
                    <span
                      className="cover-check"
                      data-on={selected.has(project.id) ? 'true' : 'false'}
                    >
                      {selected.has(project.id) ? '✓' : ''}
                    </span>
                  ) : null}
                  <div className="cover-top">
                    <span className="cover-genre">{project.genre || '连载'}</span>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {project.source === 'imported' ? (
                        <span className="badge">导入</span>
                      ) : null}
                      {project.hasPartial ? <span className="badge">草稿</span> : null}
                    </span>
                  </div>
                  <div className="cover-body">
                    <h3>{project.title}</h3>
                    <div className="cover-rule" />
                    {project.author ? (
                      <div className="cover-author">{project.author}</div>
                    ) : null}
                    <div className="cover-foot">
                      {project.chapterCount > 0
                        ? project.source === 'imported'
                          ? `共 ${project.chapterCount} 章`
                          : `已写 ${project.chapterCount} 章`
                        : '尚未落笔'}
                    </div>
                  </div>
                  {project.rating > 0 ? (
                    <span className="cover-rating">
                      <Star size={11} strokeWidth={iconStroke} fill="currentColor" />
                      {project.rating}
                    </span>
                  ) : null}
                </button>

                {!selectMode ? (
                  <>
                    <button
                      className="icon-btn book-kebab"
                      title="更多"
                      aria-label="更多"
                      aria-expanded={menuFor === project.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuFor(menuFor === project.id ? null : project.id)
                      }}
                    >
                      <MoreHorizontal size={15} strokeWidth={iconStroke} />
                    </button>

                    {menuFor === project.id ? (
                      <div
                        className="menu"
                        style={{ top: 42, right: 8 }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setMenuFor(null)
                            setInfoFor(project.id)
                          }}
                        >
                          <Star size={14} strokeWidth={iconStroke} />
                          书目信息
                        </button>
                        {(['txt', 'md', 'epub', 'docx', 'pdf'] as ExportFormat[]).map((format) => (
                          <button key={format} onClick={() => void exportBook(project, format)}>
                            <Download size={14} strokeWidth={iconStroke} />
                            {EXPORT_LABEL[format]}
                          </button>
                        ))}
                        <hr className="divider" style={{ margin: '4px 0' }} />
                        <button
                          data-danger="true"
                          onClick={() => {
                            setMenuFor(null)
                            setPendingDelete(project)
                          }}
                        >
                          <Trash2 size={14} strokeWidth={iconStroke} />
                          删除这本书
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}

                <div className="book-meta">
                  <span>{formatWords(project.wordCount)}</span>
                  <span>{STATUS_LABEL[project.readStatus]}</span>
                  <span>{formatTime(project.updatedAt)}</span>
                </div>
              </div>
            ))}

            {!selectMode ? (
              <>
                <div className="book-card book-new">
                  <button className="book-cover" onClick={openSetup} title="新建一本书">
                    <Plus size={20} strokeWidth={iconStroke} />
                    <span className="book-new-label">新建一本书</span>
                  </button>
                </div>

                <div className="book-card book-new">
                  <button
                    className="book-cover"
                    onClick={() => setImportOpen(true)}
                    title="导入本地小说"
                  >
                    <Upload size={20} strokeWidth={iconStroke} />
                    <span className="book-new-label">导入小说</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {selectMode ? (
        <div className="batch-bar">
          <span>
            已选 <strong>{selected.size}</strong> 本
          </span>
          <div className="row">
            <button
              className="btn btn-ghost btn-sm"
              disabled={selected.size === 0}
              onClick={() => setAddingToShelf(true)}
            >
              <FolderPlus size={14} strokeWidth={iconStroke} />
              加入书架
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={selected.size === 0 || deleting}
              onClick={() => void batchDelete()}
            >
              <Trash2 size={14} strokeWidth={iconStroke} />
              删除
            </button>
            <button
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setSelectMode(false)
                setSelected(new Set())
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <Dialog
          title="删除这本书"
          onClose={() => {
            if (!deleting) setPendingDelete(null)
          }}
          footer={
            <>
              <button
                className="btn btn-quiet"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? '正在删除' : '确认删除'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.85 }}>
            将删除《{pendingDelete.title}》的正文、章纲、版本与人物设定。此操作无法撤销。
          </p>
        </Dialog>
      ) : null}

      {duplicatesOpen ? (
        <Dialog
          title="查找重复的书"
          wide
          onClose={() => setDuplicatesOpen(false)}
          footer={
            <button className="btn btn-quiet" onClick={() => setDuplicatesOpen(false)}>
              关闭
            </button>
          }
        >
          {duplicatesBusy ? <BusyLine text="正在比对书名" /> : null}
          {!duplicatesBusy && Object.keys(duplicates).length === 0 ? (
            <p className="hint">没有发现书名相同的书。</p>
          ) : null}
          {Object.entries(duplicates).map(([title, ids]) => (
            <div className="duplicate-group" key={title}>
              <div className="duplicate-head">
                <strong>{title}</strong>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSelected(new Set(ids))
                    setSelectMode(true)
                    setDuplicatesOpen(false)
                  }}
                >
                  选择这些书
                </button>
              </div>
              <div className="duplicate-list">
                {ids.map((id) => {
                  const book = bookById.get(id)
                  if (!book) return null
                  return (
                    <div className="duplicate-item" key={id}>
                      <span>《{book.title}》</span>
                      <span className="hint">
                        {book.chapterCount} 章 · {formatWords(book.wordCount)} ·{' '}
                        {STATUS_LABEL[book.readStatus]}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </Dialog>
      ) : null}

      {addingToShelf ? (
        <AddToShelfDialog
          shelves={shelves}
          count={selected.size}
          onClose={() => setAddingToShelf(false)}
          onDone={async () => {
            setAddingToShelf(false)
            setSelected(new Set())
            setSelectMode(false)
            await loadShelves()
            showToast('info', '已经放进书架。')
          }}
          projectIds={[...selected]}
        />
      ) : null}

      {shelfManagerOpen ? (
        <ShelfManagerDialog
          shelves={shelves}
          onClose={() => setShelfManagerOpen(false)}
          onChanged={loadShelves}
        />
      ) : null}

      {importOpen ? <ImportBookDialog onClose={() => setImportOpen(false)} /> : null}
      {infoFor ? <BookInfoDialog projectId={infoFor} onClose={() => setInfoFor(null)} /> : null}
      {settingsOpen ? <SettingsDialog /> : null}
    </div>
  )
}

function AddToShelfDialog({
  shelves,
  projectIds,
  count,
  onClose,
  onDone
}: {
  shelves: Shelf[]
  projectIds: string[]
  count: number
  onClose: () => void
  onDone: () => Promise<void>
}): React.JSX.Element {
  const showToast = useApp((state) => state.showToast)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = async (shelf: Shelf): Promise<void> => {
    setBusy(true)
    try {
      await unwrap(window.shiye.addToShelf(shelf.id, projectIds))
      await onDone()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const create = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const shelf = await unwrap(window.shiye.createShelf(name.trim()))
      await unwrap(window.shiye.addToShelf(shelf.id, projectIds))
      await onDone()
    } catch (cause) {
      setError(errorText(cause))
      showToast('error', errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`把 ${count} 本书放进书架`} onClose={onClose}>
      <div className="shelf-pick-list">
        {shelves.map((shelf) => (
          <button
            key={shelf.id}
            className="shelf-pick"
            disabled={busy}
            onClick={() => void add(shelf)}
          >
            <BookMarked size={14} strokeWidth={iconStroke} />
            <span>{shelf.name}</span>
            <span className="hint">{shelf.projectIds.length} 本</span>
          </button>
        ))}
      </div>
      <Field label="新建书架" hint="最多 40 个字。">
        <div className="row">
          <input
            className="input"
            maxLength={40}
            value={name}
            placeholder="例如：睡前读"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            新建并加入
          </button>
        </div>
      </Field>
      {error ? <p className="error-text">{error}</p> : null}
    </Dialog>
  )
}

function ShelfManagerDialog({
  shelves,
  onClose,
  onChanged
}: {
  shelves: Shelf[]
  onClose: () => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const showToast = useApp((state) => state.showToast)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await onChanged()
    } catch (error) {
      showToast('error', errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="管理书架"
      onClose={onClose}
      footer={
        <button className="btn btn-quiet" onClick={onClose}>
          完成
        </button>
      }
    >
      <Field label="新建书架">
        <div className="row">
          <input
            className="input"
            maxLength={40}
            value={name}
            placeholder="书架名字"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() =>
              void act(async () => {
                await unwrap(window.shiye.createShelf(name.trim()))
                setName('')
              })
            }
          >
            新建
          </button>
        </div>
      </Field>

      <div className="shelf-pick-list">
        {shelves.length === 0 ? <p className="hint">还没有书架。</p> : null}
        {shelves.map((shelf) => (
          <div className="shelf-manage-item" key={shelf.id}>
            {renaming?.id === shelf.id ? (
              <>
                <input
                  className="input"
                  autoFocus
                  maxLength={40}
                  value={renaming.name}
                  onChange={(event) =>
                    setRenaming({ id: shelf.id, name: event.target.value })
                  }
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || !renaming.name.trim()}
                  onClick={() =>
                    void act(async () => {
                      await unwrap(window.shiye.renameShelf(shelf.id, renaming.name.trim()))
                      setRenaming(null)
                    })
                  }
                >
                  保存
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => setRenaming(null)}>
                  取消
                </button>
              </>
            ) : (
              <>
                <BookMarked size={14} strokeWidth={iconStroke} />
                <span className="shelf-manage-name">{shelf.name}</span>
                <span className="hint">{shelf.projectIds.length} 本</span>
                <button
                  className="link-btn"
                  onClick={() => setRenaming({ id: shelf.id, name: shelf.name })}
                >
                  改名
                </button>
                <button
                  className="icon-btn"
                  title="删除书架"
                  aria-label="删除书架"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`删除书架「${shelf.name}」？书本身不会被删除。`)) return
                    void act(async () => {
                      await unwrap(window.shiye.deleteShelf(shelf.id))
                    })
                  }}
                >
                  <Trash2 size={14} strokeWidth={iconStroke} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  )
}
