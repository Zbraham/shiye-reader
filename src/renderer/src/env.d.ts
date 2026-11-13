import type { ShiyeApi } from '@shared/api'

declare global {
  interface Window {
    shiye: ShiyeApi
  }
}

export {}
