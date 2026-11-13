/** Chinese script conversion for the reader (OpenCC dictionaries). */

import { Converter as CnConverter } from 'opencc-js/cn2t'
import { Converter as TnConverter } from 'opencc-js/t2cn'
import type { AppSettings } from './types'

export type ConvertMode = AppSettings['convert']

type ConvertFn = (text: string) => string

let toTraditional: ConvertFn | null = null
let toSimplified: ConvertFn | null = null
const lastResult: Record<'s2t' | 't2s', { input: string; output: string } | null> = {
  s2t: null,
  t2s: null
}

function traditional(): ConvertFn {
  if (!toTraditional) toTraditional = CnConverter({ from: 'cn', to: 'tw' })
  return toTraditional
}

function simplified(): ConvertFn {
  if (!toSimplified) toSimplified = TnConverter({ from: 'tw', to: 'cn' })
  return toSimplified
}

export function convertText(text: string, mode: ConvertMode): string {
  if (mode === 'none' || !text) return text
  const cached = lastResult[mode]
  if (cached && cached.input === text) return cached.output
  let result: string
  try {
    result = mode === 's2t' ? traditional()(text) : simplified()(text)
  } catch {
    result = text
  }
  lastResult[mode] = { input: text, output: result }
  return result
}
