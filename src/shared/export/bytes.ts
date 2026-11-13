/** Byte helpers shared by the export writers. Pure TypeScript, no Node APIs. */

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52
  if (code === 0x2b) return 62
  if (code === 0x2f) return 63
  return -1
}

/**
 * Decodes standard base64 without Buffer or atob. Whitespace is ignored and
 * URL-safe characters are accepted; malformed input returns null.
 */
export function decodeBase64(input: string): Uint8Array | null {
  const text = input
    .replace(/[\t\n\f\r ]/gu, '')
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
  if (!text || text.length % 4 === 1) return null

  let padding = 0
  if (text.endsWith('==')) padding = 2
  else if (text.endsWith('=')) padding = 1
  const body = padding > 0 ? text.slice(0, -padding) : text
  if (body.includes('=')) return null

  const output = new Uint8Array(Math.floor((body.length * 6) / 8))
  let index = 0
  let buffer = 0
  let bits = 0
  for (let cursor = 0; cursor < body.length; cursor += 1) {
    const value = base64Value(body.charCodeAt(cursor))
    if (value < 0) return null
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[index] = (buffer >>> bits) & 0xff
      index += 1
    }
  }
  return output
}
