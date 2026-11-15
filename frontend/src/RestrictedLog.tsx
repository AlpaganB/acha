import { useEffect, useRef, useState } from 'react'
import {
  observationsApi, type MissionObservation, type MissionPhase, type ObservationAccess,
  type CrewIdentity, type CrewReport, type ObservationInput, type ParameterDefinition,
} from './api'
import { ObservationTrends, phases, printable, utcTime } from './ObservationTrends'
import { RestrictedHealthReview } from './HealthMonitoring'
import { DeviceQuality } from './DeviceQuality'
import { CrewContext } from './CrewContext'
import { CrewRadiation } from './CrewRadiation'
import { HealthReview } from './HealthReview'
import { IndicatorCards, ReferenceControls } from './PersonalIndicators'
import { codePattern, derivedDuration, ObservationFields, readObservationContext } from './ObservationFields'
import { ReactionTask, type ReactionResult } from './ReactionTask'

const ranges = [
  ['1', 'Last hour'], ['6', 'Last 6 hours'], ['24', 'Last 24 hours'], ['168', 'Last 7 days'],
  ['720', 'Last 30 days'], ['all', 'All recorded time'],
] as const
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
  const observationForm = useRef<HTMLFormElement>(null)
  if (!parameter || (access.role === 'medical' && !context.crew)) return null

  async function save(form: HTMLFormElement) {
    if (!parameter || submitting.current) return
    const fields = new FormData(form)
    let recordContext: ObservationInput['context']
    let timestamp: string
    try {
      recordContext = readObservationContext(fields, parameter)
      timestamp = recordContext?.kind === 'sleep_episode' ? recordContext.out_of_bed_at
        : recordContext?.kind === 'exercise_interval' || recordContext?.kind === 'gravity_interval' ? recordContext.end
        : new Date(String(fields.get('timestamp'))).toISOString()
    } catch {
      setMessage('Enter valid observation dates and times.')
      return
    }
    const body = {
      crew_code: access.role === 'medical' ? context.crew : null, location: context.location || String(fields.get('record_location')).trim(),
      parameter: parameter.id, value: fields.has('value') ? Number(fields.get('value')) : null,
      event_text: parameter.input_kind === 'event' ? String(fields.get('event')).trim() : null,
      phase: fields.get('phase') as MissionPhase, activity: fields.get('activity') as ObservationInput['activity'],
      quality: fields.get('quality') as ObservationInput['quality'], device: String(fields.get('device')).trim() || null,
      calibration: String(fields.get('calibration')).trim() || null,
      uncertainty: fields.get('uncertainty') ? Number(fields.get('uncertainty')) : null,
      recorded_at: timestamp, context: recordContext,
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
      if (derivedDuration(recordContext?.kind)) form.reset()
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

  function useReaction(result: ReactionResult) {
    const form = observationForm.current
    if (!form) return
    const values = { value: result.value, protocol: 'browser-reaction', version: 'v1',
      trials: result.trials, valid_trials: result.validTrials, quality: 'unverified' }
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name)
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = String(value)
    }
  }

  return <section className="surface form-panel observation-stack" aria-labelledby="new-observation">
    <h2 id="new-observation">Record an observation</h2>
    <p className="muted">{[context.mission, context.crew, context.location].filter(Boolean).join(' · ')}</p>
    <form ref={observationForm} onSubmit={event => { event.preventDefault(); void save(event.currentTarget) }}>
      <fieldset className="observation-fieldset" disabled={saving}>
        <div className="measurement-fields">
          {!context.location && <label>Location code<input name="record_location" maxLength={64} pattern={codePattern} required /></label>}
          <label>Parameter<select value={parameter.id} onChange={event => setParameterId(event.target.value)}>
            {[...new Set(writable.map(item => item.category))].map(category => <optgroup key={category} label={category}>
              {writable.filter(item => item.category === category).map(item =>
                <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>)}
          </select></label>
          {parameter.input_kind === 'event'
            ? <label>Recorded event<textarea key={parameter.id} name="event" required maxLength={2000} rows={3} /></label>
            : !derivedDuration(parameter.context_kind) && <label>Value ({parameter.unit})<input key={parameter.id} name="value" type="number" step="any"
              min={parameter.minimum ?? undefined} max={parameter.maximum ?? undefined} required /></label>}
          {!derivedDuration(parameter.context_kind) && <label>Observed (local time)<input name="timestamp" type="datetime-local" required /></label>}
          <label>Mission phase<select name="phase" defaultValue="in_flight">{Object.entries(phases).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Activity<select name="activity"><option value="unknown">Unknown</option><option value="rest">Rest</option>
            <option value="exercise">Exercise</option><option value="task">Task</option></select></label>
          <label>Quality<select name="quality"><option value="unverified">Unverified</option><option value="verified">Verified</option>
            <option value="suspect">Suspect</option></select></label>
          <label>Device or protocol ID<input name="device" maxLength={120} required={parameter.context_kind === 'radiation'} /></label>
          <label>Calibration reference<input name="calibration" maxLength={120} required={parameter.context_kind === 'radiation'} /></label>
          {parameter.input_kind === 'number' && parameter.context_kind !== 'radiation_assessment' && <label>Uncertainty ({parameter.unit})
            <input key={`${parameter.id}-uncertainty`} name="uncertainty" type="number" step="any" min="0" /></label>}
          <ObservationFields key={parameter.id} parameter={parameter} />
        </div>
      </fieldset>
      {parameter.id === 'reaction_time' && parameter.context_kind === 'performance' && <details className="research-observations">
        <summary>Run the five-attempt browser task</summary><ReactionTask onUse={useReaction} />
      </details>}
      <p className="measurement-source muted">{parameter.priority} · {parameter.method.replaceAll('_', ' ')} · {parameter.cadence}.
        {' '}<a className="text-link" href={parameter.source} target="_blank" rel="noreferrer">Research reference</a></p>
      <div className="form-actions"><button className="button primary" disabled={saving}>Save observation</button></div>
      <p className="form-feedback" role="status">{saving ? 'Saving observation…' : message}</p>
    </form>
  </section>
}
export function ObservationHistory({ records, definitions }: { records: MissionObservation[]; definitions: ParameterDefinition[] }) {
  if (!records.length) return null
  const definitionsById = new Map(definitions.map(item => [item.id, item]))
  return <section className="surface form-panel observation-stack">
    <h2>Observation history</h2>
    <details className="research-observations">
      <summary>{records.length} loaded observations</summary>
      <div className="research-table" role="region" aria-label="Observation history" tabIndex={0}><table>
        <thead><tr><th scope="col">Observed (UTC)</th><th scope="col">Parameter</th><th scope="col">Value</th>
          <th scope="col">Phase and activity</th><th scope="col">Quality</th><th scope="col">Provenance</th>
          <th scope="col">Device or protocol</th><th scope="col">Calibration</th><th scope="col">Uncertainty</th><th scope="col">Context</th></tr></thead>
        <tbody>{[...records].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)).map(item => <tr key={item.id}>
          <th scope="row">{utcTime.format(new Date(item.recorded_at))}</th>
          <td>{definitionsById.get(item.parameter)?.label ?? item.parameter}</td>
          <td className={item.event_text ? 'observation-event' : undefined}>{item.event_text ?? `${printable(item.value)} ${item.unit}`}</td>
          <td>{phases[item.phase]} · {item.activity}</td>
          <td>{item.provenance === 'SYNTHETIC' ? 'Simulated' : item.quality}</td><td>{item.provenance.replaceAll('_', ' ')}</td>
          <td>{item.device ?? '—'}</td>
          <td>{item.calibration ?? '—'}</td><td>{item.uncertainty === null ? '—' : `${printable(item.uncertainty)} ${item.unit}`}</td>
          <td>{item.context && <details><summary>Details</summary><dl className="detail-list">
            {Object.entries(item.context).filter(([key, value]) => key !== 'kind' && value !== null).map(([key, value]) =>
              <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}
          </dl></details>}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
  </section>
}

function LoadedContext({ access, token, definitions, context, onSaved, healthReview }: {
  access: ObservationAccess; token: string; definitions: ParameterDefinition[]; context: Context
  onSaved: () => void; healthReview: boolean
}) {
  const panels = context.crew
    ? [['Overview', 'overview'], ...(healthReview ? [['Medical review', 'health-review']] : []),
      ['Records', 'records'], ['Nutrition and gravity', 'context'], ['Radiation', 'radiation'], ['Devices', 'devices']]
    : [['Environment', 'environment'], ['Records', 'records'], ['Devices', 'devices']]
  const [view, setView] = useState(context.crew ? 'overview' : 'environment')
  const [reference, setReference] = useState({ query: '', revision: 0 })
  const [analysis, setAnalysis] = useState<{ report?: CrewReport; error?: string }>()
  const [medicalFindings, setMedicalFindings] = useState<number | null>(0)
  const [records, setRecords] = useState<MissionObservation[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const review = view === 'overview' || view === 'context'
  const through = new URLSearchParams(reference.query).get('through')
  useEffect(() => {
    if (!context.crew || !review) return
    let request: AbortController | undefined
    const reload = () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      void observationsApi.monitoring(token, context.mission, context.crew, new URLSearchParams(reference.query), controller.signal)
        .then(report => { if (!controller.signal.aborted) setAnalysis({ report }) },
          reason => { if (!controller.signal.aborted) setAnalysis({ error: errorText(reason) }) })
    }
    reload()
    const interval = through ? undefined : globalThis.setInterval(reload, 30_000)
    return () => { request?.abort(); globalThis.clearInterval(interval) }
  }, [token, context, review, reference, revision, through])

  useEffect(() => {
    if (view !== 'records' && view !== 'environment') return
    const controller = new AbortController()
    const params = new URLSearchParams({ limit: '200' })
    if (context.location) params.set('location', context.location)
    if (context.hours !== 'all') params.set('since', new Date(Date.now() - Number(context.hours) * 3_600_000).toISOString())
    const environment = new URLSearchParams(params)
    environment.set('scope', 'environment')
    const requests = [observationsApi.list(token, context.mission, environment, controller.signal)]
    if (access.role === 'medical' && context.crew) {
      params.set('scope', 'crew')
      params.set('crew_code', context.crew)
      requests.push(observationsApi.list(token, context.mission, params, controller.signal))
    }
    void Promise.allSettled(requests).then(results => {
      if (controller.signal.aborted) return
      const pages = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      setTruncated(pages.some(page => page.length === 200))
      setRecords(pages.flat())
      setError(results.flatMap(result => result.status === 'rejected' ? [errorText(result.reason)] : []).join(' '))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [access.role, token, context, revision, view])

  function refresh() {
    setLoading(true)
    setRevision(value => value + 1)
  }

  return <>
    <nav className="monitoring-tabs crew-workspace-tabs" aria-label="Monitoring views">
      {panels.map(([label, id]) => <button key={id} type="button" className="button secondary" aria-current={view === id ? 'page' : undefined}
        onClick={() => { if (id !== view && (id === 'records' || id === 'environment')) setLoading(true); setView(id) }}>
        {label}{id === 'health-review' && (medicalFindings === null ? ' · unavailable' : medicalFindings > 0 && ' · ' + medicalFindings)}
      </button>)}
    </nav>
    {!!context.crew && <div hidden={!review}>
      <ReferenceControls onApply={query => { setAnalysis(undefined); setReference(previous => ({ query, revision: previous.revision + 1 })) }} />
    </div>}
    {review && <div className="crew-monitoring-stack">
      {analysis?.report ? view === 'context' ? <CrewContext report={analysis.report} /> : <>
        <IndicatorCards indicators={analysis.report.indicators} />
        <p className="muted">References use this crew member’s verified history for the same measurement conditions. The observation band describes variation within the recorded history.</p>
      </> : <p className="notice" role="status">{analysis?.error ?? 'Loading crew history…'}</p>}
      {analysis?.error && <button className="button secondary" type="button" onClick={refresh}>Retry</button>}
    </div>}
    {view === 'radiation' && <CrewRadiation token={token} mission={context.mission} crew={context.crew} through={through}
      revision={revision} definitions={definitions} />}
    {healthReview && !!context.crew && <div hidden={view !== 'health-review'}>
      <HealthReview token={token} mission={context.mission} crew={context.crew} definitions={definitions}
        onFindings={setMedicalFindings} />
    </div>}
    {view === 'devices' && (context.location
      ? <DeviceQuality token={token} mission={context.mission} location={context.location} crew={context.crew}
        hours={context.hours} revision={revision} definitions={definitions} />
      : <p className="notice">Choose a location code above to review its device channels.</p>)}
    {(view === 'records' || view === 'environment') && <>
      {view === 'records' && <ObservationForm token={token} access={access} definitions={definitions} context={context}
        onSaved={() => { refresh(); onSaved() }} />}
      <div className="form-actions"><button className="button secondary" onClick={refresh} disabled={loading}>Refresh readings</button></div>
      <p className="form-feedback" role="status">{loading ? 'Loading observations…' : error || (truncated
        ? 'Showing the latest 200 observations per record type. Narrow the period to inspect other records.'
        : !records.length ? 'No observations in this review window.' : '')}</p>
      {!loading && <>
        {view === 'records' && <RestrictedHealthReview records={records} definitions={definitions} />}
        {view === 'environment' && <ObservationTrends records={records} definitions={definitions} />}
        <ObservationHistory records={records} definitions={definitions} />
      </>}
    </>}
  </>
}

function ConnectedLog({ access, token, definitions, onLock, healthReview }: {
  access: ObservationAccess; token: string; definitions: ParameterDefinition[]; onLock: () => void; healthReview: boolean
}) {
  const [request, setRequest] = useState<{ context: Context; id: number }>()
  const [mission, setMission] = useState(access.missions[0])
  const [crew, setCrew] = useState('')
  const [location, setLocation] = useState('')
  const [hours, setHours] = useState('all')
  const [roster, setRoster] = useState<CrewIdentity[]>([])
  const [rosterRevision, setRosterRevision] = useState(0)
  useEffect(() => {
    if (access.role !== 'medical') return
    let request: AbortController | undefined
    const loadRoster = () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      void observationsApi.crew(token, mission, controller.signal).then(items => {
        if (!controller.signal.aborted) setRoster(items)
      }, () => undefined)
    }
    loadRoster()
    const interval = window.setInterval(loadRoster, 30_000)
    return () => { request?.abort(); window.clearInterval(interval) }
  }, [access.role, mission, token, rosterRevision])

  function load(selectedCrew: string) {
    setCrew(selectedCrew)
    setRequest(current => ({ id: (current?.id ?? 0) + 1, context: { mission, location: location.trim(), crew: selectedCrew, hours } }))
  }
  return <>
    <section className="surface form-panel observation-stack" aria-labelledby="record-filter">
      <div className="section-heading"><h2 id="record-filter">Mission and crew</h2>
        <button className="button secondary" onClick={onLock}>Lock log</button></div>
      <p className="muted">Signed in as {access.actor} · {access.role}</p>
      {!!roster.length && <nav className="crew-roster" aria-label="Registered crew">
        {roster.map(person => <button type="button" key={person.crew_code} className="button secondary"
          aria-pressed={request?.context.crew === person.crew_code} onClick={() => load(person.crew_code)}>
          <strong>{person.crew_code}</strong>
          <small>{person.last_observation ? 'Last reading ' + utcTime.format(new Date(person.last_observation)) + ' UTC' : 'Awaiting readings'}</small>
        </button>)}
      </nav>}
      <form onSubmit={event => {
        event.preventDefault()
        load(crew.trim())
      }}>
        <div className="measurement-fields">
          <label>Mission<select name="mission" value={mission} onChange={event => {
            setMission(event.target.value); setRoster([]); setCrew(''); setRequest(undefined)
          }}>{access.missions.map(code => <option key={code}>{code}</option>)}</select></label>
          {access.role === 'medical' && <label>Crew code<input name="crew" value={crew} onChange={event => setCrew(event.target.value)}
            maxLength={64} pattern={codePattern} /></label>}
          <label>Location code (optional)<input name="location" value={location} onChange={event => setLocation(event.target.value)}
            placeholder="habitat-a" maxLength={64} pattern={codePattern} /></label>
          <label>Record history<select name="hours" value={hours} onChange={event => setHours(event.target.value)}>{ranges.map(([id, label]) =>
            <option key={id} value={id}>{label}</option>)}</select></label>
        </div>
        <div className="form-actions"><button className="button primary">Open workspace</button></div>
      </form>
    </section>
    {request && <LoadedContext key={request.id} {...{ access, token, definitions, healthReview, context: request.context }}
      onSaved={() => setRosterRevision(value => value + 1)} />}
  </>
}

export function RestrictedLog({ healthReview = false }: { healthReview?: boolean }) {
  const [session, setSession] = useState<{ access: ObservationAccess; token: string; definitions: ParameterDefinition[] }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (session) return <ConnectedLog {...session} healthReview={healthReview} onLock={() => setSession(undefined)} />

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
