import { useEffect, useState } from 'react'
import type { useMission } from './useMission'

export function RecordedWorkflow({ mission, onStartTraining }: {
  mission: ReturnType<typeof useMission>; onStartTraining: () => void
}) {
  const { selected, reachable, records } = mission
  const measurement = mission.measurements[0]
  const assessment = mission.history[0]
  const assessmentId = assessment?.status !== 'pending' ? assessment?.id : undefined
  const crewId = selected?.id
  const [followUpResult, setFollowUpResult] = useState<{ assessmentId: string; open: boolean }>()

  useEffect(() => {
    if (!crewId || !assessmentId || !reachable) return
    let active = true
    void records.followUps(crewId, assessmentId).then(entries => {
      if (!active) return
      const closed = entries.some(entry => entry.outcome === 'workflow_complete')
      setFollowUpResult({ assessmentId, open: !closed })
    }, () => {
      if (active) setFollowUpResult({ assessmentId, open: false })
    })
    return () => { active = false }
  }, [crewId, assessmentId, reachable, records])

  const followUp = reachable && followUpResult?.assessmentId === assessmentId ? followUpResult : undefined
  const awaitingResult = assessment?.status === 'pending'
  const assessMeasurement = measurement && !assessment?.measurement_ids.includes(measurement.id)
  const assessUrl = awaitingResult ? `/assessments/${assessment.id}`
    : assessMeasurement ? `/assessment?measurement=${encodeURIComponent(measurement.id)}` : '/assessment'

  return <div className="overview-next-actions">
    {followUp?.open && assessmentId
      ? <a className="text-link" href={`/assessments/${assessmentId}`}>Review follow-up</a>
      : selected && (awaitingResult || assessMeasurement) &&
        <a className="text-link" href={assessUrl}>{awaitingResult ? 'Open pending assessment' : 'Assess latest reading'}</a>}
    <button className="text-link" type="button" onClick={onStartTraining}>Start training scenario</button>
  </div>
}
