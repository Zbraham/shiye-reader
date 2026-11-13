import type { OpdsEntry, OpdsFeed, RemoteBook } from '@shared/types'
import { IMPORT_LIMITS, parseNovelFile } from '@shared/import'
import { AppError } from './errors'

const REMOTE_LIMIT = IMPORT_LIMITS.fileBytes
const FETCH_TIMEOUT = 25_000

/**
 * Reads a response body with a hard byte ceiling. The abort timer must stay
 * armed until the body is consumed: clearing it when the headers arrive lets a
 * server drip bytes forever and hang the import.
 */
async function readBody(response: Response, limit: number, tooLarge: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > limit) throw new AppError('too_large', tooLarge)
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.length > limit) throw new AppError('too_large', tooLarge)
    return buffer
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.length === 0) continue
      total += value.length
      if (total > limit) {
        await reader.cancel().catch(() => undefined)
        throw new AppError('too_large', tooLarge)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; name: string; contentType: string }> {
  if (!/^https?:\/\//iu.test(url)) {
    throw new AppError('invalid_url', '只支持 http:// 或 https:// 地址。')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/epub+zip,application/octet-stream,text/plain,text/html,*/*'
      }
    })
    if (!response.ok) {
      throw new AppError('http', `下载失败：服务器返回 ${response.status}。`)
    }
    const bytes = await readBody(
      response,
      REMOTE_LIMIT,
      `文件超过 ${REMOTE_LIMIT / 1024 / 1024} MB 上限。`
    )
    return {
      bytes,
      name: nameFromUrl(url, response.headers.get('content-disposition') ?? ''),
      contentType: response.headers.get('content-type') ?? ''
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('timeout', '下载超时，检查网络后再试。')
    }
    throw new AppError('network', '下载失败，检查网络或地址。')
  } finally {
    clearTimeout(timer)
  }
}

function nameFromUrl(url: string, disposition: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]).trim()
    } catch {
      return encoded[1].trim()
    }
  }
  const plain = /filename="?([^";]+)"?/iu.exec(disposition)
  if (plain?.[1]) return plain[1].trim()
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    if (last) return decodeURIComponent(last)
  } catch {
    // Fall through.
  }
  return '远程小说'
}

export async function fetchRemoteBook(url: string, name?: string): Promise<RemoteBook> {
  const fetched = await fetchBytes(url)
  const fileName = (name?.trim() || fetched.name).slice(0, 260)
  // Only trust an extension the importer actually handles. A URL like
  // /book.php used to keep ".php" and fall through to "unsupported format".
  const supported = /\.(?:txt|text|md|markdown|html|htm|epub|docx|fb2|rtf|zip)$/iu.test(fileName)
  const withExtension = supported
    ? fileName
    : guessName(fileName.replace(/\.[a-z0-9]{2,5}$/iu, ''), fetched.contentType, fetched.bytes)
  const book = await parseNovelFile({ name: withExtension, bytes: fetched.bytes })
  return { name: withExtension, book }
}

function guessName(name: string, contentType: string, bytes: Uint8Array): string {
  const type = contentType.toLowerCase()
  // The ZIP magic is stronger than a server's content type. Naming any ZIP
  // ".epub" would make a DOCX or a text bundle fail to parse, so only call it
  // EPUB when the server says so; otherwise let the ZIP reader sniff it.
  const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (zip) {
    if (type.includes('epub')) return `${name}.epub`
    if (type.includes('wordprocessingml') || type.includes('docx')) return `${name}.docx`
    return `${name}.zip`
  }
  if (type.includes('epub')) return `${name}.epub`
  if (type.includes('wordprocessingml') || type.includes('docx')) return `${name}.docx`
  if (type.includes('rtf')) return `${name}.rtf`
  if (type.includes('fictionbook') || type.includes('fb2')) return `${name}.fb2`
  if (type.includes('markdown')) return `${name}.md`
  if (type.includes('html')) return `${name}.html`
  return `${name}.txt`
}

function decodeEntities(text: string): string {
  const map: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  const validCode = (code: number): boolean =>
    Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return validCode(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return validCode(code) ? String.fromCodePoint(code) : match
    }
    return map[body.toLowerCase()] ?? match
  })
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim()
}

function attribute(tag: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu')
  const match = pattern.exec(tag)
  return match ? decodeEntities((match[1] ?? match[2] ?? '').trim()) : ''
}

function resolveUrl(base: string, href: string): string {
  try {
    return new URL(decodeEntities(href), base).toString()
  } catch {
    return ''
  }
}

export async function browseOpds(url: string): Promise<OpdsFeed> {
  if (!/^https?:\/\//iu.test(url)) {
    throw new AppError('invalid_url', '只支持 http:// 或 https:// 地址。')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  let xml: string
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/atom+xml,application/xml,text/xml,*/*' }
    })
    if (!response.ok) {
      throw new AppError('http', `OPDS 服务器返回 ${response.status}。`)
    }
    const bytes = await readBody(response, 4 * 1024 * 1024, 'OPDS 目录太大，已停止读取。')
    xml = new TextDecoder().decode(bytes)
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('timeout', 'OPDS 目录读取超时。')
    }
    throw new AppError('network', '连不上 OPDS 服务器。')
  } finally {
    clearTimeout(timer)
  }

  const feedTitle = stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(xml)?.[1] ?? '') || 'OPDS 目录'
  const entries: OpdsEntry[] = []
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/giu)) {
    const body = match[1] ?? ''
    const entryTitle = stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(body)?.[1] ?? '')
    if (!entryTitle) continue
    const author = stripTags(
      /<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/iu.exec(body)?.[1] ?? ''
    )
    const summary = stripTags(
      (/<summary\b[^>]*>([\s\S]*?)<\/summary>/iu.exec(body) ??
        /<content\b[^>]*>([\s\S]*?)<\/content>/iu.exec(body))?.[1] ?? ''
    ).slice(0, 600)
    let contentUrl = ''
    let coverUrl = ''
    let format = ''
    for (const link of body.matchAll(/<link\b[^>]*>/giu)) {
      const tag = link[0]
      const rel = attribute(tag, 'rel').toLowerCase()
      const type = attribute(tag, 'type').toLowerCase()
      const href = resolveUrl(url, attribute(tag, 'href'))
      if (!href) continue
      if (
        !contentUrl &&
        (rel.includes('acquisition') ||
          type.includes('epub') ||
          type.includes('text/plain') ||
          type.includes('octet-stream'))
      ) {
        contentUrl = href
        format = type.includes('epub') ? 'EPUB' : type.includes('text') ? 'TXT' : '文件'
      }
      if (!coverUrl && (rel.includes('image') || rel.includes('thumbnail') || type.startsWith('image/'))) {
        coverUrl = href
      }
    }
    if (!contentUrl) continue
    entries.push({
      id: stripTags(/<id\b[^>]*>([\s\S]*?)<\/id>/iu.exec(body)?.[1] ?? entryTitle),
      title: entryTitle,
      author,
      summary,
      contentUrl,
      coverUrl,
      format
    })
    if (entries.length >= 80) break
  }

  let nextUrl: string | null = null
  for (const link of xml.matchAll(/<link\b[^>]*>/giu)) {
    const tag = link[0]
    if (attribute(tag, 'rel').toLowerCase() !== 'next') continue
    nextUrl = resolveUrl(url, attribute(tag, 'href')) || null
    break
  }

  return { title: feedTitle, url, entries, nextUrl }
}

export async function importFromOpds(url: string): Promise<RemoteBook> {
  return fetchRemoteBook(url)
}
