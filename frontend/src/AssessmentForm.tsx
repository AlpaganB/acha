import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import type { AssessmentInput, CrewMember, Measurement } from './api'
import { formatDate, measurementLabels, symptoms } from './content'

interface Props {
  crew?: CrewMember
  measurements: Measurement[]
  measurementsPending: boolean
  reachable: boolean
  onSubmit: (input: AssessmentInput) => Promise<void>
  initialMeasurementId?: string
}

export function AssessmentForm({ crew, measurements, measurementsPending, reachable, onSubmit, initialMeasurementId }: Props) {
  const [step, setStep] = useState(initialMeasurementId ? 1 : 0)
  const [selected, setSelected] = useState<Record<string, number | null>>({})
  const [measurementIds, setMeasurementIds] = useState<string[]>(initialMeasurementId ? [initialMeasurementId] : [])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previousAttempt = useRef<{ signature: string; input: AssessmentInput } | null>(null)
  const lock = useRef(false)
  const focusStep = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const chosen = symptoms.filter(symptom => Object.hasOwn(selected, symptom.code))
  const usableIds = measurementIds.filter(id => measurements.some(record => record.id === id))

  useLayoutEffect(() => {
    if (!focusStep.current) return
    focusStep.current = false
    heading.current?.focus()
  }, [step])

  function goToStep(next: number) {
    focusStep.current = true
    setStep(next)
    setError('')
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
      <div>
        <h2 ref={heading} tabIndex={-1}>{step === 0 ? 'What are you experiencing?' : 'Measurements and notes'}</h2>
        {step === 0 ? (
          <>
            <p className="muted">Select any symptoms you want to report.</p>
            <div className="symptom-grid">
              {symptoms.map(({ code, label }) => {
                const pressed = Object.hasOwn(selected, code)
                return (
                  <button key={code} className="symptom-option" type="button"
                    aria-pressed={pressed} onClick={() => toggle(code)}>
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
                    <span>{measurementLabels[record.kind] ?? record.kind}<small>{formatDate(record.recorded_at)}</small></span>
                    <strong>{record.value}{record.diastolic !== null && `/${record.diastolic}`} {record.unit}</strong>
                  </label>
                ))}
              </fieldset>
            ) : <p className="notice" role="status">{measurementsPending
              ? 'Loading recent measurements…' : 'No recent measurements are available for this crew member.'}</p>}
            <label className="notes-label">
              Notes <span className="muted">{Object.hasOwn(selected, 'other') ? '(required)' : '(optional)'}</span>
              <textarea maxLength={2000} rows={4} value={notes} placeholder="Describe anything else the crew should know."
                onChange={event => setNotes(event.target.value)} />
            </label>
            <p className="form-feedback">Use sample observations in this public workspace.</p>
            {error && <p className="notice error" role="alert">{error}</p>}
            <div className="form-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={() => goToStep(0)}>
                <ArrowLeft size={17} aria-hidden="true" /> Back
              </button>
              <button type="submit" className="button primary" disabled={!crew || busy}>
                {reachable ? 'Submit assessment' : 'Save assessment'}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
