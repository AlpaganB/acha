export interface MissionProfile {
  id: string
  name: string
  environment: 'spacecraft' | 'orbital_station' | 'lunar_habitat' | 'deep_space'
  equipment: string[]
  constraints: string[]
  guidance_protocol_ids: string[]
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  const headers = new Headers(options?.headers)
  if (options?.body) headers.set('Content-Type', 'application/json')
  try {
    response = await fetch(apiUrl + path, {
      ...options,
      cache: 'no-store',
      headers,
      signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
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

export const api = {
  crew: () => listAll<CrewMember>('/crew-members'),
  profiles: () => listAll<MissionProfile>('/mission-profiles'),
  measurements: (crewId: string, query: { kind?: string; since?: string; until?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams({ limit: '12' })
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    return request<Measurement[]>(`/crew-members/${crewId}/measurements?${params}`)
  },
  recordMeasurement: (crewId: string, input: MeasurementInput) =>
    request<Measurement>(`/crew-members/${crewId}/measurements`, { method: 'POST', body: JSON.stringify(input) }),
  researchRecord: (refresh = false) => request<ResearchRecord>(`/research/bidmc-01${refresh ? '?refresh=true' : ''}`),
  issResearchRecord: () => request<IssResearchRecord>('/research/nasa-rr6-iss'),
  doseResearchRecord: () => request<DoseResearchRecord>('/research/nasa-dostel1'),
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
  setProfile: (crewId: string, profileId: string) =>
    request<CrewMember>(`/crew-members/${crewId}/mission-profile`, {
      method: 'PATCH',
      body: JSON.stringify({ mission_profile_id: profileId }),
    }),
}

export type ObservationScope = 'environment' | 'crew'
export type MissionPhase = 'preflight' | 'in_flight' | 'eva' | 'postflight'
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
}
export interface MissionObservation extends ObservationInput {
  mission_code: string
  scope: ObservationScope
  unit: string
  provenance: 'SYNTHETIC' | 'USER_REPORTED' | 'MANUAL_OBSERVATION' | 'CLINICAL_RECORD'
  method: string
  created_at: string
}

export const observationsApi = {
  parameters: () => request<ParameterDefinition[]>('/observations/parameters'),
  access: (token: string) => request<ObservationAccess>('/observations/access', { headers: { Authorization: `Bearer ${token}` } }),
  list: (token: string, mission: string, query: URLSearchParams, signal: AbortSignal) =>
    request<MissionObservation[]>(`/observations/missions/${encodeURIComponent(mission)}?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    }),
  save: (token: string, mission: string, input: ObservationInput) =>
    request<MissionObservation>(`/observations/missions/${encodeURIComponent(mission)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input),
    }),
}
