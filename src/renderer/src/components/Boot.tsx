import { useApp } from '../store'

export function Boot(): React.JSX.Element {
  const error = useApp((state) => state.bootError)
  const init = useApp((state) => state.init)

  return (
    <div className="boot">
      <div className="boot-mark">拾页</div>
      {error ? (
        <>
          <p className="error-text" style={{ maxWidth: 420, textAlign: 'center' }}>
            {error}
          </p>
          <button className="btn btn-ghost" onClick={() => void init()}>
            重试
          </button>
        </>
      ) : (
        <div className="boot-msg">
          正在整理书页
          <span className="quiet-caret" />
        </div>
      )}
    </div>
  )
}
