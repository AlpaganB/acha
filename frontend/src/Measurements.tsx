import { useRef, useState } from 'react'
import type { CrewMember, Measurement, MeasurementInput } from './api'
import { formatDate, measurementLabels } from './content'
import { navigate } from './navigation'

const units: Record<string, string> = { heart_rate: 'bpm', spo2: '%', blood_pressure: 'mmHg', body_temperature: '°C' }

export function Measurements({ crew, measurements, pending, reachable, onSave }: {
  crew?: CrewMember
  measurements: Measurement[]
  pending: boolean
  reachable: boolean
  onSave: (input: MeasurementInput) => Promise<Measurement>
}) {
  const [kind, setKind] = useState('heart_rate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Measurement>()
  const lastAttempt = useRef<{ signature: string; input: MeasurementInput } | null>(null)
  const submitting = useRef(false)

  async function save(form: HTMLFormElement) {
    if (!crew || submitting.current) return
    const fields = new FormData(form)
    const value = Number(fields.get('value'))
    const diastolic = kind === 'blood_pressure' ? Number(fields.get('diastolic')) : null
    const signature = JSON.stringify([crew.id, kind, value, diastolic])
    if (lastAttempt.current?.signature !== signature) {
      lastAttempt.current = { signature, input: { id: crypto.randomUUID(), kind, value, diastolic, recorded_at: new Date().toISOString() } }
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      setSaved(await onSave(lastAttempt.current.input))
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
      <section className="surface form-panel" aria-labelledby="record-heading">
        <h2 id="record-heading">Record a measurement</h2>
        <p className="muted">Use sample readings in this public workspace.</p>
        <form onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
          <div className="measurement-fields">
            <label>Indicator<select value={kind} disabled={busy} onChange={event => setKind(event.target.value)}>
              {Object.entries(measurementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>{kind === 'blood_pressure' ? 'Systolic' : 'Reading'} ({units[kind]})
              <input name="value" type="number" inputMode="decimal" required step="any" disabled={busy}
                min={kind === 'spo2' ? 0 : kind === 'body_temperature' ? -273.15 : undefined}
                max={kind === 'spo2' ? 100 : undefined} />
            </label>
            {kind === 'blood_pressure' && <label>Diastolic (mmHg)
              <input name="diastolic" type="number" inputMode="decimal" required step="any" disabled={busy} />
            </label>}
          </div>
          {(kind === 'heart_rate' || kind === 'blood_pressure') && <p className="measurement-source">
            <a href="https://www.nasa.gov/hrp/risks/" className="text-link" target="_blank" rel="noreferrer">NASA research on cardiovascular adaptation</a>
          </p>}
          <div className="form-actions">
            <button className="button primary" disabled={!crew || !reachable || busy}>Save measurement</button>
            {saved && <button type="button" className="button secondary" onClick={() => navigate(`/assessment?measurement=${saved.id}`)}>
              Assess saved measurement
            </button>}
          </div>
          <p className="form-feedback" role="status">{error || (busy ? 'Saving measurement…'
            : saved ? 'Measurement saved.' : !reachable && !pending ? 'Connection required to save.' : '')}</p>
        </form>
      </section>
      <section className="measurement-history" aria-labelledby="history-heading">
        <h2 id="history-heading">Recent readings</h2>
        <div className="surface">
          {measurements.length ? <ul className="records">{measurements.map(reading => (
            <li className="measurement-row" key={reading.id}>
              <div><strong>{measurementLabels[reading.kind]}</strong><small>{formatDate(reading.recorded_at)}</small></div>
              <span>{reading.value}{reading.diastolic !== null && `/${reading.diastolic}`} {reading.unit}</span>
            </li>
          ))}</ul> : <p className="empty-state">{pending ? 'Loading readings…' : 'No recent readings.'}</p>}
        </div>
      </section>
    </>
  )
}
