import { useApp } from '../store'

export function Toast(): React.JSX.Element | null {
  const toast = useApp((state) => state.toast)
  if (!toast) return null
  return (
    <div className="toast" data-tone={toast.tone} role="status">
      {toast.message}
    </div>
  )
}
