import { useRef, useState } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, BatteryLow, Brain, Check, CircleDot, HeartPulse,
  Plus, Waves, Wind,
} from 'lucide-react'
import type { AssessmentInput, CrewMember, Measurement } from './api'
import { formatDate, measurementLabels, symptoms } from './content'

const icons = {
  head: Brain, waves: Waves, stomach: CircleDot, battery: BatteryLow,
  heart: HeartPulse, wind: Wind, plus: Plus,
}

interface Props {
  crew?: CrewMember
  measurements: Measurement[]
  reachable: boolean
  onSubmit: (input: AssessmentInput) => Promise<void>
}

export function AssessmentForm({ crew, measurements, reachable, onSubmit }: Props) {
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Record<string, number | null>>({})
  const [measurementIds, setMeasurementIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previousAttempt = useRef<{ signature: string; input: AssessmentInput } | null>(null)
  const lock = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const chosen = symptoms.filter(symptom => Object.hasOwn(selected, symptom.code))
  const usableIds = measurementIds.filter(id => measurements.some(record => record.id === id))

  function goToStep(next: number) {
    setStep(next)
    setError('')
    heading.current?.focus()
  }

  function toggle(code: string) {
    setSelected(current => {
      const next = { ...current }
      if (Object.hasOwn(next, code)) delete next[code]
      else next[code] = null
      return next
    })
  }

  async function submit() {
    if (lock.current || !crew) return
    if (!chosen.length && !usableIds.length) {
      setError('Select at least one symptom or measurement.')
      return
    }
    if (Object.hasOwn(selected, 'other') && !notes.trim()) {
      setError('Describe your other symptom in the notes.')
      return
    }

    lock.current = true
    setBusy(true)
    setError('')
    try {
      const fields = {
        mission_profile_id: crew.mission_profile_id,
        symptoms: chosen.map(({ code }) => ({ code, severity: selected[code] })),
        measurement_ids: usableIds,
        notes: notes.trim() || null,
      }
      const signature = JSON.stringify(fields)
      if (previousAttempt.current?.signature !== signature) {
        previousAttempt.current = {
          signature,
          input: { ...fields, id: crypto.randomUUID(), assessed_at: new Date().toISOString() },
        }
      }
      await onSubmit(previousAttempt.current.input)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The assessment could not be saved.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <section className="form-panel surface">
      <ol className="stepper" aria-label="Assessment progress">
        {['Symptoms', 'Measurements & notes'].map((label, index) => (
          <li key={label} aria-current={step === index ? 'step' : undefined} className={step >= index ? 'active' : ''}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1}>{step === 0 ? 'What are you experiencing?' : 'Add context to your assessment'}</h2>
      {step === 0 ? (
        <>
          <p className="muted">Select any symptoms you want to report.</p>
          <div className="symptom-grid">
            {symptoms.map(({ code, label, icon }) => {
              const Icon = icons[icon]
              const pressed = Object.hasOwn(selected, code)
              return (
                <button key={code} className="symptom-option" type="button"
                  aria-pressed={pressed} onClick={() => toggle(code)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                  <Check className="symptom-check" size={15} aria-hidden="true" />
                </button>
              )
            })}
          </div>
          {chosen.length > 0 && (
            <fieldset className="field-group">
              <legend>Symptom severity <span className="muted">(optional)</span></legend>
              {chosen.map(({ code, label }) => (
                <label className="severity-row" key={code}>
                  <span>{label} severity</span>
                  <select value={selected[code] ?? ''} onChange={event => {
                    const value = event.target.value
                    setSelected(current => ({ ...current, [code]: value === '' ? null : Number(value) }))
                  }}>
                    <option value="">Unspecified</option>
                    {Array.from({ length: 11 }, (_, score) => (
                      <option key={score} value={score}>{score === 10 ? '10 · Most severe' : score}</option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          )}
          <div className="form-actions end">
            <button type="button" className="button primary" onClick={() => goToStep(1)}>
              Continue <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={event => { event.preventDefault(); void submit() }}>
          <p className="muted">Attach relevant measurements from this crew member’s recent history.</p>
          {measurements.length ? (
            <fieldset className="field-group readings">
              <legend>Recent measurements</legend>
              {measurements.map(record => (
                <label className="reading-row" key={record.id}>
                  <input type="checkbox" checked={measurementIds.includes(record.id)}
                    onChange={event => setMeasurementIds(current => event.target.checked
                      ? [...current, record.id] : current.filter(id => id !== record.id))} />
                  <Activity size={17} aria-hidden="true" />
                  <span>{measurementLabels[record.kind] ?? record.kind}<small>{formatDate(record.recorded_at)}</small></span>
                  <strong>{record.value}{record.diastolic !== null && `/${record.diastolic}`} {record.unit}</strong>
                </label>
              ))}
            </fieldset>
          ) : <p className="notice">No recent measurements are available for this crew member.</p>}
          <label className="notes-label">
            Notes <span className="muted">{Object.hasOwn(selected, 'other') ? '(required)' : '(optional)'}</span>
            <textarea maxLength={2000} rows={4} value={notes} placeholder="Describe anything else the crew should know."
              onChange={event => setNotes(event.target.value)} />
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          {!crew && <p className="notice">Load a crew profile before saving an assessment.</p>}
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => goToStep(0)}>
              <ArrowLeft size={17} aria-hidden="true" /> Back
            </button>
            <button type="submit" className="button primary" disabled={!crew || busy}>
              {busy ? 'Saving…' : reachable ? 'Submit assessment' : 'Save assessment'}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
