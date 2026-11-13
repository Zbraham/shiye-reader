import { useEffect, useState } from 'react'
import { Download, MoreHorizontal, Plus, Settings2, Trash2 } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import type { ProjectBrief } from '@shared/types'
import { useApp } from '../store'
import { errorText, formatTime, formatWords, unwrap } from '../lib'
import { Dialog } from './ui'
import { SettingsDialog } from './SettingsDialog'

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

  useEffect(() => {
    if (!menuFor) return
    const close = (): void => setMenuFor(null)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuFor])

  const exportBook = async (project: ProjectBrief, format: 'txt' | 'md'): Promise<void> => {
    setMenuFor(null)
    try {
      const result = await unwrap(window.shiye.exportBook(project.id, format))
      showToast(
        'info',
        `已导出 ${result.chapters} 章，共 ${formatWords(result.words)}。`
      )
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
              title="设置"
              aria-label="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} strokeWidth={iconStroke} />
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

        {projects.length === 0 ? (
          <div className="empty">
            <h2>书架还空着</h2>
            <p>给一个念头，先铺骨架，再一章一章写下去。</p>
            <button className="btn btn-primary" onClick={openSetup}>
              新建一本书
            </button>
          </div>
        ) : (
          <div className="book-grid">
            {projects.map((project) => (
              <div className="book-card" key={project.id}>
                <button
                  className="book-cover"
                  data-cover={project.coverIndex % 5}
                  onClick={() => void openBook(project.id)}
                  title={`打开《${project.title}》`}
                >
                  <div className="cover-top">
                    <span className="cover-genre">{project.genre || '连载'}</span>
                    {project.hasPartial ? <span className="badge">草稿</span> : null}
                  </div>
                  <div>
                    <h3>{project.title}</h3>
                    <div className="cover-rule" />
                    <div className="cover-foot">
                      {project.chapterCount > 0
                        ? `已写 ${project.chapterCount} 章`
                        : '尚未落笔'}
                    </div>
                  </div>
                </button>

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
                    <button onClick={() => void exportBook(project, 'txt')}>
                      <Download size={14} strokeWidth={iconStroke} />
                      导出 TXT
                    </button>
                    <button onClick={() => void exportBook(project, 'md')}>
                      <Download size={14} strokeWidth={iconStroke} />
                      导出 Markdown
                    </button>
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

                <div className="book-meta">
                  <span>{formatWords(project.wordCount)}</span>
                  <span>{formatTime(project.updatedAt)}</span>
                </div>
              </div>
            ))}

            <div className="book-card book-new">
              <button className="book-cover" onClick={openSetup} title="新建一本书">
                <Plus size={20} strokeWidth={iconStroke} />
                <span className="book-new-label">新建一本书</span>
              </button>
            </div>
          </div>
        )}
      </div>

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

      {settingsOpen ? <SettingsDialog /> : null}
    </div>
  )
}
