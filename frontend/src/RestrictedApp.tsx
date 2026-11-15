import { useEffect, useState } from 'react'
import { observationsApi } from './api'
import { RestrictedLog } from './RestrictedLog'

export function RestrictedApp() {
  const [state, setState] = useState<'checking' | 'ready' | 'unavailable' | 'wrong-workspace'>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void observationsApi.deployment(controller.signal).then(response => {
      if (!controller.signal.aborted) {
        setState(response?.status === 'ok' && response.workspace === 'restricted' ? 'ready' : 'wrong-workspace')
      }
    }, () => {
      if (!controller.signal.aborted) setState('unavailable')
    })
    return () => controller.abort()
  }, [attempt])

  return <main className="main-content inner-page">
    <header className="page-title">
      <h1>Crew monitoring</h1>
      <p>Restricted ACHA workspace</p>
    </header>
    {state === 'ready' && <RestrictedLog healthReview />}
    {state === 'checking' && <p className="notice" role="status">Connecting to the restricted mission service…</p>}
    {(state === 'unavailable' || state === 'wrong-workspace') && <p className="notice" role="alert">
      {state === 'unavailable' ? 'The restricted mission service is unavailable.' : 'Connect this workspace to a restricted mission API.'}
      <button className="text-link" onClick={() => { setState('checking'); setAttempt(attempt + 1) }}>Retry</button>
    </p>}
  </main>
}
