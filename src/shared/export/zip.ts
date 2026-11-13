/**
 * Minimal ZIP writer for EPUB/DOCX export. Supports STORED and raw DEFLATE
 * (through CompressionStream when the runtime provides it). No ZIP64.
 */

import { concatBytes, encodeUtf8 } from './bytes'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const UTF8_FLAG = 0x0800
const VERSION = 20
const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff

export interface ZipEntryInput {
  name: string
  data: Uint8Array
  /** Set false for the EPUB mimetype entry, which must be stored. */
  compress?: boolean
}

interface StreamReadResult {
  done: boolean
  value?: Uint8Array
}

interface MinimalWriter {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

interface MinimalCompressionStream {
  readable: { getReader(): { read(): Promise<StreamReadResult> } }
  writable: { getWriter(): MinimalWriter }
}

type CompressionStreamCtor = new (format: 'deflate-raw') => MinimalCompressionStream

interface CentralRecord {
  nameBytes: Uint8Array
  method: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
}

let crcTable: Uint32Array | null = null

function table(): Uint32Array {
  if (crcTable) return crcTable
  const output = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    output[index] = value >>> 0
  }
  crcTable = output
  return output
}

/** Standard CRC32 (IEEE 802.3), used by ZIP entries. */
export function crc32(data: Uint8Array): number {
  const lookup = table()
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (crc >>> 8) ^ (lookup[(crc ^ byte) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const ctor = (globalThis as unknown as { CompressionStream?: CompressionStreamCtor })
    .CompressionStream
  if (!ctor) return null

  let stream: MinimalCompressionStream
  try {
    stream = new ctor('deflate-raw')
  } catch {
    return null
  }

  try {
    const writer = stream.writable.getWriter()
    let writeFailed = false
    const writePromise = writer
      .write(data)
      .then(() => writer.close())
      .catch(() => {
        writeFailed = true
      })

    const reader = stream.readable.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      if (chunk) chunks.push(chunk)
    }
    await writePromise
    if (writeFailed) return null
    return concatBytes(chunks)
  } catch {
    // Runtimes without deflate-raw support fall back to STORED per entry.
    return null
  }
}

function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()))
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

function localHeader(
  record: CentralRecord,
  time: number,
  date: number
): Uint8Array {
  const header = new Uint8Array(30)
  const view = new DataView(header.buffer)
  view.setUint32(0, LOCAL_SIGNATURE, true)
  view.setUint16(4, VERSION, true)
  view.setUint16(6, UTF8_FLAG, true)
  view.setUint16(8, record.method, true)
  view.setUint16(10, time, true)
  view.setUint16(12, date, true)
  view.setUint32(14, record.crc, true)
  view.setUint32(18, record.compressedSize, true)
  view.setUint32(22, record.size, true)
  view.setUint16(26, record.nameBytes.length, true)
  view.setUint16(28, 0, true)
  return header
}

function centralHeader(
  record: CentralRecord,
  time: number,
  date: number
): Uint8Array {
  const header = new Uint8Array(46)
  const view = new DataView(header.buffer)
  view.setUint32(0, CENTRAL_SIGNATURE, true)
  view.setUint16(4, VERSION, true)
  view.setUint16(6, VERSION, true)
  view.setUint16(8, UTF8_FLAG, true)
  view.setUint16(10, record.method, true)
  view.setUint16(12, time, true)
  view.setUint16(14, date, true)
  view.setUint32(16, record.crc, true)
  view.setUint32(20, record.compressedSize, true)
  view.setUint32(24, record.size, true)
  view.setUint16(28, record.nameBytes.length, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, record.localOffset, true)
  return header
}

function eocd(count: number, centralSize: number, centralOffset: number): Uint8Array {
  const footer = new Uint8Array(22)
  const view = new DataView(footer.buffer)
  view.setUint32(0, EOCD_SIGNATURE, true)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, count, true)
  view.setUint16(10, count, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, centralOffset, true)
  view.setUint16(20, 0, true)
  return footer
}

/** Writes entries in order, using DEFLATE when available and STORED otherwise. */
export async function buildZip(entries: readonly ZipEntryInput[]): Promise<Uint8Array> {
  if (entries.length === 0) throw new Error('ZIP 至少需要一个文件。')
  if (entries.length > MAX_UINT16) throw new Error('ZIP 文件数量超过上限。')

  const chunks: Uint8Array[] = []
  let offset = 0
  const push = (chunk: Uint8Array): void => {
    chunks.push(chunk)
    offset += chunk.length
  }

  const { time, date } = dosTimestamp(new Date())
  const records: CentralRecord[] = []

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name)
    if (nameBytes.length === 0 || nameBytes.length > MAX_UINT16) {
      throw new Error(`ZIP 文件名无效：${entry.name}`)
    }
    if (entry.data.length > MAX_UINT32) {
      throw new Error('导出内容超过 ZIP 32 位大小上限。')
    }

    let method = 0
    let compressed = entry.data
    if (entry.compress !== false) {
      const deflated = await deflateRaw(entry.data)
      if (deflated) {
        method = 8
        compressed = deflated
      }
    }
    if (compressed.length > MAX_UINT32) {
      throw new Error('导出内容超过 ZIP 32 位大小上限。')
    }

    const record: CentralRecord = {
      nameBytes,
      method,
      crc: crc32(entry.data),
      compressedSize: compressed.length,
      size: entry.data.length,
      localOffset: offset
    }
    push(localHeader(record, time, date))
    push(nameBytes)
    push(compressed)
    records.push(record)
  }

  const centralOffset = offset
  let centralSize = 0
  for (const record of records) {
    const header = centralHeader(record, time, date)
    push(header)
    push(record.nameBytes)
    centralSize += header.length + record.nameBytes.length
  }
  if (centralOffset > MAX_UINT32 || centralSize > MAX_UINT32) {
    throw new Error('导出内容超过 ZIP 32 位大小上限。')
  }
  push(eocd(records.length, centralSize, centralOffset))
  return concatBytes(chunks)
}
