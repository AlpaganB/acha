import { useRef, useState } from 'react'
import type { CrewMember, Measurement, MeasurementInput } from './api'
import { measurementLabels } from './content'
import { navigate } from './navigation'
import { MeasurementHistory } from './MeasurementHistory'

const units: Record<string, string> = {
  heart_rate: 'bpm', respiratory_rate: 'breaths/min', spo2: '%', blood_pressure: 'mmHg', body_temperature: '°C', sleep_duration: 'h',
}

const measurementGuides: Record<string, { equipment: string; steps: string[] }> = {
  heart_rate: { equipment: 'Heart rate monitor', steps: ['Select the heart rate reading on your monitor.', 'Record the displayed value in beats per minute (bpm). Do not enter an oxygen percentage here.'] },
  respiratory_rate: { equipment: 'Respiratory monitor or timed observation', steps: ['Follow your approved measurement procedure.', 'Enter the recorded breathing rate in breaths per minute.'] },
  spo2: { equipment: 'Pulse oximeter', steps: ['Follow the device instructions and check that the reading is stable.', 'Enter the SpO₂ percentage, rather than the pulse rate shown on the same device.'] },
  blood_pressure: { equipment: 'Blood pressure monitor', steps: ['Use the monitor according to its instructions and your mission procedure.', 'Enter SYS as systolic and DIA as diastolic, both in mmHg. Enter the pulse reading separately as heart rate.'] },
  body_temperature: { equipment: 'Thermometer', steps: ['Follow the thermometer instructions and check its selected unit.', 'Enter the reading in Celsius (°C). Convert a Fahrenheit reading before entering it.'] },
  sleep_duration: { equipment: 'Self-reported sleep log', steps: ['Add up the hours you slept during the previous 24 hours, including naps.', 'Enter hours as a decimal: 7 hours 30 minutes is 7.5. This is a self-reported observation, not a neurological assessment.'] },
}

export function Measurements({ crew, measurements, pending, reachable, onSave, onReconnect, initialKind = '' }: {
  crew?: CrewMember
  measurements: Measurement[]
  pending: boolean
  reachable: boolean
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
    setSaved(undefined)
    if (!Number.isFinite(value) || (diastolic !== null && !Number.isFinite(diastolic))) {
      setError('Enter a valid numeric reading.')
      return
    }
    if (kind === 'heart_rate' && value <= 0) { setError('Heart rate must be greater than zero.'); return }
    if (kind === 'blood_pressure' && (diastolic === null || diastolic <= 0 || diastolic > value)) {
      setError('Enter a positive diastolic reading that does not exceed systolic.')
      return
    }
    const signature = JSON.stringify([crew.id, kind, value, diastolic])
    if (lastAttempt.current?.signature !== signature) {
      lastAttempt.current = { signature, input: { id: crypto.randomUUID(), kind, value, diastolic, recorded_at: new Date().toISOString() } }
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
      <header className="page-title"><h1>Measurements</h1><p className="crew-context">{crew?.display_name} <a className="text-link crew-change" href="/mission">Change crew member</a></p></header>
      <div className="measurement-workspace">
      <section className="surface form-panel" aria-labelledby="record-heading">
        <h2 id="record-heading">Record a measurement</h2>
        <p className="muted">Use sample readings in this public workspace.</p>
        <form onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
          <div className="measurement-fields">
            <label>Indicator<select value={kind} disabled={busy} onChange={event => { setKind(event.target.value); setError(''); setSaved(undefined) }}>
              {Object.entries(measurementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>{kind === 'blood_pressure' ? 'Systolic' : kind === 'sleep_duration' ? 'Sleep in the previous 24 hours' : 'Reading'} ({units[kind]})
              <input key={kind} name="value" type="number" inputMode="decimal" required step="any" disabled={busy}
                min={kind === 'spo2' || kind === 'sleep_duration' || kind === 'respiratory_rate' ? 0 : kind === 'body_temperature' ? -273.15 : 0.000001}
                max={kind === 'spo2' ? 100 : kind === 'sleep_duration' ? 24 : undefined} />
            </label>
            {kind === 'blood_pressure' && <label>Diastolic (mmHg)
              <input name="diastolic" type="number" inputMode="decimal" required step="any" min="0.000001" disabled={busy} />
            </label>}
          </div>
          <details className="measurement-guide" key={`guide-${kind}`}>
            <summary>How to record {measurementLabels[kind].toLowerCase()}</summary>
            <p><strong>Equipment:</strong> {measurementGuides[kind].equipment}</p>
            <ol>{measurementGuides[kind].steps.map(step => <li key={step}>{step}</li>)}</ol>
            <p>Recording help for this prototype. Follow your device instructions and approved mission procedure.</p>
          </details>
          {(kind === 'heart_rate' || kind === 'blood_pressure') && <p className="measurement-source">
            <a href="https://www.nasa.gov/hrp/risks/" className="text-link" target="_blank" rel="noreferrer">NASA research on cardiovascular adaptation</a>
          </p>}
          <div className="form-actions">
            <button className="button primary" disabled={!crew || !reachable || busy}>Save measurement</button>
            {saved && <button type="button" className="button secondary" onClick={() => navigate(`/assessment?measurement=${saved.id}`)}>
              Assess saved measurement
            </button>}
          </div>
          <p className={`form-feedback ${error ? 'feedback-error' : ''}`} role={error ? 'alert' : 'status'}>{error || (busy ? 'Saving measurement…'
            : saved ? 'Measurement saved.' : !reachable && !pending ? 'Connection required to save.' : '')}</p>
        </form>
      </section>
      <MeasurementHistory crewId={crew?.id} cached={measurements} reachable={reachable} revision={historyRevision} onReconnect={onReconnect} initialKind={initialKind} />
      </div>
    </>
  )
}
