import type { MissionObservation, ParameterDefinition } from './api'
import { atmosphericStandard, pressureScenario } from './pressureAnalysis'

const sleep = 'https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=100'
const definitions = [
  ['cabin_pressure', 'Cabin absolute pressure', 'Atmosphere and operations', 'kPa', atmosphericStandard],
  ['ambient_co2', 'Ambient carbon dioxide', 'Atmosphere and operations', 'ppm', atmosphericStandard],
  ['heart_rate', 'Heart rate', 'Cardiorespiratory', 'bpm', atmosphericStandard],
  ['spo2', 'Blood oxygen saturation', 'Cardiorespiratory', '%', atmosphericStandard],
  ['respiratory_rate', 'Respiratory rate', 'Cardiorespiratory', 'breaths/min', atmosphericStandard],
  ['sleep_minutes', 'Reported sleep duration', 'Sleep', 'min', sleep],
  ['reaction_time', 'Median reaction time', 'Cognition', 'ms', 'https://ntrs.nasa.gov/citations/20240012108'],
  ['perceived_workload', 'Reported workload', 'Well-being', '0–10', sleep],
  ['perceived_stress', 'Reported stress', 'Well-being', '0–10', sleep],
  ['exercise_minutes', 'Exercise duration', 'Performance', 'min', sleep],
  ['fluid_intake', 'Reported fluid intake', 'Nutrition and renal', 'mL', 'https://www.nasa.gov/reference/nasa-std-3001v1/'],
  ['headache', 'Reported headache severity', 'Symptoms', '0–10', atmosphericStandard],
] as const

export const trainingParameters: ParameterDefinition[] = definitions.map(([id, label, category, unit, source]) => ({
  id, label, category, unit, source, scope: category === 'Atmosphere and operations' ? 'environment' : 'crew',
  method: 'simulated', cadence: ['sleep_minutes', 'reaction_time', 'perceived_workload', 'perceived_stress'].includes(id)
    ? 'daily or protocol session' : 'scenario interval', priority: 'P0', minimum: null, maximum: null, input_kind: 'number',
}))

function record(
  parameter: string, value: number | null, recorded_at: string, phase: MissionObservation['phase'],
  activity: MissionObservation['activity'] = 'rest',
): MissionObservation[] {
  if (value === null) return []
  const definition = trainingParameters.find(item => item.id === parameter)!
  return [{
    id: `${parameter}:${recorded_at}`, mission_code: 'training', crew_code: definition.scope === 'crew' ? 'crew-a' : null,
    scope: definition.scope, location: 'habitat-a', phase, activity, parameter, unit: definition.unit, value, event_text: null,
    device: null, calibration: null, uncertainty: null, quality: 'verified', provenance: 'SYNTHETIC', method: 'simulated',
    recorded_at, created_at: recorded_at,
  }]
}

export const trainingRecords = [
  ...pressureScenario.samples.flatMap(sample => [
    ...record('cabin_pressure', sample.pressure, sample.at, 'in_flight', 'unknown'),
    ...record('heart_rate', sample.heartRate, sample.at, 'in_flight', sample.activity),
    ...record('spo2', sample.spo2, sample.at, 'in_flight', sample.activity),
    ...record('respiratory_rate', sample.respiratoryRate, sample.at, 'in_flight', sample.activity),
    ...record('headache', sample.symptoms.includes('Mild headache') ? 2 : null, sample.at, 'in_flight', sample.activity),
  ]),
  ...Array.from({ length: 16 }, (_, day) => {
    const stamp = (hour: number) => new Date(Date.UTC(2026, 10, day + 1, hour)).toISOString()
    const phase = day < 4 ? 'preflight' : day >= 15 ? 'postflight' : 'in_flight'
    const variation = [0, 16, -12, 30, -22, 9][day % 6]
    const workload = [4, 6, 8, 5, 7, 4][day % 6]
    return [
      ...record('sleep_minutes', (phase === 'in_flight' ? 403 : 451) + variation, stamp(6), phase),
      ...record('reaction_time', (phase === 'in_flight' ? 273 : 264) + [0, -4, 5, 12, -5, 3][day % 6], stamp(9), phase),
      ...record('perceived_workload', workload, stamp(18), phase),
      ...record('perceived_stress', [4, 5, 6, 4, 3, 4][day % 6], stamp(18), phase),
      ...record('exercise_minutes', [36, 42, 32, 45, 37, 31][day % 6], stamp(15), phase, 'exercise'),
      ...record('fluid_intake', [490, 420, 610, 540][day % 4], stamp(7), phase),
      ...record('ambient_co2', [2600, 2440, 2700, 2470, 2560][day % 5], stamp(7), phase, 'unknown'),
    ]
  }).flat(),
]
