import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import '@fontsource-variable/noto-serif-sc'
import '@fontsource-variable/noto-sans-sc'
import kaiUrl from '@fontsource/lxgw-wenkai/files/lxgw-wenkai-latin-500-normal.woff2?url'
import { buildTokenCss } from '@shared/tokens'
import { App } from '@renderer/App'
import '@renderer/styles.css'
import './mobile.css'
import { initPlatform } from './platform/bridge'

document.documentElement.dataset['platform'] = 'android'

const tokenStyle = document.createElement('style')
tokenStyle.setAttribute('data-tokens', '')
tokenStyle.textContent = buildTokenCss()
document.head.prepend(tokenStyle)

// The desktop tokens prefer fonts that ship with macOS/Windows. On Android
// those never resolve, so point every stack at the bundled Noto families.
const fontFaces = document.createElement('style')
fontFaces.textContent = `@font-face{font-family:'LXGW WenKai';font-style:normal;font-weight:500;font-display:swap;src:url(${JSON.stringify(
  kaiUrl
)}) format('woff2');}`
document.head.appendChild(fontFaces)

const rootStyle = document.documentElement.style
rootStyle.setProperty(
  '--font-ui',
  '"Noto Sans SC Variable", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif'
)
rootStyle.setProperty(
  '--font-sans',
  '"Noto Sans SC Variable", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif'
)
rootStyle.setProperty(
  '--font-serif',
  '"Noto Serif SC Variable", "Noto Serif SC", "Source Han Serif SC", serif'
)
rootStyle.setProperty(
  '--font-kai',
  '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif'
)

const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载节点。')
const root = createRoot(container)

function FatalError({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '40px 28px',
        textAlign: 'center'
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 22,
          fontWeight: 500,
          margin: 0
        }}
      >
        拾页没能启动
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: 420,
          color: 'var(--color-muted)',
          fontSize: 14,
          lineHeight: 1.8
        }}
      >
        {message}
      </p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        重新打开
      </button>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return '本地数据加载失败。请重新打开应用，若仍然失败可尝试清除应用数据。'
}

async function start(): Promise<void> {
  try {
    await initPlatform()
    root.render(<App />)
  } catch (error) {
    root.render(<FatalError message={errorMessage(error)} />)
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void SplashScreen.hide().catch(() => undefined)
    })
  })

  if (Capacitor.isNativePlatform()) {
    void Keyboard.addListener('keyboardWillShow', () => {
      window.setTimeout(() => {
        const active = document.activeElement
        if (active instanceof HTMLElement) {
          active.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }, 180)
    })
  }
}

void start()
