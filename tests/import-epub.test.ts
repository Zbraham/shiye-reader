import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseEpub } from '@shared/import/epub'
import { IMPORT_LIMITS } from '@shared/import/types'
import { openZip } from '@shared/import/zip'

interface ZipFile {
  name: string
  data: string
  method?: 0 | 8 | 99
  flags?: number
  nameBytes?: number[]
  /** Overrides the declared uncompressed size in both headers. */
  declaredSize?: number
  /** Replaces the bytes stored after the local header (for corrupt input). */
  storedOverride?: number[]
}

async function withZipLimits(
  overrides: { zipEntryBytes?: number; zipTotalBytes?: number },
  run: () => Promise<void>
): Promise<void> {
  const limits = IMPORT_LIMITS as unknown as { zipEntryBytes: number; zipTotalBytes: number }
  const original = { zipEntryBytes: limits.zipEntryBytes, zipTotalBytes: limits.zipTotalBytes }
  Object.assign(limits, overrides)
  try {
    await run()
  } finally {
    Object.assign(limits, original)
  }
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ]
}

/** Minimal ZIP writer: no CRC (the reader never checks it), stored or deflate. */
function buildZip(files: ZipFile[]): { bytes: Uint8Array; eocdOffset: number } {
  const locals: number[] = []
  const central: number[] = []
  const nameBytes = (name: string): number[] =>
    Array.from(new TextEncoder().encode(name))

  for (const file of files) {
    const name = file.nameBytes ?? nameBytes(file.name)
    const raw = Array.from(new TextEncoder().encode(file.data))
    const method = file.method ?? 8
    const stored =
      file.storedOverride ??
      (method === 8 ? Array.from(deflateRawSync(file.data)) : raw)
    const flags = file.flags ?? 0x0800
    const declaredSize = file.declaredSize ?? raw.length
    const offset = locals.length
    locals.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(stored.length),
      ...u32(declaredSize),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...stored
    )
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(flags),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(stored.length),
      ...u32(declaredSize),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name
    )
  }

  const directoryOffset = locals.length
  const directorySize = central.length
  const eocdOffset = directoryOffset + directorySize
  const bytes = new Uint8Array([
    ...locals,
    ...central,
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(directorySize),
    ...u32(directoryOffset),
    ...u16(0)
  ])
  return { bytes, eocdOffset }
}

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata><dc:title>雨夜来信</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`

const CH1 = `<html><head><title>第一章 雨</title></head><body>
<h1>第一章 雨</h1>
<p>雨落在瓦上&amp;很轻。</p>
<p>她数着&#x96E8;声。</p>
</body></html>`

const CH2 = `<html><head><title>第二章 北站</title></head><body>
<h1>第二章 北站</h1>
<p>广播里念出了她的名字。</p>
</body></html>`

function baseFiles(extra: ZipFile[] = []): ZipFile[] {
  return [
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: CONTAINER, method: 0 },
    { name: 'OEBPS/content.opf', data: OPF },
    { name: 'OEBPS/nav.xhtml', data: '<html><body><nav>目录</nav></body></html>' },
    { name: 'OEBPS/text/ch1.xhtml', data: CH1 },
    { name: 'OEBPS/text/ch 2.xhtml', data: CH2 },
    ...extra
  ]
}

describe('EPUB parsing', () => {
  it('reads the spine, nested paths and entities in order', async () => {
    const { bytes } = buildZip(baseFiles())
    const book = await parseEpub(bytes)
    expect(book.title).toBe('雨夜来信')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 雨',
      '第二章 北站'
    ])
    expect(book.chapters[0]?.content).toContain('雨落在瓦上&很轻。')
    expect(book.chapters[0]?.content).toContain('她数着雨声。')
    expect(book.chapters[1]?.content).toContain('广播里念出了她的名字。')
  })

  it('skips the nav document', async () => {
    const { bytes } = buildZip(baseFiles())
    const book = await parseEpub(bytes)
    expect(book.chapters.some((chapter) => chapter.content.includes('目录'))).toBe(false)
  })

  it('skips spine items marked linear="no"', async () => {
    const opf = OPF.replace(
      '</manifest>',
      '<item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/></manifest>'
    ).replace('</spine>', '<itemref idref="notes" linear="no"/></spine>')
    const files = baseFiles([
      {
        name: 'OEBPS/text/notes.xhtml',
        data: '<html><body><h1>注释</h1><p>这条不该出现在正文里。</p></body></html>'
      }
    ]).map((file) =>
      file.name === 'OEBPS/content.opf' ? { ...file, data: opf } : file
    )
    const book = await parseEpub(buildZip(files).bytes)
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters.some((chapter) => chapter.content.includes('不该出现'))).toBe(false)
  })

  it('rejects content DRM but ignores font obfuscation', async () => {
    const fontEncryption = `<?xml version="1.0"?><encryption>
      <EncryptedData><CipherData><CipherReference URI="OEBPS/fonts/a.otf"/></CipherData></EncryptedData>
    </encryption>`
    const allowed = await parseEpub(
      buildZip([
        ...baseFiles(),
        { name: 'META-INF/encryption.xml', data: fontEncryption }
      ]).bytes
    )
    expect(allowed.chapters).toHaveLength(2)

    const contentDrm = `<?xml version="1.0"?><encryption>
      <EncryptedData><CipherData><CipherReference URI="OEBPS/text/ch1.xhtml"/></CipherData></EncryptedData>
    </encryption>`
    await expect(
      parseEpub(
        buildZip([
          ...baseFiles(),
          { name: 'META-INF/encryption.xml', data: contentDrm }
        ]).bytes
      )
    ).rejects.toThrow('DRM')
  })

  it('rejects an unsupported compression method', async () => {
    const files = baseFiles().map((file) =>
      file.name === 'OEBPS/text/ch1.xhtml' ? { ...file, method: 99 as const } : file
    )
    await expect(parseEpub(buildZip(files).bytes)).rejects.toThrow('压缩方式')
  })

  it('rejects ZIP64 archives', async () => {
    const { bytes, eocdOffset } = buildZip(baseFiles())
    const patched = bytes.slice()
    patched[eocdOffset + 10] = 0xff
    patched[eocdOffset + 11] = 0xff
    await expect(openZip(patched)).rejects.toThrow('ZIP64')
  })

  it('rejects a package without text', async () => {
    const withoutText = baseFiles().filter(
      (file) =>
        file.name !== 'OEBPS/text/ch1.xhtml' &&
        file.name !== 'OEBPS/text/ch 2.xhtml' &&
        file.name !== 'OEBPS/nav.xhtml'
    )
    await expect(parseEpub(buildZip(withoutText).bytes)).rejects.toThrow('阅读顺序')
  })

  it('enforces the entry cap on inflated bytes when the declared size is zero', async () => {
    await withZipLimits({ zipEntryBytes: 4, zipTotalBytes: 1024 }, async () => {
      const { bytes } = buildZip([
        {
          name: 'OEBPS/text/bomb.xhtml',
          data: 'abcde',
          declaredSize: 0
        }
      ])
      const archive = await openZip(bytes)
      await expect(archive.read('OEBPS/text/bomb.xhtml')).rejects.toThrow('解压后过大')
    })
  })

  it('charges actual output against the archive total when sizes are zero', async () => {
    await withZipLimits({ zipEntryBytes: 1024, zipTotalBytes: 6 }, async () => {
      const { bytes } = buildZip([
        { name: 'a.txt', data: 'abcd', method: 0, declaredSize: 0 },
        { name: 'b.txt', data: 'efgh', method: 8, declaredSize: 0 }
      ])
      const archive = await openZip(bytes)
      await expect(archive.read('a.txt')).resolves.toHaveLength(4)
      await expect(archive.read('b.txt')).rejects.toThrow('解压后的内容过大')
    })
  })

  it('rejects corrupt deflate data without leaking an unhandled rejection', async () => {
    const { bytes } = buildZip([
      {
        name: 'bad.txt',
        data: 'hello',
        storedOverride: [0xff, 0xff, 0xff, 0xff]
      }
    ])
    const archive = await openZip(bytes)
    await expect(archive.read('bad.txt')).rejects.toThrow()
  })

  it('decodes GBK entry names when the UTF-8 flag is clear', async () => {
    const gbkName = [0xb2, 0xe2, 0xca, 0xd4] // 测试
    const suffix = Array.from(new TextEncoder().encode('.txt'))
    const { bytes } = buildZip([
      {
        name: 'ignored',
        nameBytes: [...gbkName, ...suffix],
        flags: 0,
        data: '内容',
        method: 0
      }
    ])
    const archive = await openZip(bytes)
    expect(archive.names).toEqual(['测试.txt'])
  })

  it('decodes UTF-8 entry names when the UTF-8 flag is set', async () => {
    const { bytes } = buildZip([
      { name: '测试.txt', flags: 0x0800, data: '内容', method: 0 }
    ])
    const archive = await openZip(bytes)
    expect(archive.names).toEqual(['测试.txt'])
  })
})
