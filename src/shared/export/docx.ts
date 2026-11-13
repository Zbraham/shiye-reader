/** Minimal Office Open XML (DOCX) packaging for plain novel text. */

import { encodeUtf8 } from './bytes'
import { chapterHeading } from './plain'
import type { ExportBook } from './types'
import { escapeXml, parseCoverData, type CoverImage } from './xml'
import { buildZip, type ZipEntryInput } from './zip'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
__IMAGE_DEFAULT__
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun" w:hAnsi="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="360" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="240" w:after="240"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="48"/>
      <w:szCs w:val="48"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:after="360"/>
    </w:pPr>
    <w:rPr>
      <w:color w:val="555555"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="360" w:after="180"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
</w:styles>
`

function paragraph(text: string, style?: string): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function coverParagraph(): string {
  const extent = 'cx="3200400" cy="4572000"'
  return `<w:p>
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent ${extent}/>
        <wp:docPr id="1" name="Cover"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr>
                <pic:cNvPr id="0" name="Cover"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="rIdCover"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext ${extent}/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`
}

function documentXml(book: ExportBook, cover: CoverImage | null): string {
  const body: string[] = []
  if (cover) body.push(coverParagraph())
  body.push(paragraph(book.title, 'Title'))

  const author = book.author?.trim()
  if (author) body.push(paragraph(author, 'Subtitle'))

  for (const chapter of book.chapters) {
    body.push(paragraph(chapterHeading(chapter.idx, chapter.title, ' '), 'Heading1'))
    const lines = chapter.content
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    for (const line of lines) body.push(paragraph(line))
  }

  body.push(
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>'
  )

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
${body.join('\n')}
  </w:body>
</w:document>
`
}

function documentRels(cover: CoverImage | null): string {
  const relationships = [
    '  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  ]
  if (cover) {
    relationships.push(
      `  <Relationship Id="rIdCover" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cover.${cover.extension}"/>`
    )
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relationships.join('\n')}
</Relationships>
`
}

function contentTypes(cover: CoverImage | null): string {
  const imageDefault = cover
    ? `  <Default Extension="${cover.extension}" ContentType="${cover.mediaType}"/>`
    : '  <!-- no image parts -->'
  return CONTENT_TYPES.replace('__IMAGE_DEFAULT__', imageDefault)
}

function coverEntry(cover: CoverImage | null): ZipEntryInput[] {
  if (!cover) return []
  return [{ name: `word/media/cover.${cover.extension}`, data: cover.bytes }]
}

export async function buildDocx(book: ExportBook): Promise<Uint8Array> {
  const cover = parseCoverData(book.coverData)
  const entries: ZipEntryInput[] = [
    { name: '[Content_Types].xml', data: encodeUtf8(contentTypes(cover)) },
    { name: '_rels/.rels', data: encodeUtf8(ROOT_RELS) },
    { name: 'word/document.xml', data: encodeUtf8(documentXml(book, cover)) },
    { name: 'word/styles.xml', data: encodeUtf8(STYLES_XML) },
    { name: 'word/_rels/document.xml.rels', data: encodeUtf8(documentRels(cover)) },
    ...coverEntry(cover)
  ]
  return buildZip(entries)
}
