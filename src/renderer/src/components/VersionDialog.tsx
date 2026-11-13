import { useEffect, useState } from 'react'
import type { VersionDetail } from '@shared/types'
import { useApp } from '../store'
import { errorText, formatTime, formatWords, unwrap } from '../lib'
import { ProseView } from './ProseView'
import { BusyLine, Dialog } from './ui'

interface VersionDialogProps {
  versionId: string
  onClose: () => void
}

export function VersionDialog({ versionId, onClose }: VersionDialogProps): React.JSX.Element {
  const refreshChapter = useApp((state) => state.refreshChapter)
  const showToast = useApp((state) => state.showToast)
  const [detail, setDetail] = useState<VersionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const version = await unwrap(window.shiye.getVersion(versionId))
        if (alive) setDetail(version)
      } catch (cause) {
        if (alive) setError(errorText(cause))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [versionId])

  const restore = async (): Promise<void> => {
    if (!detail) return
    setBusy(true)
    setError('')
    try {
      const result = await unwrap(
        window.shiye.restoreVersion(detail.chapterId, detail.id)
      )
      await refreshChapter()
      showToast(
        'info',
        result.staleChapters.length > 0
          ? `已经恢复。后面 ${result.staleChapters.length} 章需要校对。`
          : '已经恢复到这个版本。'
      )
      onClose()
    } catch (cause) {
      setError(errorText(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="旧稿"
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          {error ? <span className="error-text" style={{ marginRight: 'auto' }}>{error}</span> : null}
          {confirming ? (
            <>
              <span className="hint" style={{ marginRight: 'auto' }}>
                当前正文会被这一版替换。
              </span>
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                再想想
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void restore()}
              >
                {busy ? <BusyLine text="正在恢复" /> : '确认恢复'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-quiet" disabled={busy} onClick={onClose}>
                关闭
              </button>
              <button
                className="btn btn-ghost"
                disabled={!detail || busy}
                onClick={() => setConfirming(true)}
              >
                恢复这一版
              </button>
            </>
          )}
        </>
      }
    >
      {loading ? (
        <BusyLine text="正在取回旧稿" />
      ) : !detail ? (
        <p className="hint" style={{ margin: 0 }}>
          这个版本已经不在了。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="hint" style={{ lineHeight: 1.9 }}>
            {formatTime(detail.createdAt)} · {detail.reason || '存档'} ·{' '}
            {formatWords(detail.beforeWordCount)} 变为 {formatWords(detail.afterWordCount)}
          </div>
          <ProseView content={detail.content} streaming={false} />
        </div>
      )}
    </Dialog>
  )
}
