import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { median } from './observationAnalysis'

const trialCount = 5
type Stage = 'idle' | 'waiting' | 'respond' | 'done' | 'interrupted'

export interface ReactionResult {
  value: number
  trials: number
  validTrials: number
}

export function ReactionTask({ onUse }: { onUse: (result: ReactionResult) => void }) {
  const [stage, setStage] = useState<Stage>('idle')
  const stageRef = useRef<Stage>('idle')
  const [results, setResults] = useState<(number | null)[]>([])
  const timer = useRef<number>(undefined)
  const signalAt = useRef<number>(0)
  const responses = useRef<(number | null)[]>([])

  function setPhase(phase: Stage) {
    stageRef.current = phase
    setStage(phase)
  }

  function cue() {
    setPhase('waiting')
    timer.current = window.setTimeout(() => setPhase('respond'), 1000 + Math.random() * 1500)
  }

  useLayoutEffect(() => {
    if (stage === 'respond') signalAt.current = performance.now()
  }, [stage])

  useEffect(() => {
    function visibilityChanged() {
      if (document.hidden && (stageRef.current === 'waiting' || stageRef.current === 'respond')) {
        window.clearTimeout(timer.current)
        setPhase('interrupted')
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [])

  function click() {
    const phase = stageRef.current
    if (phase === 'idle' || phase === 'done' || phase === 'interrupted') {
      responses.current = []
      setResults([])
      cue()
      return
    }
    window.clearTimeout(timer.current)
    const response = phase === 'respond' && signalAt.current > 0 ? performance.now() - signalAt.current : null
    responses.current = [...responses.current, response]
    setResults(responses.current)
    signalAt.current = 0
    if (responses.current.length >= trialCount) setPhase('done')
    else cue()
  }

  const valid = results.filter(value => value !== null)
  const middle = median(valid)
  return <div className="observation-stack">
    <p>Respond after the cue. The task records five attempts and excludes early responses.</p>
    <div className="form-actions"><button type="button" className={stage === 'respond' ? 'button primary' : 'button secondary'}
      onClick={click} onKeyDown={event => { if (event.repeat) event.preventDefault() }}>
      {stage === 'idle' ? 'Start task' : stage === 'waiting' ? 'Wait' : stage === 'respond' ? 'Respond now'
        : 'Restart task'}
    </button>
    {stage === 'done' && middle !== null && <button type="button" className="button secondary"
      onClick={() => onUse({ value: Math.round(middle * 10) / 10, trials: trialCount, validTrials: valid.length })}>
      Use median in observation
    </button>}</div>
    <p role="status">{stage === 'waiting' || stage === 'respond' ? 'Attempt ' + (results.length + 1) + ' of ' + trialCount
      : stage === 'interrupted' ? 'Task ended when this tab lost visibility. Restart to collect a fresh result.'
        : stage === 'done' ? valid.length + ' valid attempts' + (middle === null ? '.' : ' · Median ' + middle.toFixed(1) + ' ms') : ''}</p>
  </div>
}
