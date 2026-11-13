import { useCallback, useEffect, useMemo, useRef } from 'react'
import { sanitizeHtml } from '@shared/import/sanitize'
import { convertText, type ConvertMode } from '@shared/convert'
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
  html?: string
  convert?: ConvertMode
  onSelect?: (selection: TextSelection) => void
}

function convertHtml(html: string, mode: ConvertMode): string {
  if (mode === 'none') return html
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const text = node.nodeValue ?? ''
      if (text.trim()) node.nodeValue = convertText(text, mode)
      node = walker.nextNode()
    }
    return doc.body.innerHTML
  } catch {
    return html
  }
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

function inverseMode(mode: ConvertMode): ConvertMode {
  if (mode === 's2t') return 't2s'
  if (mode === 't2s') return 's2t'
  return 'none'
}

function nearestMatch(
  content: string,
  needle: string,
  expected: number
): { start: number; end: number } | null {
  if (!needle) return null
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let from = 0
  while (from <= content.length) {
    const found = content.indexOf(needle, from)
    if (found < 0) break
    const distance = Math.abs(found - expected)
    if (distance < bestDistance) {
      best = found
      bestDistance = distance
    }
    from = found + Math.max(1, needle.length)
  }
  return best < 0 ? null : { start: best, end: best + needle.length }
}

/**
 * Maps a selection back to offsets in the plain chapter text. When the page is
 * showing converted (or rich, converted) text the selected glyphs may not exist
 * verbatim in the source, so the needle is converted back first.
 *
 * Returns null instead of guessing: a wrong offset used to make 润色/改写
 * replace the chapter opening instead of the paragraph the reader selected.
 */
function locateText(
  content: string,
  text: string,
  hintRatio: number,
  convert: ConvertMode
): { start: number; end: number } | null {
  const needle = text.trim()
  if (!needle) return null
  const expected = Math.round(hintRatio * content.length)
  const found = nearestMatch(content, needle, expected)
  if (found) return found
  const inverse = inverseMode(convert)
  if (inverse === 'none') return null
  const restored = convertText(needle, inverse).trim()
  if (!restored || restored === needle) return null
  return nearestMatch(content, restored, expected)
}

export function ProseView({
  content,
  streaming,
  html,
  convert = 'none',
  onSelect
}: ProseViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const display = useMemo(
    () => (streaming ? content : convertText(content, convert)),
    [content, convert, streaming]
  )
  const paragraphs = useMemo(() => splitContent(display), [display])
  const lastIndex = paragraphs.length - 1
  const lastIsSeparator = lastIndex >= 0 && paragraphs[lastIndex]?.separator === true
  const converted = display !== content

  const rich = useMemo(() => {
    const source = html?.trim() ?? ''
    if (!source || streaming) return ''
    return convertHtml(sanitizeHtml(source), convert)
  }, [html, streaming, convert])

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
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const text = range.toString()
    if (!text.trim()) return
    const rect = range.getBoundingClientRect()

    if (rich || converted) {
      const before = document.createRange()
      before.selectNodeContents(root)
      before.setEnd(range.startContainer, range.startOffset)
      const hint = root.textContent?.length
        ? before.toString().length / Math.max(1, root.textContent.length)
        : 0
      const located = locateText(content, text, hint, convert)
      if (!located) return
      notify({
        start: located.start,
        end: located.end,
        text,
        rect:
          rect.width > 0 && rect.height > 0
            ? rect
            : root.getBoundingClientRect()
      })
      return
    }

    const anchor = closestParagraph(range.startContainer, root)
    const focus = closestParagraph(range.endContainer, root)
    if (!anchor || !focus || anchor !== focus) return
    const paragraphStart = Number(anchor.dataset['start'] ?? '0')
    const left = offsetWithin(anchor, range.startContainer, range.startOffset)
    const right = offsetWithin(anchor, range.endContainer, range.endOffset)
    const start = paragraphStart + Math.min(left, right)
    const end = paragraphStart + Math.max(left, right)
    if (end - start < 1) return
    notify({
      start,
      end,
      text,
      rect: rect.width > 0 && rect.height > 0 ? rect : anchor.getBoundingClientRect()
    })
  }, [content, rich, converted, convert])

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

  if (rich) {
    return (
      <div
        className="prose prose-rich"
        data-rich="true"
        ref={rootRef}
        onMouseUp={readSelection}
        onKeyUp={(event) => {
          if (event.shiftKey || event.key === 'Shift') readSelection()
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: rich }} />
      </div>
    )
  }

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
