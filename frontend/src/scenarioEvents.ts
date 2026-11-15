import { missionElapsed, scenarioFrame, type MissionScenario } from './missionScenarioData.ts'

export type ScenarioId = MissionScenario['id']
export type System = 'recovery' | 'cardiorespiratory' | 'environment'
export type Category = 'health' | 'operations' | 'quality' | 'escalation'
export const categoryLabels: Record<Category, string> = {
  health: 'Health observation', operations: 'Mission operations', quality: 'Data quality', escalation: 'Approved escalation',
}

export const scenarioSystems: Record<ScenarioId, System> = {
  'lunar-fatigue': 'recovery', 'orbital-pressure': 'cardiorespiratory', 'solar-event': 'environment',
}

type EventDefinition = {
  type: string; index: number; category: Exclude<Category, 'escalation'>; title: string; column?: number;
  until?: number; context: string; workflow: string; personal?: boolean; reference?: number;
}

const definitions: Record<ScenarioId, EventDefinition[]> = {
  'lunar-fatigue': [
    { type: 'shorter-sleep', index: 1, until: 1, category: 'health', title: 'Shorter sleep and slower task performance', column: 0,
      personal: true, context: 'Sleep is self-reported and reaction time comes from a training task. Recent workload and the changed schedule are recorded alongside both observations.', workflow: 'Inspect the readings and log the shift context.' },
    { type: 'pulse-review', index: 2, until: 4, category: 'health', title: 'Heart rate above this crew member’s reference', column: 1,
      personal: true, context: 'Comparison provisional; activity/posture unavailable. The observations do not establish that shorter sleep caused the pulse change.', workflow: 'Open the fictional check-in and record a repeat at rest.' },
    { type: 'unsampled-task', index: 3, category: 'quality', title: 'No new sleep or reaction measurement', column: 2,
      personal: true, context: 'This checkpoint contains a resting pulse repeat only.', workflow: 'Keep the earlier observations at their original times.' },
    { type: 'resting-repeat', index: 3, category: 'health', title: 'Resting repeat moves closer to reference', column: 1,
      personal: true, context: 'A resting repeat adds context. The original pulse remains available and the two samples have different documented conditions.', workflow: 'Review the repeat with the original observation.' },
    { type: 'outcome-review', index: 6, category: 'operations', title: 'Training outcome ready for documentation', column: 1,
      personal: true, context: 'Later observations are closer to the reference. Closing a record documents the workflow and does not establish clinical clearance.', workflow: 'Review and explicitly close the fictional follow-up.' },
  ],
  'orbital-pressure': [
    { type: 'pressure-drop', index: 2, category: 'operations', title: 'Cabin pressure fell from 101.3 to 96.3 kPa', column: 0, reference: 101.3,
      context: 'The transition took 15 minutes (−0.33 kPa/min). Total pressure alone cannot establish inspired oxygen. Exercise overlaps the pulse change; attribution uncertain.', workflow: 'Inspect cabin and crew traces and document activity.' },
    { type: 'pressure-gap', index: 3, category: 'quality', title: 'Cabin pressure samples unavailable', column: 0,
      context: 'The cabin pressure sensor has a gap; crew channels retain their own coverage. The 97 kPa line is an exercise analysis boundary only.', workflow: 'Log the gap and inspect covered intervals.' },
    { type: 'symptom-report', index: 3, until: 4, category: 'health', title: 'Crew reported ear fullness', personal: true, column: 3,
      context: 'Ear fullness is a reported symptom. A later checkpoint adds a mild headache. Cabin pressure and crew measurements alone cannot establish a diagnosis.', workflow: 'Review the separate symptom and activity notes.' },
    { type: 'exercise-overlap', index: 4, category: 'health', title: 'Pulse change overlaps exercise', column: 1, personal: true,
      context: 'Exercise overlaps change; attribution uncertain. Compare any repeat against a comparable resting observation.', workflow: 'Check measurement conditions and review a resting repeat.' },
    { type: 'pressure-recovery', index: 5, category: 'operations', title: 'Separate pressure recovery observed', column: 0, reference: 96.3,
      context: 'The instrument reaches 101.3 kPa again. The earlier sampling gap remains in the record.', workflow: 'Review both transitions and measured coverage.' },
  ],
  'solar-event': [
    { type: 'relay-outage', index: 1, until: 4, category: 'operations', title: 'Simulated Earth relay unavailable',
      context: 'Crew observations remain in the exercise timeline during the fictional outage.', workflow: 'Review the local record and preserve original times.' },
    { type: 'vehicle-monitor', index: 2, until: 3, category: 'operations', title: 'Environmental instrument reading reached 250 µGy/h', column: 0,
      context: 'Fixed vehicle monitor measures an absorbed dose rate. The crew dosimeter separately reports accumulated absorbed dose in µGy; neither yields effective dose.', workflow: 'Inspect each instrument and its sample time.' },
    { type: 'relay-queued', index: 2, until: 4, category: 'operations', title: 'Simulated handover queued locally',
      context: 'Original event times are preserved while the simulated link is unavailable.', workflow: 'Review the handover contents and queue time.' },
    { type: 'dosimeter-gap', index: 4, category: 'quality', title: 'Personal dosimeter sample unavailable', column: 1, personal: true,
      context: 'The vehicle instrument cannot fill this personal coverage gap.', workflow: 'Retain the gap and check the next personal sample.' },
    { type: 'relay-sent', index: 5, category: 'operations', title: 'Simulated handover sent',
      context: 'The fictional relay has returned and the scripted handover awaits receipt.', workflow: 'Compare the simulated send time with the original observation times.' },
    { type: 'relay-acknowledged', index: 6, category: 'operations', title: 'Simulated ground receipt acknowledged',
      context: 'Receipt records a simulated delivery. Clinical review is outside this exercise.', workflow: 'Inspect the queue, send and receipt timeline.' },
  ],
}

export function sampleContext(id: ScenarioId, column: number, index: number) {
  if (id === 'lunar-fatigue') return [
    'Crew sleep report · previous 24 hours',
    index === 1 || index === 2 ? 'Training pulse · activity/posture unavailable' : index === 0 || index === 3 ? 'Training pulse · at rest' : 'Training pulse · repeat conditions unrecorded',
    'Training reaction task · same task',
  ][column]
  if (id === 'orbital-pressure') return column === 0 ? 'Cabin pressure monitor · 5 min samples'
    : index >= 2 && index <= 4 ? 'Crew spot values in 5 min trace · exercise context' : 'Crew observations in 5 min trace'
  return column === 0 ? 'Fixed vehicle monitor · recorded checkpoints' : 'Personal dosimeter · exercise-window accumulation'
}

const priorities = { Review: 0, 'Data issue': 1, Info: 2 } as const

export function scenarioEvents(scenario: MissionScenario, frame: ReturnType<typeof scenarioFrame>) {
  const currentIndex = frame.checkpoints.length - 1
  return definitions[scenario.id].filter(item => item.index <= currentIndex).map(item => {
    const checkpoint = scenario.checkpoints[item.index]
    const source = item.column === undefined ? 'Scripted training log' : sampleContext(scenario.id, item.column, item.index)
    const metric = item.column === undefined ? undefined : scenario.metrics[item.column]
    const observedAt = checkpoint.minute
    const currentValue = item.column === undefined ? null : scenario.readings.find(reading => reading.minute === observedAt)?.values[item.column] ?? null
    const reference = item.reference ?? metric?.reference ?? null
    const severity: keyof typeof priorities = item.category === 'quality' ? 'Data issue' : item.category === 'health' && item.type !== 'resting-repeat' ? 'Review' : 'Info'
    return {
      id: `${scenario.id}:${item.type}`, scenarioId: scenario.id, crewId: item.personal ? `${scenario.id}:crew` : undefined,
      eventType: item.type, title: item.title, category: item.category, severity, observedAt, firstSeenAt: observedAt,
      source, metric: metric?.label, column: item.column, currentValue, unit: metric?.unit, reference,
      delta: currentValue === null || reference === null ? null : currentValue - reference,
      comparisonContext: item.context, dataQuality: item.category === 'quality' ? 'Sample unavailable' : item.type === 'pulse-review' ? 'Provisional comparison' : 'Scripted observation',
      rationale: checkpoint.system, validationScope: 'Synthetic · Training only', recommendedWorkflow: item.workflow,
      link: `/scenarios/${scenario.id}?step=${item.index + 1}`, frameIndex: item.index, system: scenarioSystems[scenario.id],
      status: (currentIndex <= (item.until ?? item.index) ? 'current' : 'recorded') as 'current' | 'recorded',
      timeLabel: missionElapsed(observedAt),
    }
  }).sort((a, b) => priorities[a.severity] - priorities[b.severity] || b.observedAt - a.observedAt)
}

export type ScenarioEvent = ReturnType<typeof scenarioEvents>[number]
