import { ImportError, IMPORT_LIMITS } from './types'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_ENTRIES = 10000

interface ZipEntry {
  name: string
  flags: number
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

interface StreamReadResult {
  done: boolean
  value?: Uint8Array
}

interface MinimalReader {
  read(): Promise<StreamReadResult>
  cancel?(reason?: unknown): Promise<void>
}

interface MinimalWriter {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort?(reason?: unknown): Promise<void>
}

interface MinimalDecompressionStream {
  readable: { getReader(): MinimalReader }
  writable: { getWriter(): MinimalWriter }
}

type DecompressionStreamCtor = new (format: string) => MinimalDecompressionStream

function decompressionCtor(): DecompressionStreamCtor {
  const candidate = (globalThis as unknown as { DecompressionStream?: DecompressionStreamCtor })
    .DecompressionStream
  if (!candidate) {
    throw new ImportError(
      '当前系统的 WebView 不支持 EPUB 解压，请先转换成 TXT 或 Markdown 再导入。'
    )
  }
  return candidate
}

async function inflateRaw(
  data: Uint8Array,
  remainingTotalBytes: number
): Promise<Uint8Array> {
  let stream: MinimalDecompressionStream
  try {
    stream = new (decompressionCtor())('deflate-raw')
  } catch (error) {
    if (error instanceof ImportError) throw error
    throw new ImportError('当前系统的 WebView 不支持 EPUB 需要的解压方式，请改导 TXT。')
  }
  const writer = stream.writable.getWriter()
  const writePromise = writer.write(data).then(() => writer.close())
  // Attach a rejection handler right away: the read loop below can throw
  // before writePromise is awaited, which would otherwise be unhandled.
  const writeSettled = writePromise.then(
    () => undefined,
    () => undefined
  )
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      if (!chunk) continue
      total += chunk.length
      if (total > IMPORT_LIMITS.zipEntryBytes) {
        throw new ImportError('EPUB 内有一页解压后过大，已停止导入。')
      }
      if (total > remainingTotalBytes) {
        throw new ImportError('EPUB 解压后的内容过大，已停止导入。')
      }
      chunks.push(chunk)
    }
    await writePromise
  } catch (error) {
    // Stop both sides of the pipe before surfacing the original failure;
    // otherwise a rejected writePromise becomes an unhandled rejection.
    if (writer.abort) await writer.abort(error).catch(() => {})
    if (reader.cancel) await reader.cancel(error).catch(() => {})
    throw error
  } finally {
    await writeSettled
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function decodeStrict(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes)
  // The ZIP spec defaults to CP437, but Chinese archives commonly store GBK
  // names without setting the UTF-8 flag. Prefer GBK, then CP437, and only
  // fall back to the lossy UTF-8 decode when neither strict decoder applies.
  return (
    decodeStrict(bytes, 'gbk') ??
    decodeStrict(bytes, 'cp437') ??
    new TextDecoder('utf-8').decode(bytes)
  )
}

function findEocd(view: DataView, length: number): number {
  const start = Math.max(0, length - 22 - 0xffff)
  for (let offset = length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  return -1
}

export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>()
  // Declared sizes only give an early bound; actual output is charged on read
  // because a crafted archive can declare zero and inflate far more.
  private declaredBytes = 0
  private readBytes = 0

  private constructor(private readonly bytes: Uint8Array) {}

  static open(bytes: Uint8Array): ZipArchive {
    if (bytes.length < 22) throw new ImportError('这个 EPUB 文件不完整。')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const eocd = findEocd(view, bytes.length)
    if (eocd < 0) throw new ImportError('这个文件不是有效的 EPUB（找不到 ZIP 目录）。')

    const entriesCount = view.getUint16(eocd + 10, true)
    const directorySize = view.getUint32(eocd + 12, true)
    const directoryOffset = view.getUint32(eocd + 16, true)
    if (
      entriesCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new ImportError('暂不支持 ZIP64 格式的 EPUB，请用常规 EPUB 或 TXT。')
    }
    if (entriesCount > MAX_ENTRIES) throw new ImportError('EPUB 内的文件数量异常，已停止导入。')
    if (directoryOffset + directorySize > bytes.length) {
      throw new ImportError('这个 EPUB 的目录损坏，无法读取。')
    }

    const archive = new ZipArchive(bytes)
    let cursor = directoryOffset
    for (let index = 0; index < entriesCount; index += 1) {
      if (cursor + 46 > bytes.length) break
      if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break
      const flags = view.getUint16(cursor + 8, true)
      const method = view.getUint16(cursor + 10, true)
      const compressedSize = view.getUint32(cursor + 20, true)
      const size = view.getUint32(cursor + 24, true)
      const nameLength = view.getUint16(cursor + 28, true)
      const extraLength = view.getUint16(cursor + 30, true)
      const commentLength = view.getUint16(cursor + 32, true)
      const localOffset = view.getUint32(cursor + 42, true)
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
        throw new ImportError('暂不支持 ZIP64 格式的 EPUB，请用常规 EPUB 或 TXT。')
      }
      const nameStart = cursor + 46
      const nameEnd = nameStart + nameLength
      if (nameEnd > bytes.length) break
      const name = decodeName(bytes.subarray(nameStart, nameEnd), (flags & 0x800) !== 0)
        .replace(/\\/g, '/')
        .replace(/^\/+/u, '')
      if (name && !name.endsWith('/')) {
        archive.declaredBytes += size
        if (archive.declaredBytes > IMPORT_LIMITS.zipTotalBytes) {
          throw new ImportError('EPUB 解压后的内容过大，已停止导入。')
        }
        archive.entries.set(name, {
          name,
          flags,
          method,
          compressedSize,
          size,
          localOffset
        })
      }
      cursor = nameEnd + extraLength + commentLength
    }
    if (archive.entries.size === 0) throw new ImportError('这个 EPUB 里没有可读取的文件。')
    return archive
  }

  get names(): string[] {
    return Array.from(this.entries.keys())
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  entrySize(name: string): number {
    return this.entries.get(name)?.size ?? 0
  }

  find(predicate: (name: string) => boolean): string | null {
    for (const name of this.entries.keys()) {
      if (predicate(name)) return name
    }
    return null
  }

  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name)
    if (!entry) throw new ImportError(`EPUB 中缺少文件：${name}`)
    if ((entry.flags & 0x1) !== 0) {
      throw new ImportError('这个 EPUB 带有加密保护（DRM），无法导入。')
    }
    if (entry.size > IMPORT_LIMITS.zipEntryBytes) {
      throw new ImportError('EPUB 内有一页过大，已停止导入。')
    }
    if (
      entry.compressedSize > 0 &&
      entry.size / entry.compressedSize > IMPORT_LIMITS.zipRatio
    ) {
      throw new ImportError('EPUB 内文件压缩比异常，已停止导入。')
    }

    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
    const local = entry.localOffset
    if (local + 30 > this.bytes.length || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
      throw new ImportError('EPUB 的文件目录损坏，无法解压。')
    }
    const nameLength = view.getUint16(local + 26, true)
    const extraLength = view.getUint16(local + 28, true)
    const dataStart = local + 30 + nameLength + extraLength
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > this.bytes.length) {
      throw new ImportError('EPUB 的文件数据不完整。')
    }
    const data = this.bytes.subarray(dataStart, dataEnd)

    if (entry.method === 0) {
      this.chargeRead(data.length)
      return data
    }
    if (entry.method === 8) {
      const remainingTotalBytes = IMPORT_LIMITS.zipTotalBytes - this.readBytes
      const inflated = await inflateRaw(data, remainingTotalBytes)
      if (entry.size > 0 && inflated.length > entry.size) {
        // A zero size means "unknown" (for example a data descriptor); the
        // produced length is charged against the caps instead of trusted.
        throw new ImportError('EPUB 解压结果异常，已停止导入。')
      }
      this.chargeRead(inflated.length)
      return inflated
    }
    throw new ImportError(`EPUB 使用了不支持的压缩方式（${entry.method}）。`)
  }

  private chargeRead(bytes: number): void {
    if (bytes > IMPORT_LIMITS.zipEntryBytes) {
      throw new ImportError('EPUB 内有一页过大，已停止导入。')
    }
    this.readBytes += bytes
    if (this.readBytes > IMPORT_LIMITS.zipTotalBytes) {
      throw new ImportError('EPUB 解压后的内容过大，已停止导入。')
    }
  }

  async readText(name: string): Promise<string> {
    const data = await this.read(name)
    return new TextDecoder('utf-8').decode(data)
  }
}

export async function openZip(bytes: Uint8Array): Promise<ZipArchive> {
  return ZipArchive.open(bytes)
}
