import { missionScenarios } from './missionScenarioData.ts'
import { scenarioSystems, type ScenarioEvent, type ScenarioId, type System } from './scenarioEvents.ts'

export interface Playback {
  mode: 'recorded' | 'scenario'
  scenarioId: ScenarioId | null
  frameIndex: number
  playing: boolean
  speed: number
  selectedSystem: System | null
  selectedMetric: number
  selectedEvent: string | null
  returnFromInspection?: { frameIndex: number; selectedMetric: number }
}

export const initialPlayback: Playback = {
  mode: 'recorded', scenarioId: null, frameIndex: 0, playing: false, speed: 5,
  selectedSystem: null, selectedMetric: 0, selectedEvent: null,
}

export type PlaybackAction =
  | { type: 'open'; id: ScenarioId; step?: number; play?: boolean; restore?: boolean }
  | { type: 'exit' | 'pause' | 'toggle' | 'tick' | 'dismiss' }
  | { type: 'seek'; index: number }
  | { type: 'speed'; seconds: number }
  | { type: 'inspect'; event: ScenarioEvent }
  | { type: 'metric'; column: number }

export function playbackReducer(state: Playback, action: PlaybackAction): Playback {
  if (action.type === 'open') {
    const scenario = missionScenarios.find(item => item.id === action.id)!
    if (action.restore && state.scenarioId === action.id && action.step === undefined) return { ...state, playing: false }
    const frameIndex = Math.min(scenario.checkpoints.length - 1, Math.max(0, action.step ?? 0))
    return { ...initialPlayback, speed: state.speed, mode: 'scenario', scenarioId: action.id,
      selectedSystem: scenarioSystems[action.id], frameIndex, playing: Boolean(action.play) && frameIndex < scenario.checkpoints.length - 1 }
  }
  if (action.type === 'exit') return { ...initialPlayback, speed: state.speed }
  const scenario = missionScenarios.find(item => item.id === state.scenarioId)
  if (!scenario) return state
  const last = scenario.checkpoints.length - 1
  const seek = (frameIndex: number) => ({ ...state, frameIndex: Math.min(last, Math.max(0, frameIndex)), playing: false, selectedEvent: null, returnFromInspection: undefined })
  switch (action.type) {
    case 'pause': return state.playing ? { ...state, playing: false } : state
    case 'toggle': return state.playing ? { ...state, playing: false }
      : { ...seek(state.frameIndex === last ? 0 : state.frameIndex), playing: true }
    case 'tick': return state.playing ? { ...seek(state.frameIndex + 1), playing: state.frameIndex + 1 < last } : state
    case 'seek': return seek(action.index)
    case 'speed': return { ...state, speed: action.seconds }
    case 'metric': return { ...state, selectedMetric: action.column }
    case 'dismiss': return { ...state, ...state.returnFromInspection, selectedEvent: null, returnFromInspection: undefined }
    case 'inspect': return action.event.scenarioId === state.scenarioId && action.event.frameIndex <= state.frameIndex
      ? { ...seek(action.event.frameIndex), selectedSystem: action.event.system,
        selectedMetric: action.event.column ?? state.selectedMetric, selectedEvent: action.event.id,
        returnFromInspection: state.returnFromInspection ?? { frameIndex: state.frameIndex, selectedMetric: state.selectedMetric } } : state
  }
  return state
}
