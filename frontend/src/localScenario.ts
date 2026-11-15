import type { Assessment, AssessmentInput, FollowUpEntry, FollowUpInput, Indicator, IndicatorReport, Measurement, MeasurementInput, MeasurementQuery } from './api'
import { measurementLabels, measurementUnits } from './content'
import { lunarBaseline, missionScenarios, scenarioFrame } from './missionScenarioData'
import { readLocal, saveLocal, type Workspace } from './storage'

const day = 86_400_000
export const scenarioKey = 'synthetic-scenario-v1'
export const scenarioWorkspace: Workspace = {
  crew: [{ id: 'scenario-crew', display_name: 'Emirhan Caman', mission_profile_id: 'scenario-lunar' }],
  profiles: [{ id: 'scenario-lunar', name: 'Lunar Habitat', environment: 'lunar_habitat',
    equipment: ['Training heart rate monitor', 'Sleep log'], constraints: ['Simulated delayed ground support'], guidance_protocol_ids: [] }],
}
const crewId = scenarioWorkspace.crew[0].id
const profileId = scenarioWorkspace.profiles[0].id
export const scenarioAssessmentId = 'scenario-check-in'

interface Scenario {
  measurements: Measurement[]
  assessments: Assessment[]
  followUps: Record<string, FollowUpEntry[]>
}

export function readScenario() {
  const scenario = readLocal<Scenario>(scenarioKey)
  return Array.isArray(scenario?.measurements) && Array.isArray(scenario.assessments) && scenario.followUps
    ? scenario : null
}

function withScenarioLock<T>(operation: () => T): Promise<T> {
  return navigator.locks ? navigator.locks.request(scenarioKey, operation) : Promise.resolve().then(operation)
}

function updateScenario<T>(change: (scenario: Scenario) => T): Promise<T> {
  const save = () => {
    const scenario = readScenario()
    if (!scenario) throw new Error('Open the synthetic scenario first.')
    const result = change(scenario)
    if (!saveLocal(scenarioKey, scenario)) throw new Error('This browser could not save the scenario to this device.')
    return result
  }
  return withScenarioLock(save)
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const comparisonBounds: Record<string, [number, number]> = {
  heart_rate: [1, 300], respiratory_rate: [0, 1e12], spo2: [0, 100],
  blood_pressure: [1, 300], body_temperature: [20, 50],
}

function reference(reading: Measurement, history: Measurement[], query: URLSearchParams): Indicator['reference'] {
  const current = Date.parse(reading.recorded_at)
  const end = Math.min(Date.parse(query.get('reference_end') ?? reading.recorded_at), current)
  const start = Math.min(Date.parse(query.get('reference_start') ?? new Date(current - 30 * day).toISOString()), end)
  const sameKind = history.filter(item => item.kind === reading.kind)
  const [minimum, maximum] = comparisonBounds[reading.kind]
  const usable = (value: number) => value >= minimum && value <= maximum
  const timestamps = new Map<string, Set<number>>()
  for (const item of sameKind) {
    const time = Date.parse(item.recorded_at)
    if (time < start || time >= end) continue
    const values = timestamps.get(item.recorded_at) ?? new Set<number>()
    values.add(item.value)
    timestamps.set(item.recorded_at, values)
  }
  const buckets = new Map<string, number[]>()
  for (const [timestamp, values] of timestamps) {
    if (values.size !== 1) continue
    const [value] = values
    if (!usable(value)) continue
    const date = timestamp.slice(0, 10)
    const readings = buckets.get(date) ?? []
    readings.push(value)
    buckets.set(date, readings)
  }
  const medians = [...buckets.values()].map(median)
  const conflict = sameKind.some(item => item.recorded_at === reading.recorded_at && item.value !== reading.value)
  const result: Indicator['reference'] = {
    start: new Date(start).toISOString(), end: new Date(end).toISOString(), days: medians.length,
    median: null, change: null, lower: null, upper: null, status: conflict ? 'conflict' : usable(reading.value) ? 'collecting' : 'quality',
  }
  if (result.status !== 'collecting' || medians.length < 5) return result
  const center = median(medians)
  const width = 3 * 1.4826 * median(medians.map(value => Math.abs(value - center)))
  return { ...result, median: center, change: reading.value - center,
    lower: width ? center - width : null, upper: width ? center + width : null,
    status: !width ? 'flat_history' : reading.value > center + width ? 'above' : reading.value < center - width ? 'below' : 'within' }
}

function historyPage(records: Measurement[], { kind, since, until, offset = 0, limit = 12 }: MeasurementQuery = {}) {
  return records.filter(item => (!kind || item.kind === kind) && (!since || item.recorded_at >= since)
    && (!until || item.recorded_at < until)).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id))
    .slice(offset, offset + limit)
}

function makeAssessment(input: AssessmentInput, measurements: Measurement[]): Assessment {
  const readings = measurements.filter(item => input.measurement_ids.includes(item.id))
  if (readings.length !== input.measurement_ids.length || readings.some(item => item.recorded_at > input.assessed_at)) {
    throw new Error('Select measurements available at the time of the assessment.')
  }
  if (!readings.length && !input.symptoms.length) throw new Error('Add a measurement or symptom.')
  const latestByKind = new Map<string, Measurement>()
  for (const item of historyPage(readings, { limit: readings.length })) {
    if (item.kind !== 'sleep_duration' && !latestByKind.has(item.kind)) latestByKind.set(item.kind, item)
  }
  const comparisons = Object.fromEntries([...latestByKind].map(([kind, item]) => {
    const baseline = reference(item, measurements, new URLSearchParams())
    return [kind === 'blood_pressure' ? 'systolic_bp' : kind, {
      observed: item.value, unit: item.unit, samples: baseline.days, reference: baseline.median,
      difference: baseline.change === null ? null : Number(baseline.change.toFixed(2)),
      usable: baseline.status !== 'conflict' && baseline.status !== 'quality',
    }]
  }))
  return {
    ...input, crew_member_id: crewId, status: 'demo_reviewed', protocol_id: null,
    rationale: 'This check-in summarizes the attached sample readings and compares them with earlier readings for this fictional crew member.',
    next_step: 'Record a repeat measurement under comparable conditions, then link it in the follow-up. Use approved mission procedures for actual health concerns.',
    engine_result: { engine_version: 'local-descriptive-1', profile_version: 'lunar-training-1', rationale: [], news2: null,
      comparisons, comparison_window_days: 30, comparison_min_samples: 5 },
  }
}

export function openScenario() {
  return withScenarioLock(seedScenario)
}

function seedScenario() {
  if (readScenario()) return true
  const now = Date.now()
  const time = (offset: number) => new Date(now - offset).toISOString()
  const previous = lunarBaseline.heart
  const [sleep, pulse] = scenarioFrame(missionScenarios[0], 2).latest.values
  const measurements = previous.flatMap((value, index): Measurement[] => {
    const recorded_at = time((index + 1) * day + 3_600_000)
    return [
      { id: `scenario-heart-${index}`, kind: 'heart_rate', value, unit: 'bpm', diastolic: null, recorded_at },
      { id: `scenario-sleep-${index}`, kind: 'sleep_duration', value: lunarBaseline.sleep[index],
        unit: 'h', diastolic: null, recorded_at },
    ]
  })
  measurements.push({ id: 'scenario-heart-current', kind: 'heart_rate', value: pulse!, unit: 'bpm', diastolic: null, recorded_at: time(1_800_000) },
    { id: 'scenario-sleep-current', kind: 'sleep_duration', value: sleep!, unit: 'h', diastolic: null, recorded_at: time(1_800_000) })
  const initial = makeAssessment({ id: scenarioAssessmentId, mission_profile_id: profileId, assessed_at: time(1_200_000),
    symptoms: [{ code: 'fatigue', severity: 4 }], measurement_ids: ['scenario-heart-current', 'scenario-sleep-current'],
    notes: 'Simulated early shift after 5 hours of reported sleep. Heart-rate setup and posture were not logged. Repeat at rest using the training monitor.' }, measurements)
  return saveLocal(scenarioKey, { measurements, assessments: [initial], followUps: {} } satisfies Scenario)
}

const requiredScenario = () => {
  const scenario = readScenario()
  if (!scenario) throw new Error('The synthetic scenario is unavailable on this device.')
  return scenario
}

const practiceRepeatId = 'replay-lunar-resting-repeat'

export function readLunarPractice() {
  const scenario = readScenario()
  const entries = scenario?.followUps[scenarioAssessmentId] ?? []
  return {
    opened: Boolean(scenario?.assessments.some(item => item.id === scenarioAssessmentId)),
    repeat: scenario?.measurements.find(item => item.id === practiceRepeatId),
    linked: entries.some(item => item.measurement_id === practiceRepeatId),
    closed: entries.some(item => item.outcome === 'workflow_complete'),
  }
}

export async function updateLunarPractice(action: 'open' | 'repeat' | 'link' | 'close') {
  if (action === 'open') {
    if (!await openScenario()) throw new Error('Allow site storage to open this fictional check-in.')
    return
  }
  await updateScenario(scenario => {
    const original = scenario.assessments.find(item => item.id === scenarioAssessmentId)
    const entries = scenario.followUps[scenarioAssessmentId] ?? []
    if (!original) throw new Error('Open the fictional check-in first.')
    if (entries.some(item => item.outcome === 'workflow_complete')) return
    const repeat = scenario.measurements.find(item => item.id === practiceRepeatId)
    if (action === 'repeat') {
      if (repeat) return
      const value = scenarioFrame(missionScenarios[0], 3).latest.values[1]!
      scenario.measurements.unshift({ id: practiceRepeatId, kind: 'heart_rate', value, unit: 'bpm', diastolic: null,
        recorded_at: new Date().toISOString() })
      return
    }
    if (!repeat) throw new Error('Record the fictional repeat first.')
    const linked = entries.some(item => item.measurement_id === practiceRepeatId)
    if (action === 'close' && !linked) throw new Error('Link the repeat before closing this check-in.')
    if (action === 'link' && linked) return
    scenario.followUps[scenarioAssessmentId] = [...entries, { id: `${practiceRepeatId}-${action}`, measurement_id: practiceRepeatId,
      measurement: repeat, outcome: action === 'close' ? 'workflow_complete' : 'continue_review', recorded_at: new Date().toISOString() }]
  })
}

function assessmentValues(input: AssessmentInput) {
  return JSON.stringify([input.mission_profile_id, input.assessed_at, input.symptoms, input.measurement_ids, input.notes])
}

export const localMission = {
  measurements: async (_crewId: string, query?: MeasurementQuery) => historyPage(requiredScenario().measurements, query),
  measurement: async (_crewId: string, id: string) => {
    const record = requiredScenario().measurements.find(item => item.id === id)
    if (!record) throw new Error('This measurement is unavailable in the scenario.')
    return record
  },
  assessments: async (_crewId: string) => requiredScenario().assessments,
  assessment: async (_crewId: string, id: string) => {
    const record = requiredScenario().assessments.find(item => item.id === id)
    if (!record) throw new Error('This assessment is unavailable in the scenario.')
    return record
  },
  monitoring: async (_crewId: string, query: URLSearchParams, _signal: AbortSignal): Promise<IndicatorReport> => {
    const through = query.get('through') ?? new Date().toISOString()
    const all = requiredScenario().measurements
    const records = historyPage(all, { limit: all.length }).filter(item => item.recorded_at <= through)
    return { through, indicators: Object.keys(comparisonBounds).flatMap(kind => {
      const item = records.find(reading => reading.kind === kind)
      if (!item) return []
      return [{ parameter: kind, label: kind === 'blood_pressure' ? 'Systolic blood pressure' : measurementLabels[kind],
        unit: item.unit, value: item.value, recorded_at: item.recorded_at, phase: null, activity: null,
        posture: null, timing: null, device: null, quality: 'synthetic', reference: reference(item, records, query) }]
    }) }
  },
  recordMeasurement: (_crewId: string, input: MeasurementInput) => updateScenario(scenario => {
    const existing = scenario.measurements.find(item => item.id === input.id)
    if (existing) {
      if (existing.kind !== input.kind || existing.value !== input.value || existing.diastolic !== input.diastolic
        || existing.recorded_at !== input.recorded_at) throw new Error('This measurement ID already refers to a different reading.')
      return existing
    }
    const record = { ...input, unit: measurementUnits[input.kind] }
    scenario.measurements.unshift(record)
    return record
  }),
  submit: (_crewId: string, input: AssessmentInput) => updateScenario(scenario => {
    const existing = scenario.assessments.find(item => item.id === input.id)
    if (existing) {
      if (assessmentValues(existing) !== assessmentValues(input)) {
        throw new Error('This assessment ID already refers to different data.')
      }
      return existing
    }
    const record = makeAssessment(input, scenario.measurements)
    scenario.assessments.unshift(record)
    return record
  }),
  followUps: async (_crewId: string, id: string) => requiredScenario().followUps[id] ?? [],
  recordFollowUp: (_crewId: string, id: string, input: FollowUpInput) => updateScenario(scenario => {
    const entries = scenario.followUps[id] ?? []
    const existing = entries.find(item => item.id === input.id)
    if (existing) {
      if (existing.measurement_id !== input.measurement_id || existing.outcome !== input.outcome) {
        throw new Error('This follow-up ID already refers to different data.')
      }
      return existing
    }
    if (entries.some(item => item.outcome === 'workflow_complete')) throw new Error('This workflow is already complete.')
    const assessment = scenario.assessments.find(item => item.id === id)
    const measurement = scenario.measurements.find(item => item.id === input.measurement_id)
    if (!assessment || !measurement || measurement.recorded_at <= assessment.assessed_at
      || Date.parse(measurement.recorded_at) > Date.now()
      || entries.some(item => item.measurement_id === measurement.id)) {
      throw new Error('Choose an unused measurement recorded after this assessment.')
    }
    if (assessment.measurement_ids.length && !scenario.measurements.some(item =>
      assessment.measurement_ids.includes(item.id) && item.kind === measurement.kind)) {
      throw new Error('Choose a repeat of an indicator included in the assessment.')
    }
    const entry = { ...input, recorded_at: new Date().toISOString(), measurement }
    scenario.followUps[id] = [...entries, entry]
    return entry
  }),
}
