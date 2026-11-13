import type { AppSettings } from '@shared/types'
import type { Writer } from './types'
import { BuiltinWriter } from './builtin'
import { RemoteWriter } from './remote'

export function createWriter(settings: AppSettings): Writer {
  if (settings.provider === 'openai') return new RemoteWriter(settings)
  return new BuiltinWriter()
}

export type { Writer }
