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
  try {
    response = await fetch(apiUrl + path, {
      ...options,
      cache: 'no-store',
      headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(8000),
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
  measurements: (crewId: string) =>
    request<Measurement[]>(`/crew-members/${crewId}/measurements?limit=12`),
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
