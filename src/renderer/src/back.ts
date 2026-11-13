export const BACK_EVENT = 'shiye:back'

/**
 * Registers a handler for the Android hardware/gesture back action. Every
 * handler that can close something consumes the event, so the platform layer
 * only falls through to navigation when nothing was open.
 */
export function onBack(handler: () => void): () => void {
  const listener = (event: Event): void => {
    event.preventDefault()
    handler()
  }
  window.addEventListener(BACK_EVENT, listener)
  return () => window.removeEventListener(BACK_EVENT, listener)
}
