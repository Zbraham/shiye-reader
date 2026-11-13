import { createRoot } from 'react-dom/client'
import { buildTokenCss } from '@shared/tokens'
import { App } from './App'
import './styles.css'

const tokenStyle = document.createElement('style')
tokenStyle.setAttribute('data-tokens', '')
tokenStyle.textContent = buildTokenCss()
document.head.prepend(tokenStyle)

const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载节点。')

createRoot(container).render(<App />)
