import { useEffect, useRef, useState } from 'react'
import type { api, Assessment, FollowUpEntry, FollowUpInput, Measurement } from './api'
import { formatDate, measurementLabels } from './content'

type FollowUpData = Pick<typeof api, 'assessment' | 'followUps' | 'recordFollowUp' | 'measurement' | 'measurements'>

export function AssessmentFollowUp({ record, measurements, preferredMeasurement, reachable, data }: {
  record: Assessment
  measurements: Measurement[]
  preferredMeasurement?: string
  reachable: boolean
  data: FollowUpData
}) {
  const [entries, setEntries] = useState<FollowUpEntry[]>()
  const [attached, setAttached] = useState<Measurement[]>([])
  const [later, setLater] = useState<Measurement[]>([])
  const [picked, setPicked] = useState(preferredMeasurement ?? '')
  const [error, setError] = useState('')
  const [loadingError, setLoadingError] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const attempt = useRef<FollowUpInput | undefined>(undefined)
  const writing = useRef(false)

  useEffect(() => {
    if (!reachable) return
    let active = true
    setLoadingError('')
    const crew = record.crew_member_id
    void Promise.all([
      data.followUps(crew, record.id),
      Promise.all(record.measurement_ids.map(id => data.measurement(crew, id))),
      data.measurements(crew, { since: record.assessed_at, limit: 50 }),
    ]).then(([rows, originals, candidates]) => {
      if (active) { setEntries(rows); setAttached(originals); setLater(candidates) }
    }).catch(reason => {
      if (active) setLoadingError(reason instanceof Error ? reason.message : 'Follow-up records could not be loaded.')
    })
    return () => { active = false }
  }, [data, reachable, record, revision])

  const kinds = new Set(attached.map(item => item.kind))
  const suggestedKind = attached.find(item => item.kind !== 'sleep_duration')?.kind ?? attached[0]?.kind
  const used = new Set(entries?.map(item => item.measurement_id))
  const available = [...new Map([...measurements, ...later].map(item => [item.id, item])).values()]
    .filter(item => Date.parse(item.recorded_at) > Date.parse(record.assessed_at) && Date.parse(item.recorded_at) <= Date.now() && !used.has(item.id)
      && (!kinds.size || kinds.has(item.kind)))
  const complete = entries?.some(item => item.outcome === 'workflow_complete')
  const selection = available.some(item => item.id === picked) ? picked : ''
  const repeatLink = new URLSearchParams({ 'follow-up': record.id, ...(suggestedKind && { kind: suggestedKind }) })

  async function save(form: HTMLFormElement) {
    if (!entries || !selection || writing.current) return
    const outcome = new FormData(form).get('outcome') === 'workflow_complete' ? 'workflow_complete' : 'continue_review'
    if (attempt.current?.measurement_id !== selection || attempt.current.outcome !== outcome) {
      attempt.current = { id: crypto.randomUUID(), measurement_id: selection, outcome }
    }
    writing.current = true
    setBusy(true)
    setError('')
    try {
      const entry = await data.recordFollowUp(record.crew_member_id, record.id, attempt.current)
      setEntries(current => [...(current ?? []).filter(row => row.id !== entry.id), entry])
      setPicked('')
      attempt.current = undefined
      form.reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The follow-up could not be saved.')
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  return <section className="surface form-panel observation-stack" aria-labelledby="follow-up-heading">
    <h2 id="follow-up-heading">Follow-up</h2>
    <p>Link a repeat reading from the same crew member and review it under comparable conditions. Closing the check-in records completion of the workflow.</p>
    {entries && entries.length > 0 && <ol className="follow-up-list" aria-label="Follow-up history">
      {entries.map(entry => {
        const reading = entry.measurement
        const original = attached.filter(item => item.kind === reading.kind)
          .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))[0]
        return <li key={entry.id}>
          <strong>{entry.outcome === 'workflow_complete' ? 'Check-in closed' : 'Further review recorded'}</strong>
          <span>{measurementLabels[reading.kind]} · {reading.value}{reading.diastolic === null ? '' : `/${reading.diastolic}`} {reading.unit} · {formatDate(reading.recorded_at)}</span>
          {original && <span className="muted">Initial reading {original.value}{original.diastolic === null ? '' : `/${original.diastolic}`} {original.unit} · {formatDate(original.recorded_at)}</span>}
        </li>
      })}
    </ol>}
    {loadingError && <p className="notice error" role="alert">{loadingError} <button type="button" className="text-link" onClick={() => setRevision(value => value + 1)}>Reload</button></p>}
    {!reachable && <p className="notice" role="status">Connect to the mission service to load or save follow-up records.</p>}
    {reachable && !entries && !loadingError && <p role="status">Loading follow-up records…</p>}
    {complete && <p className="notice" role="status">Workflow complete. The original observations and assessment result are retained.</p>}
    {reachable && entries && !complete && !loadingError && <>
      <div><a className="button secondary" href={`/measurements?${repeatLink}`}>Record repeat measurement</a></div>
      {available.length === 0 ? <p className="muted">No eligible repeat readings are recorded yet.</p> :
        <form onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
        <div className="measurement-fields">
          <label>Repeat measurement<select value={selection} onChange={event => setPicked(event.target.value)} required disabled={busy}>
            <option value="">Choose a reading</option>
            {available.map(item => <option key={item.id} value={item.id}>{measurementLabels[item.kind]} · {item.value}{item.diastolic === null ? '' : `/${item.diastolic}`} {item.unit} · {formatDate(item.recorded_at)}</option>)}
          </select></label>
          <label>Disposition<select name="outcome" disabled={busy}>
            <option value="continue_review">Continue reviewing</option><option value="workflow_complete">Close this check-in</option>
          </select></label>
        </div>
        <div className="form-actions"><button className="button primary" disabled={!selection || busy}>{busy ? 'Saving follow-up…' : 'Save follow-up'}</button></div>
        {error && <p className="notice error" role="alert">{error}</p>}
      </form>}
    </>}
  </section>
}
