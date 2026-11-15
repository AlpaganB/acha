export const atmosphericStandard = 'https://standards.nasa.gov/node/237'
export const sampleMinutes = 5
export const transitionStepKpa = 1
export const exposureBoundaryKpa = 97
export const responseWindowMinutes = 15
export const minimumBaselineSamples = 5

export const responseMetrics = [
  { key: 'heartRate', label: 'Heart rate', unit: 'bpm' },
  { key: 'spo2', label: 'Blood oxygen saturation', unit: '%' },
  { key: 'respiratoryRate', label: 'Respiratory rate', unit: 'breaths/min' },
] as const

export interface PressureSample {
  at: string
  pressure: number | null
  heartRate: number | null
  spo2: number | null
  respiratoryRate: number | null
  symptoms: string[]
  activity: 'rest' | 'exercise'
  baseline: boolean
}

function pressureAt(minute: number) {
  if (minute < 140 || minute > 220) return 101.3
  if (minute < 155) return 101.3 - (minute - 140) / 3
  if (minute <= 205) return 96.3
  return 96.3 + (minute - 205) / 3
}

const round = (value: number) => Math.round(value * 100) / 100
const elapsedMinutes = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 60_000

export const pressureScenario = {
  id: 'acha-habitat-pressure-01',
  provenance: 'SYNTHETIC',
  collection: 'Simulated telemetry and self-report',
  location: 'Habitat A',
  subject: 'Adem Çoban',
  samples: Array.from({ length: 73 }, (_, index): PressureSample => {
    const minute = index * sampleMinutes
    const exercise = minute >= 150 && minute <= 185
    return {
      at: new Date(Date.UTC(2026, 10, 15, 8, minute)).toISOString(),
      pressure: minute >= 165 && minute <= 175 ? null : round(pressureAt(minute)),
      heartRate: 66 + [0, 2, 1, -1, 3, -2][index % 6] + (exercise ? 12 : 0),
      spo2: minute === 165 ? null : 97 + (index % 4 === 0 ? 1 : 0),
      respiratoryRate: minute === 170 ? null : 14 + (index % 3) + (exercise ? 3 : 0),
      symptoms: minute === 160 ? ['Ear fullness'] : minute === 180 ? ['Mild headache'] : [],
      activity: exercise ? 'exercise' : 'rest',
      baseline: minute < 120,
    }
  }),
} as const

export interface PressureTransition {
  start: string
  end: string
  initial: number
  final: number
  direction: 'Decrease' | 'Increase'
  fastestStep: number
  minutes: number
  change: number
}

export function summarizePressure(samples: PressureSample[]) {
  const transitions: PressureTransition[] = []
  let coveredMinutes = 0
  let exposureMinutes = 0
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1]
    const current = samples[index]
    const minutes = elapsedMinutes(previous.at, current.at)
    if (minutes !== sampleMinutes || previous.pressure === null || current.pressure === null) continue

    coveredMinutes += minutes
    if (previous.pressure < exposureBoundaryKpa && current.pressure < exposureBoundaryKpa) exposureMinutes += minutes
    const step = round(current.pressure - previous.pressure)
    if (Math.abs(step) < transitionStepKpa) continue

    const direction = step < 0 ? 'Decrease' : 'Increase'
    const last = transitions.at(-1)
    const rate = round(step / minutes)
    if (last?.end === previous.at && last.direction === direction) {
      last.end = current.at
      last.final = current.pressure
      last.minutes += minutes
      last.change = round(last.final - last.initial)
      if (Math.abs(rate) > Math.abs(last.fastestStep)) last.fastestStep = rate
    } else {
      transitions.push({
        start: previous.at, end: current.at, initial: previous.pressure, final: current.pressure,
        direction, fastestStep: rate, minutes, change: step,
      })
    }
  }
  return { transitions, coveredMinutes, exposureMinutes }
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function compareResponse(samples: PressureSample[], transition: PressureTransition) {
  const baseline = samples.filter(sample => sample.baseline && sample.activity === 'rest' && sample.at < transition.start)
  const after = samples.filter(sample => {
    const lag = elapsedMinutes(transition.end, sample.at)
    return lag >= 0 && lag <= responseWindowMinutes
  })
  const metrics = responseMetrics.map(metric => {
    const beforeValues = baseline.flatMap(sample => sample[metric.key] ?? [])
    const afterValues = after.flatMap(sample => sample[metric.key] ?? [])
    const reference = beforeValues.length >= minimumBaselineSamples ? median(beforeValues) : null
    const observed = median(afterValues)
    return { ...metric, reference, observed, baselineCount: beforeValues.length, afterCount: afterValues.length,
      difference: reference === null || observed === null ? null : round(observed - reference) }
  })
  return { metrics, exercise: after.some(sample => sample.activity === 'exercise'),
    symptoms: after.flatMap(sample => sample.symptoms.map(label => ({ at: sample.at, label }))) }
}
