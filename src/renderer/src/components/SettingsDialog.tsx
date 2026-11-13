import { useEffect, useState } from 'react'
import { Cloud, FolderOpen, RefreshCw } from 'lucide-react'
import { iconStroke, themeOrder, themes } from '@shared/tokens'
import type { ReaderFont, ThemeName } from '@shared/tokens'
import { PROVIDER_PRESETS, SETTINGS_LIMITS } from '@shared/constants'
import type { AppSettings, SyncStatus, TestModelResult } from '@shared/types'
import { useApp } from '../store'
import { applyAppearance, errorText, formatCount, unwrap } from '../lib'
import { BusyLine, Dialog, Field } from './ui'

const FONT_OPTIONS: Array<{ value: ReaderFont; label: string }> = [
  { value: 'serif', label: '宋体' },
  { value: 'sans', label: '黑体' },
  { value: 'kai', label: '楷体' },
  { value: 'ui', label: '系统' }
]

interface NumberFieldProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

/**
 * A number input keeps its own text while focused, so clamping min/max does
 * not fight the user mid-typing (turning "12000" into "600" after the first
 * keystroke). The draft still updates live once the value parses, and blur
 * snaps the text back into range.
 */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange
}: NumberFieldProps): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])

  const commit = (raw: string): void => {
    const parsed = Number(raw)
    const next =
      raw.trim() !== '' && Number.isFinite(parsed)
        ? Math.min(max, Math.max(min, Math.round(parsed)))
        : value
    setText(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const parsed = Number(raw)
          if (raw.trim() !== '' && Number.isFinite(parsed)) {
            onChange(Math.min(max, Math.max(min, Math.round(parsed))))
          }
        }}
        onBlur={() => {
          setFocused(false)
          commit(text)
        }}
      />
    </Field>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const settings = useApp((state) => state.settings)
  const usage = useApp((state) => state.usage)
  const dataDir = useApp((state) => state.dataDir)
  const platform = useApp((state) => state.platform)
  const version = useApp((state) => state.version)
  const setSettingsOpen = useApp((state) => state.setSettingsOpen)
  const saveSettings = useApp((state) => state.saveSettings)
  const showToast = useApp((state) => state.showToast)

  const [draft, setDraft] = useState<AppSettings>({ ...settings })
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<TestModelResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const status = await unwrap(window.shiye.syncStatus())
        if (alive) setSyncStatus(status)
      } catch {
        // Sync status is optional; settings still work without it.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const patchDraft = (patch: Partial<AppSettings>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setError('')
  }

  const previewAppearance = (patch: Partial<AppSettings>): void => {
    patchDraft(patch)
    applyAppearance({ ...draft, ...patch })
  }

  const persistAppearance = (patch: Partial<AppSettings>): void => {
    previewAppearance(patch)
    void saveSettings(patch)
  }

  const close = (): void => {
    applyAppearance(settings)
    setSettingsOpen(false)
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await unwrap(
        window.shiye.testModel({
          baseUrl: draft.baseUrl.trim(),
          apiKey: draft.apiKey.trim(),
          model: draft.model.trim()
        })
      )
      setTestResult(result)
    } catch (cause) {
      setTestResult({ ok: false, detail: errorText(cause), latencyMs: 0 })
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    if (draft.provider === 'openai') {
      if (!draft.baseUrl.trim()) {
        setError('接口地址不能为空。')
        return
      }
      if (!draft.model.trim()) {
        setError('模型名称不能为空。')
        return
      }
    }
    if (draft.chapterMin >= draft.chapterMax) {
      setError('单章下限需要小于上限。')
      return
    }
    const saved = await saveSettings({
      provider: draft.provider,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      contextWindow: draft.contextWindow,
      temperature: draft.temperature,
      buffer: draft.buffer,
      chapterMin: draft.chapterMin,
      chapterMax: draft.chapterMax,
      consistencyCheck: draft.consistencyCheck,
      openLastOnLaunch: draft.openLastOnLaunch,
      syncUrl: draft.syncUrl.trim(),
      syncUser: draft.syncUser.trim(),
      syncPassword: draft.syncPassword,
      syncPath: draft.syncPath.trim()
    })
    // Keep the dialog open on failure so the typed values are not lost.
    if (!saved) return
    setSettingsOpen(false)
  }

  const runSync = async (): Promise<void> => {
    if (!draft.syncUrl.trim()) {
      setError('先填写 WebDAV 地址。')
      return
    }
    setSyncing(true)
    setError('')
    try {
      const saved = await saveSettings({
        syncUrl: draft.syncUrl.trim(),
        syncUser: draft.syncUser.trim(),
        syncPassword: draft.syncPassword,
        syncPath: draft.syncPath.trim()
      })
      // Syncing with the old configuration would silently use a stale URL.
      if (!saved) return
      const result = await unwrap(window.shiye.runSync())
      const status = await unwrap(window.shiye.syncStatus())
      setSyncStatus(status)
      await useApp.getState().refreshProjects()
      showToast('info', result.message)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setSyncing(false)
    }
  }

  const openFolder = async (): Promise<void> => {
    try {
      await unwrap(window.shiye.openDataFolder())
    } catch (cause) {
      showToast('error', errorText(cause))
    }
  }

  return (
    <Dialog
      title="设置"
      wide
      onClose={close}
      footer={
        <>
          {error ? <span className="error-text" style={{ marginRight: 'auto' }}>{error}</span> : null}
          <button className="btn btn-quiet" onClick={close}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            保存
          </button>
        </>
      }
    >
      <section className="settings-section">
        <h3 className="settings-title">写作引擎</h3>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button
            aria-pressed={draft.provider === 'builtin'}
            onClick={() => patchDraft({ provider: 'builtin' })}
          >
            内置
          </button>
          <button
            aria-pressed={draft.provider === 'openai'}
            onClick={() => patchDraft({ provider: 'openai' })}
          >
            兼容接口
          </button>
        </div>

        {draft.provider === 'builtin' ? (
          <p className="hint" style={{ margin: 0 }}>
            内置引擎在本机生成，不需要联网，适合先把故事跑通。想要更稳的文风，可以接入外部接口。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="chip-row">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="chip"
                  aria-pressed={preset.baseUrl !== '' && draft.baseUrl === preset.baseUrl}
                  onClick={() => {
                    if (!preset.baseUrl) return
                    setTestResult(null)
                    patchDraft({ baseUrl: preset.baseUrl, model: preset.model })
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <Field label="接口地址" hint="需要兼容 chat/completions 的流式接口。">
              <input
                className="input"
                data-mono="true"
                value={draft.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(event) => patchDraft({ baseUrl: event.target.value })}
              />
            </Field>
            <div className="settings-grid">
              <Field label="密钥">
                <input
                  className="input"
                  type="password"
                  value={draft.apiKey}
                  placeholder="sk-…"
                  onChange={(event) => patchDraft({ apiKey: event.target.value })}
                />
              </Field>
              <Field label="模型">
                <input
                  className="input"
                  data-mono="true"
                  value={draft.model}
                  placeholder="deepseek-chat"
                  onChange={(event) => patchDraft({ model: event.target.value })}
                />
              </Field>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={testing}
                onClick={() => void test()}
              >
                {testing ? <BusyLine text="正在连接" /> : '测试连接'}
              </button>
              {testResult ? (
                <span
                  className={testResult.ok ? 'hint' : 'error-text'}
                  style={{ lineHeight: 1.6 }}
                >
                  {testResult.ok ? '连接正常' : '没有连通'} · {testResult.detail}
                  {testResult.latencyMs > 0 ? ` · ${testResult.latencyMs} ms` : ''}
                </span>
              ) : null}
            </div>
          </div>
        )}

        <div className="settings-grid" style={{ marginTop: 14 }}>
          <NumberField
            label="上下文窗口（tokens）"
            hint="填模型支持的长度。"
            value={draft.contextWindow}
            min={SETTINGS_LIMITS.contextWindowMin}
            max={SETTINGS_LIMITS.contextWindowMax}
            step={1000}
            onChange={(value) => patchDraft({ contextWindow: value })}
          />
          <Field label={`温度 ${draft.temperature.toFixed(2)}`} hint="越高越自由，越低越稳。">
            <input
              className="range"
              type="range"
              min={SETTINGS_LIMITS.temperatureMin}
              max={SETTINGS_LIMITS.temperatureMax}
              step={0.05}
              value={draft.temperature}
              onChange={(event) => patchDraft({ temperature: Number(event.target.value) })}
            />
          </Field>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-title">阅读</h3>
        <div className="theme-row" style={{ marginBottom: 16 }}>
          {themeOrder.map((name: ThemeName) => (
            <button
              key={name}
              className="theme-option"
              data-active={draft.theme === name}
              onClick={() => persistAppearance({ theme: name })}
            >
              <span
                className="theme-swatch"
                style={{ background: themes[name].swatchBg, color: themes[name].swatchInk }}
              >
                文
              </span>
              {themes[name].label}
            </button>
          ))}
        </div>
        <div className="settings-grid">
          <Field label="正文字体">
            <div className="seg" style={{ width: 'fit-content' }}>
              {FONT_OPTIONS.map((font) => (
                <button
                  key={font.value}
                  aria-pressed={draft.readerFont === font.value}
                  onClick={() => persistAppearance({ readerFont: font.value })}
                >
                  {font.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`字号 ${draft.fontSize}px`}>
            <input
              className="range"
              type="range"
              min={SETTINGS_LIMITS.fontSizeMin}
              max={SETTINGS_LIMITS.fontSizeMax}
              step={1}
              value={draft.fontSize}
              onChange={(event) => previewAppearance({ fontSize: Number(event.target.value) })}
              onPointerUp={(event) =>
                void saveSettings({ fontSize: Number(event.currentTarget.value) })
              }
              onKeyUp={(event) =>
                void saveSettings({ fontSize: Number(event.currentTarget.value) })
              }
            />
          </Field>
        </div>
        <div className="switch-row" style={{ marginTop: 14 }}>
          <span>首行缩进</span>
          <button
            className="chip"
            aria-pressed={draft.indent}
            onClick={() => persistAppearance({ indent: !draft.indent })}
          >
            {draft.indent ? '开' : '关'}
          </button>
        </div>
        <div
          className="reader-sample"
          style={{
            marginTop: 14,
            fontFamily: `var(--font-${draft.readerFont})`,
            fontSize: `${draft.fontSize}px`,
            textIndent: draft.indent ? '2em' : '0'
          }}
        >
          雨落在瓦上，声音很轻。她把信纸摊平，又从抽屉里取出一支旧笔。
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-title">生成</h3>
        <div className="switch-row" style={{ marginBottom: 14 }}>
          <div>
            <div>预写章数</div>
            <div className="hint" style={{ marginTop: 2 }}>
              读到哪儿，后面就先备好几章。备得越多，等待越少。
            </div>
          </div>
          <div className="seg">
            {[1, 2, 3].map((value) => (
              <button
                key={value}
                aria-pressed={draft.buffer === value}
                onClick={() => patchDraft({ buffer: value })}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-grid">
          <NumberField
            label="单章下限（字）"
            value={draft.chapterMin}
            min={600}
            max={5000}
            step={100}
            onChange={(value) => patchDraft({ chapterMin: value })}
          />
          <NumberField
            label="单章上限（字）"
            value={draft.chapterMax}
            min={800}
            max={6000}
            step={100}
            onChange={(value) => patchDraft({ chapterMax: value })}
          />
        </div>
        <div className="switch-row" style={{ marginTop: 14 }}>
          <div>
            <div>连贯性核对</div>
            <div className="hint" style={{ marginTop: 2 }}>
              写完一章后，顺手核对人名、时间与能力。
            </div>
          </div>
          <button
            className="chip"
            aria-pressed={draft.consistencyCheck}
            onClick={() => patchDraft({ consistencyCheck: !draft.consistencyCheck })}
          >
            {draft.consistencyCheck ? '开' : '关'}
          </button>
        </div>
        <div className="switch-row" style={{ marginTop: 14 }}>
          <div>
            <div>启动时回到上次的书</div>
            <div className="hint" style={{ marginTop: 2 }}>
              关闭时停在哪一页，下次就回到那一页。
            </div>
          </div>
          <button
            className="chip"
            aria-pressed={draft.openLastOnLaunch}
            onClick={() => patchDraft({ openLastOnLaunch: !draft.openLastOnLaunch })}
          >
            {draft.openLastOnLaunch ? '开' : '关'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-title">多设备同步</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          用一个 WebDAV 目录在电脑、手机之间同步书架。每本书以最后修改为准，
          阅读位置保留本机进度；书签、阅读记录和书架会合并。
        </p>
        <Field label="WebDAV 地址" hint="例如 https://dav.example.com/remote.php/dav/files/name/">
          <input
            className="input"
            data-mono="true"
            value={draft.syncUrl}
            placeholder="https://…"
            onChange={(event) => patchDraft({ syncUrl: event.target.value })}
          />
        </Field>
        <div className="settings-grid" style={{ marginTop: 12 }}>
          <Field label="账号">
            <input
              className="input"
              value={draft.syncUser}
              autoComplete="username"
              onChange={(event) => patchDraft({ syncUser: event.target.value })}
            />
          </Field>
          <Field label="密码 / 应用密码">
            <input
              className="input"
              type="password"
              value={draft.syncPassword}
              autoComplete="current-password"
              onChange={(event) => patchDraft({ syncPassword: event.target.value })}
            />
          </Field>
        </div>
        <Field label="备份文件名" hint="会放在上面的 WebDAV 目录里，默认 shiye-backup.json。">
          <input
            className="input"
            data-mono="true"
            value={draft.syncPath}
            placeholder="shiye-backup.json"
            onChange={(event) => patchDraft({ syncPath: event.target.value })}
          />
        </Field>
        <div className="sync-row">
          <button
            className="btn btn-ghost btn-sm"
            disabled={syncing}
            onClick={() => void runSync()}
          >
            {syncing ? (
              <BusyLine text="正在同步" />
            ) : (
              <>
                <Cloud size={14} strokeWidth={iconStroke} />
                立即同步
              </>
            )}
          </button>
          <button
            className="btn btn-quiet btn-sm"
            disabled={syncing}
            onClick={() =>
              void (async () => {
                try {
                  setSyncStatus(await unwrap(window.shiye.syncStatus()))
                } catch (cause) {
                  showToast('error', errorText(cause))
                }
              })()
            }
          >
            <RefreshCw size={13} strokeWidth={iconStroke} />
            刷新状态
          </button>
          <span className="hint">
            {syncStatus?.configured
              ? syncStatus.lastSyncAt
                ? `上次同步 ${new Date(syncStatus.lastSyncAt).toLocaleString('zh-CN')}`
                : '还没有同步过'
              : '尚未配置'}
            {syncStatus?.lastMessage ? ` · ${syncStatus.lastMessage}` : ''}
          </span>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-title">数据</h3>
        <div className="hint" style={{ wordBreak: 'break-all', marginBottom: 10 }}>
          {dataDir || '本机数据目录'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void openFolder()}>
            <FolderOpen size={14} strokeWidth={iconStroke} />
            {platform === 'android' ? '备份数据' : '打开数据目录'}
          </button>
        </div>
        {platform === 'android' ? (
          <div className="hint" style={{ marginBottom: 10 }}>
            备份会生成一个 .db 文件，可通过系统的分享面板保存到文件或网盘。
          </div>
        ) : null}
        <div className="hint" style={{ lineHeight: 1.9 }}>
          累计请求 {formatCount(usage.requests)} 次，输入 {formatCount(usage.promptTokens)}{' '}
          tokens，输出 {formatCount(usage.completionTokens)} tokens。近三十天{' '}
          {formatCount(usage.last30DaysRequests)} 次。
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          拾页 {version} · {platform}
        </div>
      </section>
    </Dialog>
  )
}
