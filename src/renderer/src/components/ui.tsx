import { useEffect, useRef } from 'react'
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
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Move focus into the dialog and hand it back when it closes, so keyboard
  // and screen-reader users are not stranded behind the overlay. Tab is kept
  // inside the dialog while it is open.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialogRef.current
    if (node && !node.contains(document.activeElement)) node.focus()
    return () => {
      if (previous && previous.isConnected) previous.focus()
    }
  }, [])

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const node = dialogRef.current
    if (!node) return
    const focusable = Array.from(
      node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((item) => item.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

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
        ref={dialogRef}
        className="dialog"
        data-wide={wide ? 'true' : 'false'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={trapFocus}
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
