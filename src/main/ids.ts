/**
 * Identifier helper shared by the desktop main process and the Android
 * WebView build. Uses the platform Web Crypto API so the same engine code can
 * run in both places without importing `node:crypto`.
 */

interface CryptoLike {
  randomUUID?: () => string
  getRandomValues?: (buffer: Uint8Array) => Uint8Array
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

export function newId(): string {
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto
  if (crypto?.randomUUID) return crypto.randomUUID()
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const value = hex(bytes)
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
      16,
      20
    )}-${value.slice(20)}`
  }
  // Last resort. Only reachable on very old runtimes without Web Crypto.
  const value = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(
    17,
    20
  )}-${value.slice(20, 32)}`
}
