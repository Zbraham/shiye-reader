import { useEffect } from 'react'
import { useApp } from './store'
import { Boot } from './components/Boot'
import { Bookshelf } from './components/Bookshelf'
import { Setup } from './components/Setup'
import { Reader } from './components/Reader'
import { Toast } from './components/Toast'

export function App(): React.JSX.Element {
  const view = useApp((state) => state.view)
  const init = useApp((state) => state.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="shell">
      {view === 'boot' && <Boot />}
      {view === 'library' && <Bookshelf />}
      {view === 'setup' && <Setup />}
      {view === 'reader' && <Reader />}
      <Toast />
    </div>
  )
}
