import { useRef, useState } from 'react'
import type { api, CrewMember, Measurement, MeasurementInput } from './api'
import { measurementLabels, measurementUnits } from './content'
import { navigate } from './navigation'
import { MeasurementHistory } from './MeasurementHistory'

const measurementGuides: Record<string, { equipment: string; steps: string[] }> = {
  heart_rate: { equipment: 'Heart rate monitor', steps: ['Select the heart rate reading on your monitor.', 'Record the displayed value in beats per minute (bpm). Do not enter an oxygen percentage here.'] },
  respiratory_rate: { equipment: 'Respiratory monitor or timed observation', steps: ['Follow your approved measurement procedure.', 'Enter the recorded breathing rate in breaths per minute.'] },
  spo2: { equipment: 'Pulse oximeter', steps: ['Check that the reading is stable.', 'Record the percentage labeled SpO₂.'] },
  blood_pressure: { equipment: 'Blood pressure monitor', steps: ['Record the SYS value as systolic pressure and the DIA value as diastolic pressure. Both values are in mmHg.'] },
  body_temperature: { equipment: 'Thermometer', steps: ['Follow the thermometer instructions and check its selected unit.', 'Enter the reading in Celsius (°C). Convert a Fahrenheit reading before entering it.'] },
  sleep_duration: { equipment: 'Self-reported sleep log', steps: ['Add up the hours you slept during the previous 24 hours, including naps.', 'Enter hours as a decimal: 7 hours 30 minutes is 7.5. This is a self-reported observation, not a neurological assessment.'] },
}

export function Measurements({ crew, measurements, pending, reachable, local, followUpId, load, onSave, onReconnect, initialKind = '' }: {
  crew?: CrewMember
  measurements: Measurement[]
  pending: boolean
  reachable: boolean
  local: boolean
  followUpId?: string
  load: typeof api.measurements
  onSave: (input: MeasurementInput) => Promise<Measurement>
  onReconnect: () => Promise<void>
  initialKind?: string
}) {
  const [kind, setKind] = useState(initialKind || 'heart_rate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Measurement>()
  const [historyRevision, setHistoryRevision] = useState('')
  const lastAttempt = useRef<{ signature: string; input: MeasurementInput } | null>(null)
  const submitting = useRef(false)

  async function save(form: HTMLFormElement) {
    if (!crew || submitting.current) return
    const fields = new FormData(form)
    const value = Number(fields.get('value'))
    const diastolic = kind === 'blood_pressure' ? Number(fields.get('diastolic')) : null
    const capturedAt = String(fields.get('recorded_at') ?? '')
    setSaved(undefined)
    if (!Number.isFinite(value) || (diastolic !== null && !Number.isFinite(diastolic))) {
      setError('Enter a valid numeric reading.')
      return
    }
    if (kind === 'heart_rate' && value <= 0) { setError('Enter a heart rate greater than zero.'); return }
    if (kind === 'blood_pressure' && (diastolic === null || diastolic <= 0 || diastolic > value)) {
      setError('Enter a diastolic pressure greater than zero and no higher than the systolic pressure.')
      return
    }
    const timestamp = capturedAt ? Date.parse(capturedAt) : Date.now()
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) {
      setError('Choose a recording time that has already passed.')
      return
    }
    const signature = JSON.stringify([crew.id, kind, value, diastolic, capturedAt])
    if (lastAttempt.current?.signature !== signature) {
      lastAttempt.current = { signature, input: { id: crypto.randomUUID(), kind, value, diastolic, recorded_at: new Date(timestamp).toISOString() } }
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const reading = await onSave(lastAttempt.current.input)
      setSaved(reading)
      setHistoryRevision(reading.id)
      lastAttempt.current = null
      form.reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the measurement.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-title"><h1>Measurements</h1><p className="crew-context">{crew?.display_name} <a className="text-link crew-change" href="/crew">Change crew member</a></p></header>
      <div className="measurement-workspace">
      <section className="surface form-panel" aria-labelledby="record-heading">
        <h2 id="record-heading">Record a measurement</h2>
        <p className="muted">{local ? 'Enter a fictional reading. It will be stored on this device.' : 'Use sample readings. Measurements are saved to the public mission service.'}</p>
        {followUpId && <p className="notice">Record a repeat reading, then return to the check-in to link it.
          {local && kind === 'heart_rate' && ' For the training case, you can use 67 bpm.'}</p>}
        <form onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
          <div className="measurement-fields">
            <label>Indicator<select value={kind} disabled={busy} onChange={event => { setKind(event.target.value); setError(''); setSaved(undefined) }}>
              {Object.entries(measurementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>{kind === 'blood_pressure' ? 'Systolic' : kind === 'sleep_duration' ? 'Sleep in the previous 24 hours' : 'Reading'} ({measurementUnits[kind]})
              <input key={kind} name="value" type="number" inputMode="decimal" required step="any" disabled={busy}
                min={kind === 'spo2' || kind === 'sleep_duration' || kind === 'respiratory_rate' ? 0 : kind === 'body_temperature' ? -273.15 : 0.000001}
                max={kind === 'spo2' ? 100 : kind === 'sleep_duration' ? 24 : undefined} />
            </label>
            {kind === 'blood_pressure' && <label>Diastolic (mmHg)
              <input name="diastolic" type="number" inputMode="decimal" required step="any" min="0.000001" disabled={busy} />
            </label>}
            <label>Recorded at (local time)<input name="recorded_at" type="datetime-local" disabled={busy} />
              <small className="muted">Leave blank to record now.</small></label>
          </div>
          <details className="measurement-guide" key={`guide-${kind}`}>
            <summary>How to record {measurementLabels[kind].toLowerCase()}</summary>
            <p><strong>Equipment:</strong> {measurementGuides[kind].equipment}</p>
            <ol>{measurementGuides[kind].steps.map(step => <li key={step}>{step}</li>)}</ol>
            <p>Follow the device instructions and your mission procedure.</p>
          </details>
          <div className="form-actions">
            <button className="button primary" disabled={!crew || !reachable || busy}>Save measurement</button>
            {saved && <button type="button" className="button secondary" onClick={() => navigate(followUpId
              ? `/assessments/${followUpId}?measurement=${saved.id}` : `/assessment?measurement=${saved.id}`)}>
              {followUpId ? 'Return to follow-up' : 'Assess saved measurement'}
            </button>}
          </div>
          <p className={`form-feedback ${error ? 'feedback-error' : ''}`} role={error ? 'alert' : 'status'}>{error || (busy ? 'Saving measurement…'
            : saved ? (local ? 'Synthetic measurement saved on this device.' : 'Measurement saved to the mission service.')
              : !reachable && !pending ? 'Mission service unavailable. Retry the connection to save here.' : '')}</p>
        </form>
      </section>
      <MeasurementHistory crewId={crew?.id} cached={measurements} reachable={reachable} revision={historyRevision}
        load={load} onReconnect={onReconnect} initialKind={initialKind} />
      </div>
    </>
  )
}
