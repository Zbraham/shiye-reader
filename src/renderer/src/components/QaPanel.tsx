import { useEffect, useRef, useState } from 'react'
import { HelpCircle, Sparkles } from 'lucide-react'
import { iconStroke } from '@shared/tokens'
import type { QaAnswer } from '@shared/types'
import { useApp } from '../store'
import { errorText, unwrap } from '../lib'
import { BusyLine } from './ui'

export function QaPanel(): React.JSX.Element {
  const reader = useApp((state) => state.reader)
  const chapter = useApp((state) => state.chapter)
  const showToast = useApp((state) => state.showToast)
  const loadChapter = useApp((state) => state.loadChapter)
  const settings = useApp((state) => state.settings)
  const [question, setQuestion] = useState('')
  const [spoilers, setSpoilers] = useState(false)
  const [answer, setAnswer] = useState<QaAnswer | null>(null)
  const [asked, setAsked] = useState('')
  const [busy, setBusy] = useState(false)
  const askSeq = useRef(0)

  const projectId = reader?.project.id ?? ''

  useEffect(() => {
    askSeq.current += 1
    setAnswer(null)
    setAsked('')
    setQuestion('')
    setBusy(false)
  }, [projectId])

  if (!reader) return <div className="panel-note">正在取回这本书。</div>

  const ask = async (): Promise<void> => {
    const text = question.trim()
    if (!text || !chapter || busy) return
    const askingProject = reader.project.id
    const seq = (askSeq.current += 1)
    setBusy(true)
    try {
      const result = await unwrap(
        window.shiye.askQuestion({
          projectId: askingProject,
          chapterIdx: chapter.idx,
          question: text,
          allowSpoilers: spoilers
        })
      )
      if (seq !== askSeq.current || useApp.getState().reader?.project.id !== askingProject) {
        return
      }
      setAnswer(result)
      setAsked(text)
    } catch (error) {
      if (seq === askSeq.current && useApp.getState().reader?.project.id === askingProject) {
        showToast('error', errorText(error))
      }
    } finally {
      if (seq === askSeq.current) setBusy(false)
    }
  }

  return (
    <>
      <section className="panel-section">
        <h3 className="panel-title">
          <span>问这本书</span>
          <span className="badge">带出处</span>
        </h3>
        <p className="panel-note">
          默认只读到你当前这一章。答案会标出依据的章节；没有把握时会直说不知道。
        </p>
        <textarea
          className="textarea"
          rows={3}
          maxLength={500}
          value={question}
          placeholder="例如：她为什么一直不肯进城？"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void ask()
            }
          }}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={spoilers}
            onChange={(event) => setSpoilers(event.target.checked)}
          />
          <span>允许读到当前章之后的剧情（会剧透）</span>
        </label>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="hint">
            {settings.provider === 'builtin'
              ? '当前是离线模式：会用原文摘录回答。'
              : '会先在本机检索原文，再交给模型归纳。'}
          </span>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !question.trim() || !chapter}
            onClick={() => void ask()}
          >
            {busy ? <BusyLine text="正在翻书" /> : '提问'}
          </button>
        </div>
      </section>

      {answer ? (
        <section className="panel-section">
          <h3 className="panel-title">
            <span className="qa-question">{asked}</span>
          </h3>
          <p className="qa-answer">{answer.answer}</p>
          {answer.sources.length > 0 ? (
            <div className="qa-sources">
              <span className="hint">
                <HelpCircle size={12} strokeWidth={iconStroke} /> 依据
              </span>
              {answer.sources.map((source) => (
                <button
                  key={`${source.chapterIdx}-${source.excerpt.slice(0, 12)}`}
                  className="qa-source"
                  onClick={() => void loadChapter(source.chapterIdx)}
                >
                  <span className="qa-source-title">
                    <Sparkles size={12} strokeWidth={iconStroke} />
                    第 {source.chapterIdx} 章 · {source.chapterTitle}
                  </span>
                  <span>{source.excerpt}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">这次没有找到可引用的原文。</p>
          )}
        </section>
      ) : null}
    </>
  )
}
