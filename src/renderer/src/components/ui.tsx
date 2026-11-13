import { useEffect } from 'react'
import { X } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import { onBack } from '../back'

interface DialogProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}

export function Dialog({ title, onClose, children, footer, wide }: DialogProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => onBack(onClose), [onClose])

  return (
    <div
      className="overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="dialog"
        data-wide={wide ? 'true' : 'false'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={16} strokeWidth={iconStroke} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
  hint?: string
}

export function Field({ label, children, hint }: FieldProps): React.JSX.Element {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function BusyLine({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="loading-line">
      {text}
      <span className="quiet-caret" />
    </span>
  )
}

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
