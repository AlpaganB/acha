import demoCatalog from '../../demo/mission_demo.json'
import type { MissionProfile } from './api'

export const symptoms = [
  { code: 'headache', label: 'Headache', icon: 'head' },
  { code: 'dizziness', label: 'Dizziness', icon: 'waves' },
  { code: 'nausea', label: 'Nausea', icon: 'stomach' },
  { code: 'fatigue', label: 'Fatigue', icon: 'battery' },
  { code: 'chest_pain', label: 'Chest pain', icon: 'heart' },
  { code: 'shortness_of_breath', label: 'Shortness of breath', icon: 'wind' },
  { code: 'loss_of_consciousness', label: 'Loss of consciousness', icon: 'heart' },
  { code: 'new_confusion', label: 'New confusion', icon: 'head' },
  { code: 'other', label: 'Other symptom', icon: 'plus' },
] as const

export const environmentLabels: Record<MissionProfile['environment'], string> = {
  spacecraft: 'Spacecraft',
  orbital_station: 'Orbital station',
  lunar_habitat: 'Lunar habitat',
  deep_space: 'Deep space',
}

export const measurementLabels: Record<string, string> = {
  heart_rate: 'Heart rate',
  spo2: 'Blood oxygen',
  blood_pressure: 'Blood pressure',
  body_temperature: 'Body temperature',
}

interface Guide {
  id: string
  title: string
  description: string
  handoff: string[]
  demoReference: keyof typeof demoCatalog.guides
}

const guideTopics: Guide[] = [
  {
    id: 'chest_pain',
    title: 'Chest pain',
    description: 'Chest pain or discomfort reported by a crew member',
    handoff: ['When the discomfort started', 'How the crew member describes it', 'Other symptoms or recent readings already available'],
    demoReference: 'DEMO-CHEST',
  },
  {
    id: 'shortness_of_breath',
    title: 'Breathing difficulty',
    description: 'Reported or observed difficulty breathing',
    handoff: ['When the breathing difficulty started', 'Where the crew member was and what they were doing', 'Other symptoms or recent readings already available'],
    demoReference: 'DEMO-BREATHING',
  },
  {
    id: 'loss_of_consciousness',
    title: 'Loss of consciousness',
    description: 'Unresponsiveness or a report of fainting',
    handoff: ['The crew member’s location', 'When the event was first observed', 'What the reporting crew member witnessed'],
    demoReference: 'DEMO-UNRESPONSIVE',
  },
  {
    id: 'demo-urgent',
    title: 'Immediate crew medical review',
    description: 'Handover for an urgent assessment',
    handoff: [],
    demoReference: 'DEMO-URGENT',
  },
  {
    id: 'demo-review',
    title: 'Review a check-in',
    description: 'Handover for an assessment flagged for review',
    handoff: [],
    demoReference: 'DEMO-REVIEW',
  },
]

export const guides = guideTopics.map(topic => ({
  ...topic,
  ...demoCatalog.guides[topic.demoReference],
  title: topic.title,
  source: topic.demoReference === 'DEMO-BREATHING'
    ? 'https://www.redcross.org/content/dam/redcross/training-services/no-index/First%20Aid-CPR-AED-Participant%27s-Manual.pdf'
    : demoCatalog.guides[topic.demoReference].source,
}))

export function guideTopicId(reference: string) {
  const lower = reference.toLowerCase()
  return guides.find(guide => guide.demoReference.toLowerCase() === lower)?.id ?? lower
}

export function symptomLabel(code: string) {
  const equivalents: Record<string, string> = {
    breathing_difficulty: 'shortness_of_breath',
    unresponsive: 'loss_of_consciousness',
  }
  return symptoms.find(symptom => symptom.code === (equivalents[code] ?? code))?.label ?? humanize(code)
}

export function humanize(value: string) {
  const words = value.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value))
}
