import { finalizeChapters } from './chapters'
import { decodeNovelBytes } from './decode'
import { splitHtmlDocument, xhtmlToBlocks } from './html-chapters'
import { bytesToBase64, cleanInline, decodeEntities, isDataImageUrl } from './sanitize'
import { IMPORT_LIMITS, ImportError, type ParsedChapter } from './types'
import { openZip, type ZipArchive } from './zip'

export { decodeEntities }
export { xhtmlToBlocks }
export type { Block } from './html-chapters'

export interface EpubBook {
  title: string
  author?: string
  description?: string
  language?: string
  publisher?: string
  series?: string
  tags?: string[]
  coverData?: string
  chapters: ParsedChapter[]
  warnings: string[]
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties: string
}

interface OpfData {
  title: string
  author: string
  description: string
  language: string
  publisher: string
  series: string
  tags: string[]
  coverId: string
  items: Map<string, ManifestItem>
  spine: { id: string; linear: boolean }[]
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024
// The IPC schema caps coverData at 400_000 characters; base64 expands by 4/3.
const MAX_COVER_BYTES = 280_000

function attribute(tag: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu')
  const match = pattern.exec(tag)
  if (!match) return ''
  return decodeEntities(match[1] ?? match[2] ?? '').trim()
}

function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
    } else {
      stack.push(part)
    }
  }
  return stack.join('/')
}

function resolveHref(baseDir: string, href: string): string | null {
  let raw = href.split('#')[0]?.trim() ?? ''
  if (!raw) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(raw)) return null
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // Keep the raw href when it is not valid percent-encoding.
  }
  return normalizePath(baseDir ? `${baseDir}/${raw}` : raw)
}

function dirOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(0, index) : ''
}

function warnOnce(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message)
}

function imageMediaType(path: string, declared: string): string | null {
  const normalized = (declared.split(';')[0] ?? '').trim().toLowerCase()
  if (normalized === 'image/jpg' || normalized === 'image/jpeg') return 'image/jpeg'
  if (
    normalized === 'image/png' ||
    normalized === 'image/gif' ||
    normalized === 'image/webp' ||
    normalized === 'image/svg+xml'
  ) {
    return normalized
  }
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  return null
}

function elementText(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'iu')
  const match = pattern.exec(xml)
  return match ? cleanInline(match[1] ?? '') : ''
}

function drmProtected(archive: ZipArchive): Promise<boolean> {
  if (!archive.has('META-INF/encryption.xml')) return Promise.resolve(false)
  return archive
    .readText('META-INF/encryption.xml')
    .then((xml) => {
      const refs = Array.from(xml.matchAll(/<CipherReference\b[^>]*>/giu))
      return refs.some((match) => {
        const uri = attribute(match[0] ?? '', 'URI')
        return /\.(?:x?html?|opf|ncx)$/iu.test(uri)
      })
    })
    .catch(() => true)
}

function parseContainer(xml: string): string | null {
  const match = /<rootfile\b[^>]*>/iu.exec(xml)
  if (!match) return null
  const path = attribute(match[0], 'full-path')
  return path || null
}

function seriesFromMetadata(metadata: string): string {
  for (const match of metadata.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0] ?? ''
    const name = attribute(tag, 'name').toLowerCase()
    const property = attribute(tag, 'property').toLowerCase()
    const content = attribute(tag, 'content')
    if (name === 'calibre:series' && content) return content.slice(0, 80)
    if (property === 'belongs-to-collection' && content) return content.slice(0, 80)
  }
  const belongs =
    /<meta\b[^>]*property\s*=\s*["']belongs-to-collection["'][^>]*>([\s\S]*?)<\/meta>/iu.exec(
      metadata
    )
  return belongs ? cleanInline(belongs[1] ?? '').slice(0, 80) : ''
}

function parseOpf(xml: string): OpfData {
  const metadataMatch = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/iu.exec(xml)
  const metadata = metadataMatch?.[1] ?? xml

  const creators = Array.from(
    metadata.matchAll(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/giu),
    (match) => cleanInline(match[1] ?? '')
  ).filter(Boolean)

  const tags: string[] = []
  for (const match of metadata.matchAll(/<dc:subject\b[^>]*>([\s\S]*?)<\/dc:subject>/giu)) {
    const value = cleanInline(match[1] ?? '').slice(0, 24)
    if (value && !tags.includes(value) && tags.length < 12) tags.push(value)
  }

  let coverId = ''
  for (const match of metadata.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0] ?? ''
    if (attribute(tag, 'name').toLowerCase() === 'cover') {
      coverId = attribute(tag, 'content')
      if (coverId) break
    }
  }

  const items = new Map<string, ManifestItem>()
  for (const match of xml.matchAll(/<item\b[^>]*>/giu)) {
    const tag = match[0] ?? ''
    const id = attribute(tag, 'id')
    const href = attribute(tag, 'href')
    if (!id || !href) continue
    items.set(id, {
      id,
      href,
      mediaType: attribute(tag, 'media-type').toLowerCase(),
      properties: attribute(tag, 'properties')
    })
  }

  const spine: { id: string; linear: boolean }[] = []
  for (const match of xml.matchAll(/<itemref\b[^>]*>/giu)) {
    const tag = match[0] ?? ''
    const idref = attribute(tag, 'idref')
    if (idref) {
      spine.push({
        id: idref,
        linear: attribute(tag, 'linear').toLowerCase() !== 'no'
      })
    }
  }

  return {
    title: elementText(metadata, 'dc:title'),
    author: creators.join('、').slice(0, 80),
    description: elementText(metadata, 'dc:description'),
    language: elementText(metadata, 'dc:language').slice(0, 30),
    publisher: elementText(metadata, 'dc:publisher').slice(0, 80),
    series: seriesFromMetadata(metadata),
    tags,
    coverId,
    items,
    spine
  }
}

async function buildImageMap(
  html: string,
  documentPath: string,
  archive: ZipArchive,
  mediaByPath: Map<string, string>,
  budget: { used: number },
  warnings: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  // Inline base64 makes the chapter HTML grow ~4/3 the image size. Keep the
  // rendered document under the IPC bound, otherwise an illustrated book that
  // imported fine would be rejected when the dialog saves it.
  let rendered = html.length
  const pattern = /<img\b[^>]*>/giu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0] ?? ''
    const src = attribute(tag, 'src')
    if (!src || map.has(src)) continue
    if (isDataImageUrl(src)) continue
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(src)) continue
    const path = resolveHref(dirOf(documentPath), src)
    if (!path || !archive.has(path)) continue
    const media = imageMediaType(path, mediaByPath.get(path) ?? '')
    if (!media) continue

    let data: Uint8Array
    try {
      data = await archive.read(path)
    } catch {
      continue
    }
    if (data.length === 0) continue
    if (data.length > MAX_IMAGE_BYTES) {
      warnOnce(warnings, '部分插图超过 2 MB，已跳过。')
      continue
    }
    if (budget.used + data.length > MAX_TOTAL_IMAGE_BYTES) {
      warnOnce(warnings, '插图总量超过 12 MB，后续图片已跳过。')
      continue
    }
    const dataUrl = `data:${media};base64,${bytesToBase64(data)}`
    if (rendered + dataUrl.length - src.length > IMPORT_LIMITS.chapterHtmlChars) {
      warnOnce(warnings, '本章插图过多，超出单章上限的部分已跳过。')
      continue
    }
    budget.used += data.length
    rendered += dataUrl.length - src.length
    map.set(src, dataUrl)
  }
  return map
}

async function extractCover(
  archive: ZipArchive,
  opf: OpfData,
  baseDir: string,
  warnings: string[]
): Promise<string | null> {
  let item: ManifestItem | undefined
  for (const candidate of opf.items.values()) {
    if (candidate.properties.split(/\s+/u).includes('cover-image')) {
      item = candidate
      break
    }
  }
  if (!item && opf.coverId) item = opf.items.get(opf.coverId)
  if (!item) return null

  const path = resolveHref(baseDir, item.href)
  if (!path || !archive.has(path)) return null
  const media = imageMediaType(path, item.mediaType)
  if (!media) return null
  try {
    const data = await archive.read(path)
    if (data.length === 0) return null
    if (data.length > MAX_COVER_BYTES) {
      warnings.push('封面图片过大，已跳过。')
      return null
    }
    return `data:${media};base64,${bytesToBase64(data)}`
  } catch {
    return null
  }
}

export async function parseEpub(bytes: Uint8Array): Promise<EpubBook> {
  const archive = await openZip(bytes)
  if (await drmProtected(archive)) {
    throw new ImportError('这个 EPUB 带有加密保护（DRM），无法导入。')
  }

  const containerPath = 'META-INF/container.xml'
  if (!archive.has(containerPath)) {
    throw new ImportError('这个 EPUB 缺少 META-INF/container.xml，无法读取。')
  }
  const containerXml = await archive.readText(containerPath)
  const opfPath = parseContainer(containerXml)
  if (!opfPath || !archive.has(opfPath)) {
    throw new ImportError('这个 EPUB 的 OPF 文件缺失，无法读取。')
  }
  const opf = parseOpf(await archive.readText(opfPath))
  const baseDir = dirOf(opfPath)
  const warnings: string[] = []

  const mediaByPath = new Map<string, string>()
  for (const item of opf.items.values()) {
    const path = resolveHref(baseDir, item.href)
    if (path && item.mediaType) mediaByPath.set(path, item.mediaType)
  }

  const ordered: { path: string; item: ManifestItem }[] = []
  for (const ref of opf.spine) {
    if (!ref.linear) continue
    const item = opf.items.get(ref.id)
    if (!item) continue
    if (item.properties.split(/\s+/u).includes('nav')) continue
    const path = resolveHref(baseDir, item.href)
    if (!path || !archive.has(path)) continue
    ordered.push({ path, item })
  }
  if (ordered.length === 0) {
    for (const item of opf.items.values()) {
      if (!/x?html?/u.test(item.mediaType)) continue
      const path = resolveHref(baseDir, item.href)
      if (path && archive.has(path)) ordered.push({ path, item })
    }
    if (ordered.length === 0) {
      throw new ImportError('这个 EPUB 的阅读顺序为空，找不到正文。')
    }
    warnings.push('EPUB 的 spine 为空，已按清单顺序读取正文。')
  }

  const budget = { used: 0 }
  const chapters: ParsedChapter[] = []
  let volume: string | undefined
  for (const entry of ordered) {
    let html = ''
    try {
      html = decodeNovelBytes(await archive.read(entry.path)).text
    } catch (error) {
      if (error instanceof ImportError) throw error
      // Silently dropping a spine document made chapters disappear from an
      // otherwise "successful" import with no explanation.
      warnOnce(warnings, 'EPUB 里有正文页无法读取，已跳过。')
      continue
    }
    const imageMap = await buildImageMap(
      html,
      entry.path,
      archive,
      mediaByPath,
      budget,
      warnings
    )
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
    const docTitle = titleMatch ? cleanInline(titleMatch[1] ?? '') : ''
    const fallback = docTitle || entry.path.replace(/^.*\//u, '').replace(/\.[^.]+$/u, '')
    const split = splitHtmlDocument(html, {
      fallbackTitle: fallback,
      imageMap,
      ...(volume ? { volume } : {})
    })
    chapters.push(...split.chapters)
    if (split.volume) volume = split.volume
  }

  if (chapters.length === 0) throw new ImportError('这个 EPUB 里没有可阅读的文字。')
  const clean = finalizeChapters(chapters)
  if (clean.length < chapters.length) {
    warnings.push('部分空白页或重复页已跳过。')
  }
  const coverData = await extractCover(archive, opf, baseDir, warnings)

  return {
    title: opf.title || '未命名',
    ...(opf.author ? { author: opf.author } : {}),
    ...(opf.description ? { description: opf.description } : {}),
    ...(opf.language ? { language: opf.language } : {}),
    ...(opf.publisher ? { publisher: opf.publisher } : {}),
    ...(opf.series ? { series: opf.series } : {}),
    ...(opf.tags.length > 0 ? { tags: opf.tags } : {}),
    ...(coverData ? { coverData } : {}),
    chapters: clean,
    warnings
  }
}
