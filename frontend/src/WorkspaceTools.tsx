import { useEffect, useRef, useState } from 'react'
import { api, type Assessment, type CrewMember, type Measurement, type MissionProfile } from './api'
import { environmentLabels, formatDate, measurementLabels } from './content'

const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim()
const lines = (data: FormData, name: string) => text(data, name).split(/\r?\n/).map(value => value.trim()).filter(Boolean)
function useSubmission() {
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setSaving(true); setMessage(''); setFailed(false)
    try { await action() }
    catch (reason) { setFailed(true); setMessage(reason instanceof Error ? reason.message : 'The request could not be completed.') }
    finally { lock.current = false; setSaving(false) }
  }
  return { saving, message, failed, run, setMessage }
}
function Feedback({ message, failed }: { message: string; failed: boolean }) {
  return message ? <p className="form-feedback" role={failed ? 'alert' : 'status'}>{message}</p> : null
}
export function CreateCrew({ profiles, reachable, onCreated }: {
  profiles: MissionProfile[]; reachable: boolean; onCreated: () => Promise<void>
}) {
  const state = useSubmission()
  return <details className="surface workspace-tools"><summary>Add crew member</summary>
    <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form)
      void state.run(async () => {
        const member = await api.createCrew({ display_name: text(fields, 'name'), mission_profile_id: text(fields, 'profile') })
        form.reset(); state.setMessage(`${member.display_name} was added.`); await onCreated()
      })
    }}>
      <fieldset disabled={state.saving || !reachable || !profiles.length}><div className="measurement-fields">
        <label>Display name<input name="name" required maxLength={120} /></label>
        <label>Mission profile<select name="profile" required><option value="">Choose a profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      </div><div className="form-actions"><button className="button primary" type="submit">{state.saving ? 'Adding...' : 'Add crew member'}</button></div></fieldset>
    </form>
    {!reachable && <p className="muted">Connect to the mission service to add a crew member.</p>}
    {!profiles.length && <a className="text-link" href="/mission">Create a mission profile first</a>}
    <Feedback {...state} />
  </details>
}
export function CrewDetails({ id, profiles, reachable }: { id: string; profiles: MissionProfile[]; reachable: boolean }) {
  const [state, setState] = useState<{ record?: CrewMember; error?: string }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!reachable) return
    const controller = new AbortController(); setState(undefined)
    void api.crewMember(id, controller.signal).then(record => { if (!controller.signal.aborted) setState({ record }) }, reason => {
      if (!controller.signal.aborted) setState({ error: reason instanceof Error ? reason.message : 'Could not load crew details.' })
    })
    return () => controller.abort()
  }, [id, reachable, retry])
  return <section className="surface workspace-tools" aria-label="Selected crew details"><h2>Selected crew member</h2>
    {state?.record ? <dl className="detail-list"><div><dt>Name</dt><dd>{state.record.display_name}</dd></div>
      <div><dt>Mission profile</dt><dd>{profiles.find(profile => profile.id === state.record?.mission_profile_id)?.name ?? 'Unavailable'}</dd></div>
      <div><dt>Crew ID</dt><dd>{state.record.id}</dd></div></dl>
      : <p role="status">{!reachable ? 'Connect to load crew details.' : state?.error ?? 'Loading crew details...'}</p>}
    {state?.error && reachable && <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button>}
  </section>
}
export function ProfileTools({ selectedId, reachable, onCreated }: { selectedId?: string; reachable: boolean; onCreated: () => Promise<void> }) {
  const state = useSubmission()
  const [details, setDetails] = useState<{ profile?: MissionProfile; error?: string }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setDetails(undefined)
    if (!selectedId || !reachable) return
    const controller = new AbortController()
    void api.profile(selectedId, controller.signal).then(profile => { if (!controller.signal.aborted) setDetails({ profile }) }, reason => {
      if (!controller.signal.aborted) setDetails({ error: reason instanceof Error ? reason.message : 'Could not load profile details.' })
    })
    return () => controller.abort()
  }, [selectedId, reachable, retry])
  return <>
    {selectedId && <section className="surface workspace-tools"><h2>Measurement schedule</h2>
      {details?.profile ? <>
        {details.profile.measurement_schedules?.length ? <dl className="detail-list">{details.profile.measurement_schedules.map(item => <div key={item.kind}>
          <dt>{measurementLabels[item.kind] ?? item.kind}</dt><dd>Every {item.interval_minutes} minutes</dd>
        </div>)}</dl> : <p className="muted">No measurement schedule is configured for this profile.</p>}
        <p className="muted">Guidance protocols: {details.profile.guidance_protocol_ids.join(', ') || 'None assigned'}</p>
      </> : <p role="status">{!reachable ? 'Connect to load the schedule.' : details?.error ?? 'Loading profile...'}</p>}
      {details?.error && reachable && <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button>}
    </section>}
    <details className="surface workspace-tools"><summary>Create mission profile</summary>
      <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form)
        void state.run(async () => {
          const profile = await api.createProfile({ name: text(fields, 'name'), environment: text(fields, 'environment') as MissionProfile['environment'],
            equipment: lines(fields, 'equipment'), constraints: lines(fields, 'constraints'), guidance_protocol_ids: lines(fields, 'protocols'),
            measurement_schedules: Object.keys(measurementLabels).flatMap(kind => fields.get(`schedule-${kind}`) ? [{ kind, interval_minutes: Number(fields.get(`schedule-${kind}`)) }] : []) })
          form.reset(); state.setMessage(`${profile.name} was created.`); await onCreated()
        })
      }}>
        <fieldset disabled={state.saving || !reachable}><div className="measurement-fields">
          <label>Profile name<input name="name" maxLength={120} required /></label>
          <label>Environment<select name="environment">{Object.entries(environmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Equipment (one per line)<textarea name="equipment" rows={3} /></label>
          <label>Constraints (one per line)<textarea name="constraints" rows={3} /></label>
          <label>Guidance protocol IDs (one per line)<textarea name="protocols" rows={2} /></label>
        </div>
        <h3>Measurement intervals</h3><p className="muted">Minutes between readings. Leave blank for unscheduled indicators.</p>
        <div className="measurement-fields schedule-fields">{Object.entries(measurementLabels).map(([kind, label]) => <label key={kind}>{label}<input name={`schedule-${kind}`} type="number" min={1} max={525600} step={1} /></label>)}</div>
        <button className="button primary" type="submit">{state.saving ? 'Creating...' : 'Create profile'}</button></fieldset>
      </form><Feedback {...state} />
      {!reachable && <p className="muted">Connect to the mission service to create a profile.</p>}
    </details>
  </>
}
export function MeasurementDetails({ crewId, id, reachable, load = api.measurement }: { crewId?: string; id: string; reachable: boolean; load?: typeof api.measurement }) {
  const [state, setState] = useState<{ reading?: Measurement; error?: string }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setState(undefined)
    if (!crewId || !reachable) return
    const controller = new AbortController()
    void load(crewId, id, controller.signal).then(reading => { if (!controller.signal.aborted) setState({ reading }) }, reason => {
      if (!controller.signal.aborted) setState({ error: reason instanceof Error ? reason.message : 'Could not load the reading.' })
    })
    return () => controller.abort()
  }, [crewId, id, reachable, retry, load])
  return <>
    <a className="back-link" href="/measurements">All measurements</a><header className="page-title"><h1>Measurement details</h1></header>
    <section className="surface workspace-tools">{state?.reading ? <>
      <h2>{measurementLabels[state.reading.kind] ?? state.reading.kind}</h2><dl className="detail-list">
        <div><dt>Reading</dt><dd>{state.reading.value}{state.reading.diastolic !== null && `/${state.reading.diastolic}`} {state.reading.unit}</dd></div>
        <div><dt>Recorded</dt><dd><time dateTime={state.reading.recorded_at}>{formatDate(state.reading.recorded_at)}</time></dd></div>
        <div><dt>Record ID</dt><dd>{state.reading.id}</dd></div>
      </dl><a className="button secondary" href={`/assessment?measurement=${id}`}>Start assessment</a>
    </> : <p role="status">{!crewId ? 'Choose a crew member to view the reading.' : !reachable ? 'Connect to load this reading.' : state?.error ?? 'Loading reading...'}</p>}
    {state?.error && reachable && <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button>}</section>
  </>
}
export function ExternalAssessmentResult({ crewId, id, onRecord }: { crewId: string; id: string; onRecord: (record: Assessment) => void }) {
  const state = useSubmission()
  return <details className="workspace-tools"><summary>Import external engine result</summary>
    <p className="muted">Use an existing result from your assessment engine. A stored result cannot be replaced with a different result.</p>
    <form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget)
      void state.run(async () => { onRecord(await api.storeAssessmentResult(crewId, id, {
        status: text(fields, 'status'), rationale: text(fields, 'rationale'), next_step: text(fields, 'next'), protocol_id: text(fields, 'protocol') || null,
      })) })
    }}>
      <fieldset disabled={state.saving}><div className="measurement-fields">
        <label>Engine status<input name="status" required maxLength={32} pattern="[a-z][a-z0-9_-]*" /></label>
        <label>Rationale<textarea name="rationale" required maxLength={2000} rows={3} /></label>
        <label>Next step<textarea name="next" required maxLength={2000} rows={3} /></label>
        <label>Guidance protocol ID<input name="protocol" maxLength={64} pattern="[a-z][a-z0-9_-]*" /></label>
      </div><button className="button secondary" type="submit">{state.saving ? 'Saving...' : 'Save engine result'}</button></fieldset>
    </form><Feedback {...state} />
  </details>
}
