import { useEffect, useRef, useState } from 'react'
import {
  observationsApi, type MissionObservation, type MissionPhase, type ObservationAccess,
  type ObservationInput, type ParameterDefinition,
} from './api'
import { ObservationTrends, phases, printable, utcTime } from './ObservationTrends'
import { RestrictedHealthReview } from './HealthMonitoring'
import { trainingParameters, trainingRecords } from './trainingObservations'

const ranges = [
  ['1', 'Last hour'], ['6', 'Last 6 hours'], ['24', 'Last 24 hours'], ['168', 'Last 7 days'],
  ['720', 'Last 30 days'], ['all', 'All recorded time'],
] as const
const codePattern = '[a-z][a-z0-9_\\-]{0,63}'
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : 'The mission service is unavailable.'

interface Context {
  mission: string
  location: string
  crew: string
  hours: string
}

function ObservationForm({ token, access, definitions, context, onSaved }: {
  token: string; access: ObservationAccess; definitions: ParameterDefinition[]; context: Context; onSaved: () => void
}) {
  const writable = definitions.filter(item => item.scope === (access.role === 'medical' ? 'crew' : 'environment'))
  const [parameterId, setParameterId] = useState(writable[0]?.id)
  const parameter = writable.find(item => item.id === parameterId)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const attempt = useRef<{ signature: string; id: string } | null>(null)
  const submitting = useRef(false)
  if (!parameter || (access.role === 'medical' && !context.crew)) return null

  async function save(form: HTMLFormElement) {
    if (!parameter || submitting.current) return
    const fields = new FormData(form)
    const recorded = new Date(String(fields.get('timestamp')))
    if (!Number.isFinite(recorded.getTime())) {
      setMessage('Enter a valid observation date and time.')
      return
    }
    const body = {
      crew_code: access.role === 'medical' ? context.crew : null, location: context.location,
      parameter: parameter.id, value: parameter.input_kind === 'number' ? Number(fields.get('value')) : null,
      event_text: parameter.input_kind === 'event' ? String(fields.get('event')).trim() : null,
      phase: fields.get('phase') as MissionPhase, activity: fields.get('activity') as ObservationInput['activity'],
      quality: fields.get('quality') as ObservationInput['quality'], device: String(fields.get('device')).trim() || null,
      calibration: String(fields.get('calibration')).trim() || null,
      uncertainty: fields.get('uncertainty') ? Number(fields.get('uncertainty')) : null,
      recorded_at: recorded.toISOString(),
    }
    const signature = JSON.stringify(body)
    if (signature !== attempt.current?.signature) attempt.current = { signature, id: crypto.randomUUID() }
    submitting.current = true
    setSaving(true)
    setMessage('')
    try {
      await observationsApi.save(token, context.mission, { ...body, id: attempt.current.id })
      attempt.current = null
      setMessage('Observation saved.')
      const valueField = form.elements.namedItem('value')
      if (valueField instanceof HTMLInputElement) valueField.value = ''
      const eventField = form.elements.namedItem('event')
      if (eventField instanceof HTMLTextAreaElement) eventField.value = ''
      onSaved()
    } catch (reason) {
      setMessage(errorText(reason))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <section className="surface form-panel observation-stack" aria-labelledby="new-observation">
    <h2 id="new-observation">Record an observation</h2>
    <p className="muted">{context.mission} · {context.location}{context.crew && ` · ${context.crew}`}</p>
    <form onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
      <fieldset className="observation-fieldset" disabled={saving}>
        <div className="measurement-fields">
          <label>Parameter<select value={parameter.id} onChange={event => setParameterId(event.target.value)}>
            {[...new Set(writable.map(item => item.category))].map(category => <optgroup key={category} label={category}>
              {writable.filter(item => item.category === category).map(item =>
                <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>)}
          </select></label>
          {parameter.input_kind === 'event'
            ? <label>Recorded event<textarea key={parameter.id} name="event" required maxLength={2000} rows={3} /></label>
            : <label>Value ({parameter.unit})<input key={parameter.id} name="value" type="number" step="any"
              min={parameter.minimum ?? undefined} max={parameter.maximum ?? undefined} required /></label>}
          <label>Observed (local time)<input name="timestamp" type="datetime-local" required /></label>
          <label>Mission phase<select name="phase" defaultValue="in_flight">{Object.entries(phases).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Activity<select name="activity"><option value="unknown">Unknown</option><option value="rest">Rest</option>
            <option value="exercise">Exercise</option><option value="task">Task</option></select></label>
          <label>Quality<select name="quality"><option value="unverified">Unverified</option><option value="verified">Verified</option>
            <option value="suspect">Suspect</option></select></label>
          <label>Device or protocol ID<input name="device" maxLength={120} /></label>
          <label>Calibration reference<input name="calibration" maxLength={120} /></label>
          {parameter.input_kind === 'number' && <label>Uncertainty ({parameter.unit})
            <input key={`${parameter.id}-uncertainty`} name="uncertainty" type="number" step="any" min="0" /></label>}
        </div>
      </fieldset>
      <p className="measurement-source muted">{parameter.priority} · {parameter.method.replaceAll('_', ' ')} · {parameter.cadence}.
        {' '}<a className="text-link" href={parameter.source} target="_blank" rel="noreferrer">Research reference</a></p>
      <div className="form-actions"><button className="button primary" disabled={saving}>Save observation</button></div>
      <p className="form-feedback" role="status">{saving ? 'Saving observation…' : message}</p>
    </form>
  </section>
}

function ObservationHistory({ records, definitions }: { records: MissionObservation[]; definitions: ParameterDefinition[] }) {
  if (!records.length) return null
  const definitionsById = new Map(definitions.map(item => [item.id, item]))
  return <section className="surface form-panel observation-stack">
    <h2>Observation history</h2>
    <details className="research-observations">
      <summary>{records.length} loaded observations</summary>
      <div className="research-table" role="region" aria-label="Observation history" tabIndex={0}><table>
        <thead><tr><th scope="col">Observed (UTC)</th><th scope="col">Parameter</th><th scope="col">Value</th>
          <th scope="col">Phase and activity</th><th scope="col">Quality</th><th scope="col">Provenance</th>
          <th scope="col">Device or protocol</th><th scope="col">Calibration</th><th scope="col">Uncertainty</th></tr></thead>
        <tbody>{[...records].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)).map(item => <tr key={item.id}>
          <th scope="row">{utcTime.format(new Date(item.recorded_at))}</th>
          <td>{definitionsById.get(item.parameter)?.label ?? item.parameter}</td>
          <td className={item.event_text ? 'observation-event' : undefined}>{item.event_text ?? `${printable(item.value)} ${item.unit}`}</td>
          <td>{phases[item.phase]} · {item.activity}</td>
          <td>{item.provenance === 'SYNTHETIC' ? 'Simulated' : item.quality}</td><td>{item.provenance.replaceAll('_', ' ')}</td>
          <td>{item.device ?? '—'}</td>
          <td>{item.calibration ?? '—'}</td><td>{item.uncertainty === null ? '—' : `${printable(item.uncertainty)} ${item.unit}`}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
  </section>
}

function LoadedContext({ access, token, definitions, context }: {
  access: ObservationAccess; token: string; definitions: ParameterDefinition[]; context: Context
}) {
  const [records, setRecords] = useState<MissionObservation[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ location: context.location, limit: '200' })
    if (context.hours !== 'all') params.set('since', new Date(Date.now() - Number(context.hours) * 3_600_000).toISOString())
    const environment = new URLSearchParams(params)
    environment.set('scope', 'environment')
    const requests = [observationsApi.list(token, context.mission, environment, controller.signal)]
    if (access.role === 'medical' && context.crew) {
      params.set('scope', 'crew')
      params.set('crew_code', context.crew)
      requests.push(observationsApi.list(token, context.mission, params, controller.signal))
    }
    void Promise.all(requests).then(pages => {
      if (controller.signal.aborted) return
      setTruncated(pages.some(page => page.length === 200))
      setRecords(pages.flat())
      setError('')
    }).catch(reason => {
      if (controller.signal.aborted) return
      setError(errorText(reason))
      setRecords([])
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [access.role, token, context, revision])

  function refresh() {
    setLoading(true)
    setRevision(value => value + 1)
  }

  return <>
    <ObservationForm token={token} access={access} definitions={definitions} context={context} onSaved={refresh} />
    <p className="form-feedback" role="status">{loading ? 'Loading observations…' : error || (truncated
      ? 'Showing up to 200 observations per record type. Select a narrower period for a more focused view.'
      : !records.length ? 'No observations in this location and time window.' : '')}</p>
    {!loading && !error && <>
      <RestrictedHealthReview records={records} />
      <ObservationTrends records={records} definitions={definitions} />
      <ObservationHistory records={records} definitions={definitions} />
    </>}
  </>
}

function ConnectedLog({ access, token, definitions, onLock }: {
  access: ObservationAccess; token: string; definitions: ParameterDefinition[]; onLock: () => void
}) {
  const [request, setRequest] = useState<{ context: Context; id: number }>()
  return <>
    <section className="surface form-panel observation-stack" aria-labelledby="record-filter">
      <div className="section-heading"><h2 id="record-filter">Mission and location</h2>
        <button className="button secondary" onClick={onLock}>Lock log</button></div>
      <p className="muted">Signed in as {access.actor} · {access.role}</p>
      <form onSubmit={event => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        setRequest(current => ({ id: (current?.id ?? 0) + 1, context: {
          mission: String(fields.get('mission')), location: String(fields.get('location')).trim(),
          crew: String(fields.get('crew') ?? '').trim(), hours: String(fields.get('hours')),
        } }))
      }}>
        <div className="measurement-fields">
          <label>Mission<select name="mission">{access.missions.map(mission => <option key={mission}>{mission}</option>)}</select></label>
          <label>Location code<input name="location" placeholder="habitat-a" maxLength={64} pattern={codePattern} required /></label>
          {access.role === 'medical' && <label>Crew code (optional)<input name="crew" placeholder="crew-a"
            maxLength={64} pattern={codePattern} /></label>}
          <label>Time range<select name="hours" defaultValue="all">{ranges.map(([id, label]) =>
            <option key={id} value={id}>{label}</option>)}</select></label>
        </div>
        <div className="form-actions"><button className="button primary">Load log</button></div>
      </form>
    </section>
    {request && <LoadedContext key={request.id} {...{ access, token, definitions, context: request.context }} />}
  </>
}

function SecureLog() {
  const [session, setSession] = useState<{ access: ObservationAccess; token: string; definitions: ParameterDefinition[] }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (session) return <ConnectedLog {...session} onLock={() => setSession(undefined)} />

  async function unlock(form: HTMLFormElement) {
    if (busy) return
    const token = String(new FormData(form).get('key')).trim()
    setBusy(true)
    setError('')
    try {
      const [access, definitions] = await Promise.all([observationsApi.access(token), observationsApi.parameters()])
      form.reset()
      setSession({ access, token, definitions })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return <section className="surface form-panel observation-stack" aria-labelledby="unlock-mission-log">
    <h2 id="unlock-mission-log">Unlock mission log</h2>
    <p>Enter the mission access key issued by your administrator.</p>
    <form onSubmit={event => { event.preventDefault(); void unlock(event.currentTarget) }}>
      <div className="measurement-fields"><label>Access key<input type="password" name="key" autoComplete="off"
        minLength={32} maxLength={256} disabled={busy} required /></label></div>
      <div className="form-actions"><button className="button primary" disabled={busy}>Unlock log</button></div>
      {error && <p className="form-feedback" role="alert">{error}</p>}
    </form>
  </section>
}

export function Observations({ restricted = false }: { restricted?: boolean }) {
  const [mode, setMode] = useState(restricted ? 'secure' : 'training')
  return <>
    <header className="page-title"><h1>Mission observations</h1>
      <p>{mode === 'training' ? 'Synthetic crew and habitat observations for offline training.' : 'Access-controlled mission records.'}</p>
    </header>
    <label className="observation-mode">Data source<select value={mode} onChange={event => setMode(event.target.value)}>
      <option value="training">Synthetic training scenario</option><option value="secure">Restricted mission log</option>
    </select></label>
    {mode === 'training' ? <>
      <ObservationTrends records={trainingRecords} definitions={trainingParameters} />
      <ObservationHistory records={trainingRecords} definitions={trainingParameters} />
    </> : <SecureLog />}
  </>
}
