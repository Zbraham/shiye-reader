import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseNovelFile } from '@shared/import'

interface ZipEntry {
  name: string
  data: string | Uint8Array
  method?: 0 | 8
  /** General-purpose flags; defaults to the UTF-8 name flag. */
  flags?: number
}

function u16(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value: number): Uint8Array {
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ])
}

function join(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Minimal ZIP writer: no CRC, stored or deflate. */
function buildZip(files: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encode(file.name)
    const raw = typeof file.data === 'string' ? encode(file.data) : file.data
    const method = file.method ?? 8
    const flags = file.flags ?? 0x0800
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw
    const localOffset = offset

    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(compressed.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      compressed
    ])
    locals.push(local)
    offset += local.length

    central.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(compressed.length),
        u32(raw.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(localOffset),
        name
      ])
    )
  }

  const directory = join(central)
  return join([
    ...locals,
    directory,
    join([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(directory.length),
      u32(offset),
      u16(0)
    ])
  ])
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>雨夜来信</dc:title>
    <dc:creator>林雨</dc:creator>
    <dc:description>一个关于雨夜的故事。</dc:description>
    <dc:language>zh-CN</dc:language>
    <dc:publisher>拾页出版社</dc:publisher>
    <dc:subject>悬疑</dc:subject>
    <dc:subject>都市</dc:subject>
    <meta name="calibre:series" content="雨夜系列"/>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="inline" href="images/inline.png" media-type="image/png"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`

const CH1 = `<html><head><title>第一章 来信</title></head><body>
<h1>第一卷 雨夜</h1>
<h2>第一章 来信</h2>
<p>雨落在瓦上&amp;很轻。</p>
<p><img src="../images/inline.png" alt="插图" onerror="alert(1)"/>她数着雨声。</p>
<script>alert('x')</script>
</body></html>`

const CH2 = `<html><head><title>第二章 北站</title></head><body>
<h2>第二章 北站</h2>
<p>广播里念出了她的名字。</p>
<h3>第一节 广播</h3>
<p><a href="#note-1">注释</a>声音很轻。</p>
<p><a href="notes.xhtml">外链</a>她抬起头。</p>
</body></html>`

function epubFiles(): ZipEntry[] {
  return [
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: CONTAINER },
    { name: 'OEBPS/content.opf', data: OPF },
    { name: 'OEBPS/nav.xhtml', data: '<html><body><nav>目录</nav></body></html>' },
    { name: 'OEBPS/text/ch1.xhtml', data: CH1 },
    { name: 'OEBPS/text/ch2.xhtml', data: CH2 },
    { name: 'OEBPS/images/inline.png', data: PNG, method: 0 },
    { name: 'OEBPS/images/cover.png', data: PNG, method: 0 }
  ]
}

describe('rich EPUB import', () => {
  it('inlines images, sanitises HTML and reads metadata/volume/level', async () => {
    const book = await parseNovelFile({ name: '雨夜.epub', bytes: buildZip(epubFiles()) })

    expect(book.format).toBe('epub')
    expect(book.title).toBe('雨夜来信')
    expect(book.author).toBe('林雨')
    expect(book.description).toContain('雨夜')
    expect(book.language).toBe('zh-CN')
    expect(book.publisher).toBe('拾页出版社')
    expect(book.series).toBe('雨夜系列')
    expect(book.tags).toEqual(['悬疑', '都市'])
    expect(book.coverData?.startsWith('data:image/png;base64,')).toBe(true)

    const first = book.chapters[0]
    const firstHtml = first?.html ?? ''
    expect(first?.title).toBe('第一章 来信')
    expect(first?.content).toContain('雨落在瓦上&很轻。')
    expect(first?.html).toContain('<p>')
    expect(firstHtml).toContain('<img src="data:image/png;base64,')
    expect(firstHtml).not.toContain('<script')
    expect(firstHtml).not.toContain('onerror')
    expect(first?.volume).toBe('第一卷 雨夜')
    expect(first?.level).toBe(1)

    // The volume label survives into the next XHTML document.
    expect(book.chapters[1]?.volume).toBe('第一卷 雨夜')

    const section = book.chapters[2]
    expect(section?.title).toBe('第一节 广播')
    expect(section?.level).toBe(2)
    expect(section?.html).toContain('href="#note-1"')
    expect(section?.html).not.toContain('notes.xhtml')
  })
})

describe('HTML import', () => {
  it('splits headings, keeps rich HTML and strips scripts/handlers', async () => {
    const html = `<!DOCTYPE html><html><head>
<title>测试书</title>
<script>alert('bad')</script>
<style>p { color: red }</style>
</head><body>
<h1>第一章 雨</h1>
<p>雨落在瓦上。</p>
<img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)">
<div>第二段。</div>
<h2>第二章 北站</h2>
<p>广播里念出了她的名字。</p>
</body></html>`

    const book = await parseNovelFile({ name: 'TEST.HTML', bytes: encode(html) })
    expect(book.format).toBe('html')
    expect(book.title).toBe('测试书')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[0]?.content).toContain('雨落在瓦上')
    expect(book.chapters[0]?.content).toContain('第二段')
    expect(book.chapters[0]?.html).toContain('<p>')
    expect(book.chapters[0]?.html).toContain('<img src="data:image/png;base64,')
    expect(book.chapters[0]?.html).not.toContain('<script')
    expect(book.chapters[0]?.html).not.toContain('onerror')
    expect(book.chapters[0]?.html).not.toContain('color: red')
  })
})

describe('FB2 import', () => {
  it('reads metadata and section/title chapters', async () => {
    const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>旧城</book-title>
      <author><first-name>李</first-name><last-name>四</last-name></author>
      <annotation>一段旧事。</annotation>
      <lang>zh</lang>
      <genre>悬疑</genre>
      <sequence name="旧城系列"/>
    </title-info>
    <publish-info><publisher>旧城社</publisher></publish-info>
  </description>
  <body>
    <section><title><p>第一章</p></title><p>风从北边来。</p><p>她关上门。</p></section>
    <section><title><p>第二章</p></title><p>灯灭了。</p></section>
  </body>
</FictionBook>`

    const book = await parseNovelFile({ name: '旧城.fb2', bytes: encode(fb2) })
    expect(book.format).toBe('fb2')
    expect(book.title).toBe('旧城')
    expect(book.author).toBe('李四')
    expect(book.description).toContain('旧事')
    expect(book.language).toBe('zh')
    expect(book.publisher).toBe('旧城社')
    expect(book.series).toBe('旧城系列')
    expect(book.tags).toEqual(['悬疑'])
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章'])
    expect(book.chapters[0]?.content).toContain('风从北边来')
    expect(book.chapters[1]?.content).toContain('灯灭了')
  })
})

describe('RTF import', () => {
  it('extracts ASCII text and GBK-escaped bytes without crashing', async () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}\fs24 Hello world.\par This is a test.\par \'d6\'d0\'ce\'c4\par}`

    const book = await parseNovelFile({ name: 'sample.rtf', bytes: encode(rtf) })
    expect(book.format).toBe('rtf')
    expect(book.chapters.length).toBeGreaterThan(0)
    const content = book.chapters.map((chapter) => chapter.content).join('\n')
    expect(content).toContain('Hello world')
    expect(content).toContain('This is a test')
    expect(content).toContain('中文')
    expect(content).not.toContain('fonttbl')
  })

  it('rejects an RTF without readable text', async () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}}`
    await expect(
      parseNovelFile({ name: 'empty.rtf', bytes: encode(rtf) })
    ).rejects.toThrow('可读文字')
  })
})

describe('DOCX import', () => {
  it('reads document.xml paragraphs, heading styles and core metadata', async () => {
    const documentXml = `<?xml version="1.0" encoding="utf-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 测试</w:t></w:r></w:p>
    <w:p><w:r><w:t>这是正文</w:t></w:r><w:tab/><w:r><w:t>继续。</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二章 结束</w:t></w:r></w:p>
    <w:p><w:r><w:t>结尾。</w:t></w:r></w:p>
  </w:body>
</w:document>`

    const coreXml = `<?xml version="1.0" encoding="utf-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>文档之书</dc:title>
  <dc:creator>张三</dc:creator>
</cp:coreProperties>`

    const bytes = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: documentXml },
      { name: 'docProps/core.xml', data: coreXml }
    ])

    const book = await parseNovelFile({ name: 'book.docx', bytes })
    expect(book.format).toBe('docx')
    expect(book.title).toBe('文档之书')
    expect(book.author).toBe('张三')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 测试', '第二章 结束'])
    expect(book.chapters[0]?.content).toContain('这是正文 继续。')
    expect(book.chapters[1]?.content).toContain('结尾。')
  })
})

describe('ZIP container import', () => {
  it('merges multiple TXT entries in name order', async () => {
    const bytes = buildZip([
      { name: 'b.txt', data: '第二章 后\n后来的事。' },
      { name: 'a.txt', data: '第一章 前\n从前的事。' }
    ])
    const book = await parseNovelFile({ name: '合集.zip', bytes })
    expect(book.format).toBe('txt')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 前', '第二章 后'])
    expect(book.warnings.join('')).toContain('合并')
  })

  it('names unreadable TXT entries in the merge warning', async () => {
    const bytes = buildZip([
      { name: 'a.txt', data: '第一章 前\n从前的事。' },
      // The encrypted flag makes this entry unreadable while still listed.
      { name: 'b.txt', data: '第二章 后\n后来的事。', flags: 0x0801 },
      { name: 'c.txt', data: '第三章 终\n后来。' }
    ])
    const book = await parseNovelFile({ name: '合集.zip', bytes })
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 前', '第三章 终'])
    const warnings = book.warnings.join('\n')
    expect(warnings).toContain('合并')
    expect(warnings).toContain('1 个 TXT 无法读取')
    expect(warnings).toContain('b.txt')
  })
})
