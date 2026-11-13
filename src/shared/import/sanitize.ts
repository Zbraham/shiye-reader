/**
 * Small, dependency-free HTML sanitiser used by the rich EPUB/HTML importers.
 *
 * This is deliberately an allow-list rather than a block-list: only known
 * inline/block tags survive, and the only attributes kept are `img` sources
 * that are already data URLs and same-document `a href="#..."` links.
 */

const DROP_WITH_CONTENT = [
  'script',
  'style',
  'svg',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'head',
  'title'
] as const

const ALLOWED_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'em',
  'strong',
  'i',
  'b',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'blockquote',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'figure',
  'figcaption',
  'img',
  'a',
  'span',
  'ruby',
  'rt',
  'rp',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'caption'
])

const VOID_TAGS = new Set(['br', 'hr', 'img'])

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/iu

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  times: '×',
  copy: '©',
  reg: '®',
  bull: '•',
  deg: '°',
  laquo: '«',
  raquo: '»',
  zhcy: 'ж',
  shy: ''
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

export function stripTags(text: string): string {
  return text.replace(/<[^>]*>/gu, '')
}

/** Converts inline HTML to a plain, single-line title/label. */
export function cleanInline(html: string): string {
  return decodeEntities(stripTags(html))
    .replace(/ /gu, ' ')
    .replace(/[ \t\r\n]+/gu, ' ')
    .trim()
}

export function extractBodyHtml(html: string): string {
  const match = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(html)
  return match?.[1] ?? html
}

/** Removes elements that must never reach the reader, including their text. */
export function removeUnsafeElements(html: string): string {
  let output = html.replace(/<!--[\s\S]*?-->/gu, '')
  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'giu')
    output = output.replace(paired, '')
  }
  // Any leftover opening/closing/self-closing tags for removed elements.
  const names = DROP_WITH_CONTENT.join('|')
  output = output.replace(new RegExp(`<\\/?\\s*(?:${names})\\b[^>]*>`, 'giu'), '')
  // An unclosed script/style would otherwise leak its source as body text.
  for (const tag of ['script', 'style'] as const) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'iu'), '')
  }
  return output
}

function escapeText(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const name = (match[1] ?? '').toLowerCase()
    if (!name) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attributes.set(name, decodeEntities(value).trim())
  }
  return attributes
}

export function isDataImageUrl(value: string): boolean {
  return DATA_IMAGE.test(value.trim())
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    output += alphabet.charAt((chunk >>> 18) & 63)
    output += alphabet.charAt((chunk >>> 12) & 63)
    output += second === undefined ? '=' : alphabet.charAt((chunk >>> 6) & 63)
    output += third === undefined ? '=' : alphabet.charAt(chunk & 63)
  }
  return output
}

export interface SanitizeOptions {
  /** Maps the raw `src` of an `<img>` to an inlined data URL. */
  imageMap?: Map<string, string>
}

interface ParsedTag {
  closing: boolean
  selfClosing: boolean
  name: string
  attributes: Map<string, string>
}

function parseTag(token: string): ParsedTag | null {
  if (/^<\s*[!?]/u.test(token)) return null
  const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:_-]*)([\s\S]*?)>$/u.exec(token)
  if (!match) return null
  const name = (match[2] ?? '').toLowerCase()
  if (!name) return null
  const rawAttributes = (match[3] ?? '').replace(/\/\s*$/u, '')
  return {
    closing: (match[1] ?? '') === '/',
    selfClosing: /\/\s*>$/u.test(token),
    name,
    attributes: attributesOf(rawAttributes)
  }
}

function sanitizedImage(tag: ParsedTag, options: SanitizeOptions): string {
  const rawSrc = tag.attributes.get('src') ?? ''
  if (!rawSrc) return ''
  const mapped = options.imageMap?.get(rawSrc) ?? rawSrc
  if (!isDataImageUrl(mapped)) return ''
  const parts = [`<img src="${escapeAttribute(mapped.trim())}"`]
  const alt = tag.attributes.get('alt')
  if (alt) parts.push(` alt="${escapeAttribute(alt)}"`)
  const title = tag.attributes.get('title')
  if (title) parts.push(` title="${escapeAttribute(title)}"`)
  parts.push('>')
  return parts.join('')
}

/**
 * Sanitises a chapter fragment. Unknown tags are unwrapped (their text is
 * kept), while known dangerous elements are removed together with content.
 */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const source = removeUnsafeElements(html)
  const pattern = /<[^>]*>/gu
  const anchors: boolean[] = []
  let output = ''
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    const index = match.index
    if (index > cursor) output += escapeText(decodeEntities(source.slice(cursor, index)))
    cursor = index + (match[0]?.length ?? 0)

    const tag = parseTag(match[0] ?? '')
    if (!tag) continue

    if (tag.closing) {
      if (tag.name === 'a') {
        const emitted = anchors.pop()
        if (emitted === true) output += '</a>'
        continue
      }
      if (ALLOWED_TAGS.has(tag.name) && !VOID_TAGS.has(tag.name)) {
        output += `</${tag.name}>`
      }
      continue
    }

    if (tag.name === 'img') {
      output += sanitizedImage(tag, options)
      continue
    }

    if (tag.name === 'a') {
      const href = tag.attributes.get('href') ?? ''
      const title = tag.attributes.get('title') ?? ''
      if (!href.startsWith('#')) {
        // External/relative links lose their href; their text is kept.
        anchors.push(false)
        continue
      }
      const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : ''
      output += `<a href="${escapeAttribute(href)}"${titleAttribute}>`
      anchors.push(true)
      continue
    }

    if (!ALLOWED_TAGS.has(tag.name)) continue
    if (tag.name === 'br' || tag.name === 'hr') {
      output += `<${tag.name}>`
      continue
    }
    output += `<${tag.name}>`
    if (tag.selfClosing) output += `</${tag.name}>`
  }

  if (cursor < source.length) {
    output += escapeText(decodeEntities(source.slice(cursor)))
  }
  return output
}
