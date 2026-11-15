import { useEffect, useRef, useState } from 'react'
import { ApiError, observationsApi, type ChannelQuality, type ParameterDefinition, type RadiationReview } from './api'
import { printable, utcTime } from './ObservationTrends'
import { utcInput } from './ObservationFields'

const radiationRates = new Set(['absorbed_dose_rate', 'dose_equivalent_rate', 'personal_dose_equivalent_rate', 'personal_absorbed_dose_rate'])
const qualityLabels = {
  accepted: 'Accepted', saturated: 'Saturated', detached: 'Detached', artefact: 'Artefact', out_of_range: 'Out of range',
}

function RadiationWindow({ token, mission, channels, definitions }: {
  token: string; mission: string; channels: ChannelQuality[]; definitions: ParameterDefinition[]
}) {
  const [channelCode, setChannelCode] = useState(channels[0].channel)
  const [state, setState] = useState<{ loading?: boolean; report?: RadiationReview; error?: string }>({})
  const request = useRef<AbortController>(null)
  useEffect(() => () => request.current?.abort(), [])
  const channel = channels.find(item => item.channel === channelCode) ?? channels[0]

  async function review(form: HTMLFormElement) {
    const fields = new FormData(form)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState({ loading: true })
    const number = (key: string) => Number(fields.get(key))
    try {
      const report = await observationsApi.reviewRadiation(token, mission, {
        channel: channel.channel, end: utcInput(fields.get('end')), boundary: number('boundary'),
        window_seconds: number('window'), maximum_gap_seconds: number('gap'),
        minimum_coverage: number('coverage') / 100, minimum_exceedance_seconds: number('exceedance'),
        uncertainty_margin: number('margin'),
      }, controller.signal)
      if (!controller.signal.aborted) setState({ report })
    } catch (error) {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'The review could not be loaded.' })
    }
  }

  return <details className="research-observations">
    <summary>Review a completed radiation window</summary>
    <form onSubmit={event => { event.preventDefault(); void review(event.currentTarget) }}>
      <fieldset className="observation-fieldset" disabled={state.loading}>
        <div className="measurement-fields">
          <label>Channel<select value={channel.channel} onChange={event => { setChannelCode(event.target.value); setState({}) }}>
            {channels.map(item => <option key={item.channel} value={item.channel}>{item.channel} ·
              {' '}{definitions.find(definition => definition.id === item.parameter)?.label ?? item.parameter}</option>)}
          </select></label>
          <label>Window end (UTC)<input name="end" type="datetime-local" step="1" required /></label>
          <label>Review boundary ({channel.unit})<input key={channel.channel} name="boundary" type="number" min="0" step="any" required /></label>
          <label>Window length (seconds)<input name="window" type="number" min="2" max="86400" required /></label>
          <label>Maximum interval (seconds)<input name="gap" type="number" min="1" max="86400" required /></label>
          <label>Minimum coverage (%)<input name="coverage" type="number" min="0.01" max="100" step="any" required /></label>
          <label>Minimum exceedance (seconds)<input name="exceedance" type="number" min="1" max="86400" required /></label>
          <label>Additional uncertainty margin ({channel.unit})<input key={channel.channel + '-margin'} name="margin" type="number" min="0" step="any" required /></label>
        </div>
      </fieldset>
      <div className="form-actions"><button className="button secondary" disabled={state.loading}>Review window</button></div>
    </form>
    <p className="muted">The review compares the lower bound of each rate sample with the entered boundary. Gaps and samples with missing uncertainty break intervals.</p>
    {state.loading && <p role="status">Reviewing observations…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.report && <dl className="detail-list" role="status">
      <div><dt>Result</dt><dd>{{ insufficient_data: 'Insufficient sampled coverage', boundary_exceeded: 'Boundary exceeded in sampled interval',
        boundary_not_observed: 'No qualifying exceedance observed' }[state.report.result]}</dd></div>
      <div><dt>Coverage</dt><dd>{printable(state.report.coverage * 100)}%</dd></div>
      <div><dt>Longest sampled exceedance</dt><dd>{printable(state.report.longest_exceedance_seconds)} s</dd></div>
    </dl>}
  </details>
}

export function DeviceQuality({ token, mission, location, crew, hours, revision, definitions }: {
  token: string; mission: string; location: string; crew: string; hours: string; revision: number; definitions: ParameterDefinition[]
}) {
  const [state, setState] = useState<{ channels: ChannelQuality[]; errors: string[] }>()
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ location, scope: 'environment' })
    if (hours !== 'all') query.set('since', new Date(Date.now() - Number(hours) * 3_600_000).toISOString())
    const requests = [observationsApi.channels(token, mission, query, controller.signal)]
    if (crew) {
      const crewQuery = new URLSearchParams(query)
      crewQuery.set('scope', 'crew')
      crewQuery.set('crew_code', crew)
      requests.push(observationsApi.channels(token, mission, crewQuery, controller.signal))
    }
    void Promise.allSettled(requests).then(results => {
      if (!controller.signal.aborted) setState({
        channels: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        errors: results.flatMap(result => result.status === 'rejected'
          && !(result.reason instanceof ApiError && result.reason.status === 404) ? [String(result.reason.message ?? result.reason)] : []),
      })
    })
    return () => controller.abort()
  }, [token, mission, location, crew, hours, revision])
  if (!state || (!state.channels.length && !state.errors.length)) return null
  const radiation = state.channels.filter(item => radiationRates.has(item.parameter))

  return <section className="surface form-panel observation-stack">
    <h2>Device channels</h2>
    {state.errors.map((error, index) => <p key={index} className="form-feedback" role="status">{error}</p>)}
    {!!state.channels.length && <div className="research-table" tabIndex={0} role="region" aria-label="Device data quality"><table>
      <thead><tr><th scope="col">Channel</th><th scope="col">Firmware and calibration</th><th scope="col">Cadence</th>
        <th scope="col">Last sample (UTC)</th><th scope="col">Last upload (UTC)</th><th scope="col">Sequence gaps</th>
        {Object.values(qualityLabels).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{state.channels.map(item => <tr key={item.channel}>
        <th scope="row">{item.channel}<br />{definitions.find(definition => definition.id === item.parameter)?.label ?? item.parameter}</th>
        <td>{item.firmware} · {item.calibration}</td><td>{item.sample_interval_ms === null ? 'Event based' : item.sample_interval_ms + ' ms'}</td>
        <td>{item.last_sample_at ? utcTime.format(new Date(item.last_sample_at)) : '—'}</td>
        <td>{item.last_received_at ? utcTime.format(new Date(item.last_received_at)) : '—'}</td>
        <td>{item.missing_sequences}</td>{Object.keys(qualityLabels).map(key => <td key={key}>{item.counts[key] ?? 0}</td>)}
      </tr>)}</tbody>
    </table></div>}
    {!!radiation.length && <RadiationWindow token={token} mission={mission} channels={radiation} definitions={definitions} />}
  </section>
}
