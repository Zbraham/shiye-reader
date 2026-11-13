import { useCallback, useEffect, useMemo, useRef } from 'react'
import { splitContent } from '../lib'

export interface TextSelection {
  start: number
  end: number
  text: string
  rect: DOMRect
}

interface ProseViewProps {
  content: string
  streaming: boolean
  onSelect?: (selection: TextSelection) => void
}

function closestParagraph(node: Node | null, root: HTMLElement): HTMLParagraphElement | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (
      current instanceof HTMLParagraphElement &&
      current.dataset['start'] !== undefined
    ) {
      return current
    }
    current = current.parentNode
  }
  return null
}

function offsetWithin(
  paragraph: HTMLParagraphElement,
  node: Node,
  offset: number
): number {
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

export function ProseView({
  content,
  streaming,
  onSelect
}: ProseViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const paragraphs = useMemo(() => splitContent(content), [content])
  const lastIndex = paragraphs.length - 1
  const lastIsSeparator = lastIndex >= 0 && paragraphs[lastIndex]?.separator === true

  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  const readSelection = useCallback((): void => {
    const notify = selectRef.current
    if (!notify || streamingRef.current) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const root = rootRef.current
    if (!root) return
    const range = selection.getRangeAt(0)
    const anchor = closestParagraph(range.startContainer, root)
    const focus = closestParagraph(range.endContainer, root)
    if (!anchor || !focus || anchor !== focus) return
    if (!root.contains(anchor)) return
    const text = range.toString()
    if (!text.trim()) return
    const paragraphStart = Number(anchor.dataset['start'] ?? '0')
    const left = offsetWithin(anchor, range.startContainer, range.startOffset)
    const right = offsetWithin(anchor, range.endContainer, range.endOffset)
    const start = paragraphStart + Math.min(left, right)
    const end = paragraphStart + Math.max(left, right)
    if (end - start < 1) return
    const rect = range.getBoundingClientRect()
    notify({
      start,
      end,
      text,
      rect: rect.width > 0 && rect.height > 0 ? rect : anchor.getBoundingClientRect()
    })
  }, [])

  // Touch selection changes as the user drags the native handles, without a
  // mouseup or keyup. Debounce just enough to let the range settle.
  useEffect(() => {
    let timer: number | undefined
    const schedule = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(readSelection, 140)
    }
    document.addEventListener('selectionchange', schedule)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', schedule)
    }
  }, [readSelection])

  return (
    <div
      className="prose"
      ref={rootRef}
      onMouseUp={readSelection}
      onKeyUp={(event) => {
        if (event.shiftKey || event.key === 'Shift') readSelection()
      }}
    >
      {paragraphs.length === 0 ? (
        <p className="caret-line">
          <span className="caret" />
        </p>
      ) : (
        paragraphs.map((paragraph, index) =>
          paragraph.separator ? (
            <p className="scene-sep" key={paragraph.start} data-start={paragraph.start}>
              {paragraph.text}
            </p>
          ) : (
            <p key={paragraph.start} data-start={paragraph.start}>
              {paragraph.text}
              {streaming && index === lastIndex ? <span className="caret" /> : null}
            </p>
          )
        )
      )}
      {streaming && lastIsSeparator ? (
        <p className="caret-line">
          <span className="caret" />
        </p>
      ) : null}
    </div>
  )
}
