import { useEffect, useLayoutEffect, useReducer } from 'react'
import { missionScenarios, scenarioFrame } from './missionScenarioData'
import { scenarioEvents } from './scenarioEvents'
import { initialPlayback, playbackReducer } from './scenarioPlayback'

export function useScenarioPlayer(route: string, visible: boolean) {
  const [state, dispatch] = useReducer(playbackReducer, initialPlayback)
  const scenario = missionScenarios.find(item => item.id === state.scenarioId)
  const frame = scenario && scenarioFrame(scenario, state.frameIndex)
  const events = scenario && frame ? scenarioEvents(scenario, frame) : []

  useLayoutEffect(() => {
    const [path, query] = route.split('?')
    const id = path.startsWith('/scenarios/') ? path.split('/')[2] : path === '/' ? new URLSearchParams(query).get('scenario') : null
    const requested = missionScenarios.find(item => item.id === id)
    const step = new URLSearchParams(query).get('step')
    if (requested) dispatch({ type: 'open', id: requested.id, step: step && /^[1-9]\d{0,2}$/.test(step) ? Number(step) - 1 : undefined, restore: true })
    else dispatch({ type: 'pause' })
  }, [route])

  useEffect(() => {
    if (!state.playing || !visible) return
    if (document.hidden) { dispatch({ type: 'pause' }); return }
    const onVisibility = () => { if (document.hidden) dispatch({ type: 'pause' }) }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setTimeout(() => dispatch({ type: 'tick' }), state.speed * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(timer)
    }
  }, [visible, route, state.playing, state.scenarioId, state.frameIndex, state.speed])

  return { state, dispatch, scenario, frame, events, simulatedTime: frame?.checkpoint.minute }
}

export type ScenarioPlayer = ReturnType<typeof useScenarioPlayer>
