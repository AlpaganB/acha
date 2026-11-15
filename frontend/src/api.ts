export interface MissionProfile {
  id: string
  name: string
  environment: 'spacecraft' | 'orbital_station' | 'lunar_habitat' | 'deep_space'
  equipment: string[]
  constraints: string[]
  guidance_protocol_ids: string[]
  measurement_schedules?: { kind: string; interval_minutes: number }[]
}

export interface CrewMember {
  id: string
  display_name: string
  mission_profile_id: string
}

export interface Symptom {
  code: string
  severity: number | null
}

export interface Measurement {
  id: string
  kind: string
  value: number
  diastolic: number | null
  unit: string
  recorded_at: string
}

export type MeasurementInput = Omit<Measurement, 'unit'>

export interface MeasurementQuery {
  kind?: string
  since?: string
  until?: string
  limit?: number
  offset?: number
}

export interface FollowUpInput {
  id: string
  measurement_id: string
  outcome: 'continue_review' | 'workflow_complete'
}

export interface FollowUpEntry extends FollowUpInput {
  recorded_at: string
  measurement: Measurement
}

export interface ResearchRecord {
  source: string
  record: string
  retrieval: 'physionet' | 'bundled'
  samples: { seconds: number; heart_rate: number | null; pulse_rate: number | null; respiratory_rate: number | null; spo2: number | null }[]
  medians: Record<string, number | null>
}

export interface IssResearchRecord {
  dataset_id: 'RR-6'
  provenance: 'NASA_REAL'
  source: string
  download: string
  samples: { recorded_at: string; temperature_c: number | null; relative_humidity_pct: number | null; carbon_dioxide_ppm: number | null }[]
}

export interface DoseResearchRecord {
  dataset_id: 'DosTel1'
  source: string
  download: string
  identical_duplicates?: number
  conflicting_timestamps?: number
  samples: { timestamp: string; absorbed_dose_rate: number | null; dose_equivalent_rate: number | null }[]
}

export interface AssessmentInput {
  id: string
  mission_profile_id: string
  assessed_at: string
  symptoms: Symptom[]
  measurement_ids: string[]
  notes: string | null
}

export interface Assessment extends AssessmentInput {
  crew_member_id: string
  status: string
  rationale: string | null
  next_step: string | null
  protocol_id: string | null
  engine_result?: EngineResult | null
}

export interface EngineFinding {
  code: string
  status: string
  metric: string | null
  symptom: string | null
  observed: number | null
  unit: string | null
}

export interface EngineResult {
  engine_version: string
  profile_version: string
  rationale: EngineFinding[]
  news2: { complete: boolean; total_score: number | null } | null
  comparisons?: Record<string, {
    observed: number; unit: string; samples: number; reference: number | null; difference: number | null
    median_absolute_deviation?: number | null; usable: boolean
  }>
  comparison_window_days?: number
  comparison_min_samples?: number
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }

  get retryable() {
    return this.status === 0 || this.status >= 500 || [408, 429].includes(this.status)
  }
}

const apiUrl = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '')

async function request<T>(path: string, options?: RequestInit, timeoutMs = 8000): Promise<T> {
  let response: Response
  const headers = new Headers(options?.headers)
  if (options?.body) headers.set('Content-Type', 'application/json')
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    response = await fetch(apiUrl + path, {
      ...options,
      cache: 'no-store',
      headers,
      signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    })
  } catch {
    throw new ApiError(0, 'The mission service could not be reached.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    const message = Array.isArray(detail)
      ? detail.map(issue => String(issue.msg)).join(' ')
      : detail
    throw new ApiError(response.status, message || `Mission service returned ${response.status}.`)
  }

  try {
    return await response.json() as T
  } catch {
    throw new ApiError(502, 'The mission service did not return a response the app could read.')
  }
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = []
  for (let offset = 0; ; offset += 200) {
    const page = await request<T[]>(`${path}?limit=200&offset=${offset}`)
    items.push(...page)
    if (page.length < 200) return items
  }
}

export type MissionProfileInput = Omit<MissionProfile, 'id'>
export interface AssessmentResultInput { status: string; rationale: string; next_step: string; protocol_id: string | null }
export interface DeviceSampleInput {
  sequence: number; recorded_at: string; mission_elapsed_ms: number; clock_error_ms: number; firmware: string
  quality: 'ok' | 'saturated' | 'detached' | 'artefact'; value: number | null; uncertainty: number | null
  activity: 'unknown' | 'rest' | 'exercise' | 'task'
}
export interface DeviceReceipt { sequence: number; status: string; observation_id: string | null }

export const api = {
  createCrew: (input: { display_name: string; mission_profile_id: string }) =>
    request<CrewMember>('/crew-members', { method: 'POST', body: JSON.stringify(input) }),
  crewMember: (id: string, signal: AbortSignal) => request<CrewMember>(`/crew-members/${id}`, { signal }),
  createProfile: (input: MissionProfileInput) =>
    request<MissionProfile>('/mission-profiles', { method: 'POST', body: JSON.stringify(input) }),
  profile: (id: string, signal: AbortSignal) => request<MissionProfile>(`/mission-profiles/${id}`, { signal }),
  measurement: (crewId: string, id: string, signal?: AbortSignal) =>
    request<Measurement>(`/crew-members/${crewId}/measurements/${id}`, { signal }),
  storeAssessmentResult: (crewId: string, id: string, input: AssessmentResultInput) =>
    request<Assessment>(`/crew-members/${crewId}/assessments/${id}/result`, { method: 'PUT', body: JSON.stringify(input) }),
  crew: () => listAll<CrewMember>('/crew-members'),
  profiles: () => listAll<MissionProfile>('/mission-profiles'),
  monitoring: (crewId: string, query: URLSearchParams, signal: AbortSignal) =>
    request<IndicatorReport>(`/crew-members/${crewId}/monitoring?${query}`, { signal }),
  measurements: (crewId: string, query: MeasurementQuery = {}) => {
    const params = new URLSearchParams({ limit: '12' })
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    return request<Measurement[]>(`/crew-members/${crewId}/measurements?${params}`)
  },
  recordMeasurement: (crewId: string, input: MeasurementInput) =>
    request<Measurement>(`/crew-members/${crewId}/measurements`, { method: 'POST', body: JSON.stringify(input) }),
  researchRecord: (refresh = false) => request<ResearchRecord>(`/research/bidmc-01${refresh ? '?refresh=true' : ''}`),
  waveforms: (start: number, signal: AbortSignal) =>
    request<WaveformWindow>(`/research/bidmc-01-waveforms?start=${start}`, { signal }, 20_000),
  assayCoverage: (study: AssayCoverage['study'], signal: AbortSignal) =>
    request<AssayCoverage>(`/research/osdr-assays/${study}`, { signal }, 20_000),
  issResearchRecord: (window: 'day' | 'week' = 'day') => request<IssResearchRecord>(`/research/nasa-rr6-iss?window=${window}`),
  doseResearchRecord: (window: 'sample' | 'day' = 'sample', signal?: AbortSignal) =>
    request<DoseResearchRecord>(`/research/nasa-dostel1?window=${window}`, { signal }),
  assessments: (crewId: string) =>
    request<Assessment[]>(`/crew-members/${crewId}/assessments?limit=20`),
  assessment: (crewId: string, id: string) =>
    request<Assessment>(`/crew-members/${crewId}/assessments/${id}`),
  evaluate: (crewId: string, id: string) =>
    request<Assessment>(`/crew-members/${crewId}/assessments/${id}/evaluate`, { method: 'POST' }),
  submit: (crewId: string, input: AssessmentInput) =>
    request<Assessment>(`/crew-members/${crewId}/assessments?evaluate=true`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  followUps: (crewId: string, id: string) =>
    request<FollowUpEntry[]>(`/crew-members/${crewId}/assessments/${id}/follow-ups`),
  recordFollowUp: (crewId: string, id: string, input: FollowUpInput) =>
    request<FollowUpEntry>(`/crew-members/${crewId}/assessments/${id}/follow-ups`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  setProfile: (crewId: string, profileId: string) =>
    request<CrewMember>(`/crew-members/${crewId}/mission-profile`, {
      method: 'PATCH',
      body: JSON.stringify({ mission_profile_id: profileId }),
    }),
}

export type ObservationScope = 'environment' | 'crew'
export interface WaveformWindow {
  record: string
  source: string
  header: string
  download: string
  start_seconds: number
  sample_rate_hz: number
  channels: { code: 'II' | 'PLETH' | 'RESP'; unit: string; values: (number | null)[] }[]
}
export interface AssayCoverage {
  study: 'OSD-575' | 'OSD-656'
  specimen: string
  source: string
  download: string
  rows: number
  fields: { name: string; unit: string; numeric_rows: number; other_rows: number }[]
}
export type MissionPhase = 'preflight' | 'in_flight' | 'eva' | 'postflight'
interface SessionConditions {
  shift: string
  utc_offset_minutes: number
  illuminance_lux: number | null
  workload: number | null
}
export interface SleepEpisode extends SessionConditions {
  kind: 'sleep_episode'
  method: 'self_report' | 'actigraphy' | 'polysomnography'
  attempted_sleep_at: string
  sleep_onset_at: string
  final_wake_at: string
  out_of_bed_at: string
  awake_after_onset_minutes: number
  interruptions: number
}
export type ObservationContext = SleepEpisode
  | (SessionConditions & { kind: 'performance'; protocol: string; version: string; trials: number; valid_trials: number })
  | { kind: 'radiation'; source_ref: string; geometry_ref: string; shielding_ref: string; particle_class: string }
  | { kind: 'dose_estimate'; source_ref: string; model_version: string; tissue: string | null }
  | { kind: 'protocol'; protocol: string; version: string; source_ref: string; body_site: string | null; specimen: string | null }
  | { kind: 'reading'; posture: string; timing: string }
  | { kind: 'exercise_interval'; start: string; end: string; mode: string; intensity: string }
  | { kind: 'gravity_interval'; start: string; end: string; regime: string; source_ref: string }
  | RadiationAssessmentContext

export interface RadiationAssessmentContext {
  kind: 'radiation_assessment'
  basis: 'nasa_career_effective' | 'organ_gray_equivalent' | 'hippocampal_absorbed' | 'lifetime_cancer_risk'
  model: string
  model_version: string
  source_ref: string
  input_manifest_ref: string
  review_ref: string
  exposure_start: string
  exposure_end: string
  lower: number
  upper: number
  interval_description: string
  tissue: string | null
  complete_history: boolean
  includes_mission_projection: boolean
  excludes_medical_exposure: boolean
}

export type HealthReviewAction = 'reviewed' | 'recheck_requested' | 'referred_to_flight_team'

export interface HealthReviewAcknowledgment {
  decision_key: string
  actor: string
  action: HealthReviewAction
  recorded_at: string
}

export interface HealthReviewDecision {
  rule_id: string
  title: string
  status: 'insufficient_data' | 'boundary_uncertain' | 'within_rule' | 'review_required'
  explanation: string
  unit: string
  minimum: number | null
  maximum: number | null
  maximum_exclusive: boolean
  value: number | null
  lower: number | null
  upper: number | null
  observed_at: string | null
  observation_ids: string[]
  procedure_ref: string
  evidence: string
  source_url: string | null
  decision_key: string | null
  acknowledgment: HealthReviewAcknowledgment | null
}

interface HealthReviewApproval {
  authority: string
  reference: string
}

export interface HealthReviewReport {
  evaluated_at: string
  policy: {
    version: string
    flight_medicine: HealthReviewApproval | null
    radiation_safety: HealthReviewApproval | null
  } | null
  decisions: HealthReviewDecision[]
  references: {
    rule_id: string; title: string; limit: number; unit: string; requirement: string; standard: string
    comparator: 'minimum_inclusive' | 'maximum_inclusive' | 'maximum_exclusive'
    required_evidence: string; source_url: string
  }[]
  model_results: MissionObservation[]
  recent_acknowledgments: (HealthReviewAcknowledgment & { policy_version: string; title: string })[]
}

export interface Indicator {
  parameter: string
  label: string
  unit: string
  value: number
  recorded_at: string
  phase: MissionPhase | null
  activity: ObservationInput['activity'] | null
  posture: string | null
  timing: string | null
  device: string | null
  quality: string
  reference: {
    start: string; end: string; days: number; median: number | null; change: number | null
    lower: number | null; upper: number | null
    status: 'collecting' | 'flat_history' | 'within' | 'above' | 'below' | 'quality' | 'conflict'
  }
}

export interface IndicatorReport {
  through: string
  indicators: Indicator[]
}

export interface CrewReport extends IndicatorReport {
  adaptation: {
    parameter: string; label: string; unit: string; phase: MissionPhase; value: number; recorded_at: string
    preflight: number | null; change: number | null; percentage_change: number | null; days: number
  }[]
  daily_context: {
    date: string; intake: Record<string, number | null>; exercise_minutes: number | null
    exercise_by_mode: Record<string, number>; exercise_conflict_minutes: number; untimed_exercise_minutes: number | null
  }[]
  gravity: { since: string; through: string; hours: Record<string, number>; conflict_hours: number; unlogged_hours: number } | null
}

export interface CrewIdentity {
  crew_code: string
  last_observation: string | null
}

export interface CrewRadiationReport {
  start: string
  end: string
  start_source: 'selected_period' | 'mission_clock' | 'first_record'
  channels: {
    channel: string; location: string; calibration: string; parameter: string; unit: string; reported_rate_unit: string
    context: Extract<ObservationContext, { kind: 'radiation' }>
    last_rate: number | null; last_sample: string | null; dose: number | null; rad: number | null
    lower: number | null; upper: number | null; coverage: number; covered_hours: number; gap_intervals: number
    daily: { date: string; covered_hours: number; dose: number; running_observed_dose: number }[]
  }[]
  counters: { observation: MissionObservation; change: number | null; rad: number | null; reset: boolean }[]
  estimates: MissionObservation[]
  reported_rates: MissionObservation[]
}

export interface ParameterDefinition {
  id: string
  label: string
  category: string
  unit: string
  method: string
  cadence: string
  priority: string
  source: string
  scope: ObservationScope
  minimum: number | null
  maximum: number | null
  input_kind: 'number' | 'event'
  context_kind?: ObservationContext['kind'] | null
}
export interface ObservationAccess {
  actor: string
  role: 'operations' | 'medical'
  missions: string[]
}
export interface ObservationInput {
  id: string
  crew_code: string | null
  location: string
  phase: MissionPhase
  activity: 'unknown' | 'rest' | 'exercise' | 'task'
  parameter: string
  value: number | null
  event_text: string | null
  quality: 'unverified' | 'verified' | 'suspect'
  device: string | null
  calibration: string | null
  uncertainty: number | null
  recorded_at: string
  context?: ObservationContext | null
}
export interface MissionObservation extends ObservationInput {
  mission_code: string
  scope: ObservationScope
  unit: string
  provenance: 'SYNTHETIC' | 'USER_REPORTED' | 'MANUAL_OBSERVATION' | 'CLINICAL_RECORD' | 'DEVICE_REPORTED'
  method: string
  created_at: string
}

export interface ChannelQuality {
  channel: string
  parameter: string
  unit: string
  firmware: string
  calibration: string
  sample_interval_ms: number | null
  last_sample_at: string | null
  last_received_at: string | null
  missing_sequences: number
  counts: Record<string, number>
}

export interface RadiationReviewInput {
  channel: string
  end: string
  boundary: number
  window_seconds: number
  maximum_gap_seconds: number
  minimum_coverage: number
  minimum_exceedance_seconds: number
  uncertainty_margin: number
}

export interface RadiationReview {
  parameter: string
  unit: string
  start: string
  end: string
  coverage: number
  longest_exceedance_seconds: number
  result: 'insufficient_data' | 'boundary_exceeded' | 'boundary_not_observed'
}

export const observationsApi = {
  ingestSample: (key: string, mission: string, channel: string, sample: DeviceSampleInput, signal: AbortSignal) =>
    request<DeviceReceipt>(`/observations/missions/${encodeURIComponent(mission)}/devices/${encodeURIComponent(channel)}/samples`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(sample), signal,
    }),
  deployment: (signal: AbortSignal) => request<{ status: string; workspace?: string }>('/health', { signal }),
  parameters: () => request<ParameterDefinition[]>('/observations/parameters'),
  access: (token: string) => request<ObservationAccess>('/observations/access', { headers: { Authorization: `Bearer ${token}` } }),
  crew: (token: string, mission: string, signal: AbortSignal) =>
    request<CrewIdentity[]>(`/observations/missions/${encodeURIComponent(mission)}/crew`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }),
  monitoring: (token: string, mission: string, crew: string, query: URLSearchParams, signal: AbortSignal) =>
    request<CrewReport>(`/observations/missions/${encodeURIComponent(mission)}/crew/${encodeURIComponent(crew)}/monitoring?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }),
  healthReview: (token: string, mission: string, crew: string, signal: AbortSignal) =>
    request<HealthReviewReport>(`/observations/missions/${encodeURIComponent(mission)}/crew/${encodeURIComponent(crew)}/health-review`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }),
  acknowledgeHealthReview: (token: string, mission: string, crew: string, input: { decision_key: string; action: HealthReviewAction },
    signal: AbortSignal) =>
    request<HealthReviewAcknowledgment>(`/observations/missions/${encodeURIComponent(mission)}/crew/${encodeURIComponent(crew)}/health-review/acknowledgments`, {
      headers: { Authorization: `Bearer ${token}` }, method: 'POST', body: JSON.stringify(input), signal,
    }),
  radiation: (token: string, mission: string, crew: string, query: URLSearchParams, signal: AbortSignal) =>
    request<CrewRadiationReport>(`/observations/missions/${encodeURIComponent(mission)}/crew/${encodeURIComponent(crew)}/radiation?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }, 20_000),
  list: (token: string, mission: string, query: URLSearchParams, signal: AbortSignal) =>
    request<MissionObservation[]>(`/observations/missions/${encodeURIComponent(mission)}?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }),
  save: (token: string, mission: string, input: ObservationInput) =>
    request<MissionObservation>(`/observations/missions/${encodeURIComponent(mission)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input),
    }),
  channels: (token: string, mission: string, query: URLSearchParams, signal: AbortSignal) =>
    request<ChannelQuality[]>(`/observations/missions/${encodeURIComponent(mission)}/devices?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }),
  reviewRadiation: (token: string, mission: string, input: RadiationReviewInput, signal: AbortSignal) =>
    request<RadiationReview>(`/observations/missions/${encodeURIComponent(mission)}/radiation/review`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal,
    }),
}
