import { splitContent } from '../text'

/**
 * Snaps a selection offset to the end of the paragraph containing it. Returns
 * `content.length` when the paragraph is the last one — callers should reject
 * that, since there would be nothing left to rewrite in the anchor chapter.
 */
export function snapParagraphEnd(content: string, offset: number): number {
  if (!content) return 0
  const target = Math.min(content.length, Math.max(0, Math.floor(offset)))
  if (target <= 0) return 0
  const paragraphs = splitContent(content)
  for (const paragraph of paragraphs) {
    if (target <= paragraph.end) return paragraph.end
  }
  return content.length
}
