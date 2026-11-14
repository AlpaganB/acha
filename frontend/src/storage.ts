import type { AssessmentInput, CrewMember, MissionProfile } from './api'

export interface Workspace {
  crew: CrewMember[]
  profiles: MissionProfile[]
}

export interface QueuedAssessment {
  crewId: string
  input: AssessmentInput
}

const namespace = 'acha.v1.'
const queuePrefix = `${namespace}pending.`

export function readLocal<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(namespace + key) ?? 'null') as T | null
  } catch {
    return null
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(namespace + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function queueAssessment(entry: QueuedAssessment) {
  return saveLocal(`pending.${entry.input.id}`, entry)
}

export function listQueued(crewId?: string) {
  try {
    return Object.keys(localStorage)
      .filter(key => key.startsWith(queuePrefix))
      .map(key => readLocal<QueuedAssessment>(key.slice(namespace.length)))
      .filter((entry): entry is QueuedAssessment =>
        Boolean(entry?.input?.id && (!crewId || entry.crewId === crewId)))
      .sort((a, b) => a.input.assessed_at.localeCompare(b.input.assessed_at))
  } catch {
    return []
  }
}

export function removeQueued(id: string) {
  try {
    localStorage.removeItem(queuePrefix + id)
  } catch {
    // The server accepts a retry with the same ID if the local copy remains.
  }
}
