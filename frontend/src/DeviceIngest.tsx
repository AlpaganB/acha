import { useEffect, useRef, useState } from 'react'
import { observationsApi, type DeviceReceipt, type DeviceSampleInput } from './api'

const code = '[a-z][a-z0-9_-]{0,63}'
export function DeviceIngest() {
  const [deployment, setDeployment] = useState<'checking' | 'restricted' | 'public' | 'unavailable'>('checking')
  const [retry, setRetry] = useState(0)
  const [quality, setQuality] = useState<DeviceSampleInput['quality']>('ok')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<DeviceReceipt>()
  const [error, setError] = useState('')
  const lock = useRef(false)
  const request = useRef<AbortController>(null)
  useEffect(() => {
    const controller = new AbortController(); setDeployment('checking')
    void observationsApi.deployment(controller.signal).then(result => {
      if (!controller.signal.aborted) setDeployment(result.workspace === 'restricted' ? 'restricted' : 'public')
    }, () => { if (!controller.signal.aborted) setDeployment('unavailable') })
    return () => { controller.abort(); request.current?.abort() }
  }, [retry])
  async function send(form: HTMLFormElement) {
    if (lock.current || deployment !== 'restricted') return
    const fields = new FormData(form)
    const value = (name: string) => String(fields.get(name) ?? '').trim()
    const numeric = (name: string) => Number(value(name))
    const timestamp = Date.parse(value('time') + 'Z')
    if (!Number.isFinite(timestamp)) { setError('Enter a valid UTC timestamp.'); return }
    lock.current = true; setSaving(true); setError(''); setReceipt(undefined)
    const controller = new AbortController(); request.current = controller
    try {
      const sample: DeviceSampleInput = {
        sequence: numeric('sequence'), recorded_at: new Date(timestamp).toISOString(), mission_elapsed_ms: numeric('elapsed'),
        clock_error_ms: numeric('clock'), firmware: value('firmware'), quality,
        value: quality === 'detached' || !value('value') ? null : numeric('value'),
        uncertainty: quality === 'detached' || !value('uncertainty') ? null : numeric('uncertainty'), activity: value('activity') as DeviceSampleInput['activity'],
      }
      const response = await observationsApi.ingestSample(value('key'), value('mission'), value('channel'), sample, controller.signal)
      if (!controller.signal.aborted) {
        setReceipt(response)
        const key = form.elements.namedItem('key'); if (key instanceof HTMLInputElement) key.value = ''
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The sample could not be sent.') }
    finally { lock.current = false; if (!controller.signal.aborted) setSaving(false) }
  }
  return <section className="surface workspace-tools" aria-labelledby="device-ingest-heading">
    <h2 id="device-ingest-heading">Device sample upload</h2>
    <p className="muted">Send a recorded sample to an existing registered device channel. Use its firmware, mission clock and device key. The key is kept only in this form and cleared after a successful upload.</p>
    {deployment !== 'restricted' ? <p className="notice" role="status">{deployment === 'checking' ? 'Checking the mission workspace...' : deployment === 'public'
      ? 'Device uploads are available in the restricted workspace.' : 'The mission service is unavailable.'}
      {deployment === 'unavailable' && <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button>}
      {deployment === 'public' && import.meta.env.VITE_RESTRICTED_WORKSPACE_URL && <a className="text-link" href={import.meta.env.VITE_RESTRICTED_WORKSPACE_URL}>Open restricted workspace</a>}
    </p> : <form onSubmit={event => { event.preventDefault(); void send(event.currentTarget) }}>
      <fieldset disabled={saving}><div className="measurement-fields">
        <label>Mission code<input name="mission" required pattern={code} maxLength={64} /></label>
        <label>Channel code<input name="channel" required pattern={code} maxLength={64} /></label>
        <label>Device key<input name="key" type="password" autoComplete="off" required minLength={32} maxLength={256} /></label>
        <label>Firmware version<input name="firmware" required maxLength={120} /></label>
        <label>Sequence<input name="sequence" type="number" min={0} max={9007199254740991} step={1} required /></label>
        <label>Recorded at (UTC)<input name="time" type="datetime-local" step={60} required /></label>
        <label>Mission elapsed time (ms)<input name="elapsed" type="number" min={0} max={9007199254740991} step={1} required /></label>
        <label>Clock error (ms)<input name="clock" type="number" min={0} max={60000} step={1} required /></label>
        <label>Sample quality<select value={quality} onChange={event => setQuality(event.target.value as DeviceSampleInput['quality'])}>
          <option value="ok">OK</option><option value="saturated">Saturated</option><option value="detached">Detached</option><option value="artefact">Artefact</option>
        </select></label>
        <label>Value<input name="value" type="number" min={-1e12} max={1e12} step="any" disabled={quality === 'detached'} required={quality === 'ok'} /></label>
        <label>Uncertainty<input name="uncertainty" type="number" min={0} max={1e12} step="any" disabled={quality === 'detached'} /></label>
        <label>Activity<select name="activity"><option value="unknown">Unknown</option><option value="rest">Rest</option><option value="exercise">Exercise</option><option value="task">Task</option></select></label>
      </div><div className="form-actions"><button className="button primary" type="submit">{saving ? 'Uploading...' : 'Upload sample'}</button></div></fieldset>
    </form>}
    {error && <p className="form-feedback" role="alert">{error}</p>}
    {receipt && <div role="status"><h3>Upload receipt</h3><dl className="detail-list">
      <div><dt>Sequence</dt><dd>{receipt.sequence}</dd></div><div><dt>Status</dt><dd>{receipt.status.replaceAll('_', ' ')}</dd></div>
      <div><dt>Observation ID</dt><dd>{receipt.observation_id ?? 'No usable observation was created.'}</dd></div>
    </dl></div>}
  </section>
}
