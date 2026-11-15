import { useEffect, useState } from 'react'
import { Activity, ArrowRight, ClipboardList, ListChecks, Play } from 'lucide-react'
import { formatDate, measurementLabels } from './content'
import type { useMission } from './useMission'

export function RecordedWorkflow({ mission, onStartTraining }: {
  mission: ReturnType<typeof useMission>; onStartTraining: () => void
}) {
  const { selected, profile, reachable, records, local } = mission
  const measurement = mission.measurements[0]
  const assessment = mission.history[0]
  const assessmentId = assessment?.status !== 'pending' ? assessment?.id : undefined
  const crewId = selected?.id
  const [followUpResult, setFollowUpResult] = useState<{ assessmentId: string; text: string; open: boolean }>()

  useEffect(() => {
    if (!crewId || !assessmentId || !reachable) return
    let active = true
    void records.followUps(crewId, assessmentId).then(entries => {
      if (!active) return
      const closed = entries.some(entry => entry.outcome === 'workflow_complete')
      setFollowUpResult({ assessmentId, text: closed ? 'Follow-up closed' : entries.length ? 'Follow-up open' : 'No repeat linked yet', open: !closed })
    }, () => {
      if (active) setFollowUpResult({ assessmentId, text: 'Follow-up status unavailable', open: false })
    })
    return () => { active = false }
  }, [crewId, assessmentId, reachable, records])

  const followUp = reachable && followUpResult?.assessmentId === assessmentId ? followUpResult : undefined
  const awaitingResult = assessment?.status === 'pending'
  const assessMeasurement = measurement && !assessment?.measurement_ids.includes(measurement.id)
  const primary = !selected || !reachable || !measurement ? 'record'
    : followUp?.open ? 'follow-up' : assessMeasurement || awaitingResult ? 'assess' : 'record'
  const assessUrl = awaitingResult ? `/assessments/${assessment.id}`
    : assessMeasurement ? `/assessment?measurement=${encodeURIComponent(measurement.id)}` : '/assessment'

  return <section className="surface recorded-workflow" aria-labelledby="recorded-workflow-title">
    <header className="recorded-workflow-heading">
      <div><h2 id="recorded-workflow-title">Crew health workflow</h2>
        <p>{selected ? `${selected.display_name} · ${profile?.name ?? 'Mission unassigned'}` : 'Choose a crew member to start.'}</p></div>
      <a className="text-link" href="/monitoring">Crew monitoring <ArrowRight size={14} aria-hidden="true" /></a>
    </header>
    <div className="recorded-workflow-steps">
      <div>
        <h3><Activity size={16} aria-hidden="true" /> Record</h3>
        {measurement ? <p><strong>{measurementLabels[measurement.kind] ?? measurement.kind} · {measurement.value}{measurement.diastolic !== null && `/${measurement.diastolic}`} {measurement.unit}</strong>
          <time dateTime={measurement.recorded_at}>{formatDate(measurement.recorded_at)}</time></p>
          : <p>{mission.measurementsPending ? 'Checking measurement history…' : mission.measurementsAvailable
            ? 'No measurements saved for this crew member.' : 'Measurement history unavailable.'}</p>}
        <a className={`button ${primary === 'record' ? 'primary' : 'secondary'}`} href={selected ? '/measurements' : '/crew'}>
          {!selected ? 'Choose crew' : reachable ? 'Record a measurement' : 'View measurements'}</a>
      </div>
      <div>
        <h3><ClipboardList size={16} aria-hidden="true" /> Assess</h3>
        <p>{awaitingResult ? 'The latest assessment is awaiting a result.' : assessMeasurement ? 'The latest reading can be linked to a new assessment.'
          : assessment ? <>Latest assessment <time dateTime={assessment.assessed_at}>{formatDate(assessment.assessed_at)}</time></>
            : 'Start a check-in with a saved reading or a symptom report.'}</p>
        {selected && <a className={`button ${primary === 'assess' ? 'primary' : 'secondary'}`} href={assessUrl}>
          {awaitingResult ? 'Open pending assessment' : assessMeasurement ? 'Assess saved measurement' : 'Start assessment'}</a>}
      </div>
      <div>
        <h3><ListChecks size={16} aria-hidden="true" /> Follow up</h3>
        <p>{assessmentId ? followUp?.text ?? (reachable ? 'Checking follow-up history…' : 'Reconnect to check follow-up history.')
          : 'Link a repeat reading from an evaluated assessment.'}</p>
        {assessmentId && <a className={`button ${primary === 'follow-up' ? 'primary' : 'secondary'}`} href={`/assessments/${assessmentId}`}>Review assessment and follow-up</a>}
      </div>
    </div>
    <footer className="recorded-workflow-footer">
      <p>{local ? 'Fictional training records are saved on this device.' : 'Shared sample workspace. Enter sample readings only.'}</p>
      <div>
        <button className="text-link" type="button" onClick={onStartTraining}>
          <Play size={14} aria-hidden="true" /> Try a 90-second training scenario
        </button>
        <p>Fictional observations · Runs in this browser</p>
      </div>
    </footer>
  </section>
}
