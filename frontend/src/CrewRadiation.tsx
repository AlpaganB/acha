import { useEffect, useState } from 'react'
import { observationsApi, type CrewRadiationReport, type ParameterDefinition } from './api'
import { utcTime } from './ObservationTrends'
import { signedValue } from './PersonalIndicators'

const doseNumber = new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 6 })
const doseText = (value: number | null, unit: string) => value === null ? '—' : doseNumber.format(value) + ' ' + unit
const percent = (fraction: number) => {
  const value = fraction * 100
  return value > 0 && value < 0.01 ? '<0.01%' : value.toFixed(2).replace(/\.?0+$/, '') + '%'
}
const radText = (value: number | null) => value !== null && ' · ' + doseText(value, 'rad')

function ChannelDose({ row, label }: { row: CrewRadiationReport['channels'][number]; label: string }) {
  return <article className="crew-dose-channel">
    <div className="section-heading"><h3>{label}</h3><span className="muted">{row.channel} · {row.location} · {row.calibration}</span></div>
    <dl className="crew-exposure-metrics">
      <div><dt>Dose over sampled time</dt><dd>{row.dose === null ? 'Insufficient paired samples' : doseText(row.dose, row.unit)}{radText(row.rad)}</dd></div>
      <div><dt>Window coverage</dt><dd>{percent(row.coverage)} · {doseText(row.covered_hours, 'h')}</dd></div>
      <div><dt>Latest rate</dt><dd>{doseText(row.last_rate, row.reported_rate_unit)}
        {row.last_sample && <small>{utcTime.format(new Date(row.last_sample))} UTC</small>}</dd></div>
      <div><dt>Sample uncertainty bounds</dt><dd>{row.lower !== null && row.upper !== null
        ? doseText(row.lower, row.unit) + ' to ' + doseText(row.upper, row.unit) : 'Unavailable'}</dd></div>
    </dl>
    <p className="muted">Source {row.context.source_ref} · Geometry {row.context.geometry_ref} ·
      {' '}Shielding {row.context.shielding_ref} · Particles {row.context.particle_class}</p>
    {row.gap_intervals > 0 && <p className="muted">{row.gap_intervals} intervals excluded from accumulation.</p>}
    {row.daily.length > 0 && <details className="research-observations">
      <summary>See daily dose and cumulative change</summary>
      <div className="research-table" tabIndex={0} role="region" aria-label={'Daily collected dose for ' + row.channel}>
        <table><thead><tr><th scope="col">UTC day</th><th scope="col">Covered hours</th>
          <th scope="col">Observed dose</th><th scope="col">Cumulative observed dose</th></tr></thead>
          <tbody>{row.daily.map(day => <tr key={day.date}><th scope="row">{day.date}</th>
            <td>{doseText(day.covered_hours, 'h')}</td><td>{doseText(day.dose, row.unit)}</td>
            <td>{doseText(day.running_observed_dose, row.unit)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>}
  </article>
}

export function CrewRadiation({ token, mission, crew, through, revision, definitions }: {
  token: string; mission: string; crew: string; through: string | null; revision: number; definitions: ParameterDefinition[]
}) {
  const [period, setPeriod] = useState('30')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ report?: CrewRadiationReport; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    const end = through ? new Date(through) : new Date()
    const query = new URLSearchParams({ end: end.toISOString() })
    if (period === 'mission') query.set('mode', 'mission')
    else query.set('start', new Date(end.getTime() - Number(period) * 86_400_000).toISOString())
    setState(undefined)
    void observationsApi.radiation(token, mission, crew, query, controller.signal).then(report => {
      if (!controller.signal.aborted) setState({ report })
    }, error => {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Radiation records are unavailable.' })
    })
    return () => controller.abort()
  }, [token, mission, crew, through, period, revision, attempt])
  const report = state?.report
  const label = (id: string) => definitions.find(item => item.id === id)?.label ?? id

  return <div className="crew-monitoring-stack">
    <section className="surface form-panel" aria-labelledby="personal-radiation">
      <div className="section-heading">
        <h2 id="personal-radiation">Personal radiation exposure</h2>
        <label>Window <select value={period} onChange={event => setPeriod(event.target.value)}>
          <option value="mission">Mission or recorded history</option>
          <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option>
        </select></label>
      </div>
      {!report ? <>
        <p role="status" className="notice">{state?.error ?? 'Loading personal dosimetry…'}</p>
        {state?.error && <button type="button" className="button secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
      </> : <>
        <p className="muted">{utcTime.format(new Date(report.start))} UTC to {utcTime.format(new Date(report.end))} UTC.
          {report.start_source === 'mission_clock' && ' Coverage starts at the configured mission epoch.'}
          {report.start_source === 'first_record' && ' Coverage starts at the first available dosimetry record.'}
          {' '}Each dosimeter has its own coverage and cumulative series.</p>
        {!report.channels.length && !report.counters.length && !report.estimates.length && !report.reported_rates.length
          && <p className="notice">No personal dosimetry in this window. Record a verified dosimeter result or connect a registered channel.</p>}
        {report.channels.map(row => <ChannelDose key={row.channel} row={row} label={label(row.parameter)} />)}
        {(report.counters.length > 0 || report.reported_rates.length > 0 || report.estimates.length > 0) && <dl className="detail-list">
          {report.counters.map(({ observation, rad, reset, change }) => <div key={observation.id}>
            <dt>{label(observation.parameter)} · {observation.device}</dt>
            <dd>{doseText(observation.value, observation.unit)}{radText(rad)} · {utcTime.format(new Date(observation.recorded_at))} UTC
              {reset ? ' · Counter decrease detected' : change !== null ? ' · Recorded counter change ' + signedValue(change) + ' ' + observation.unit : ''}</dd>
          </div>)}
          {report.reported_rates.map(row => <div key={row.id}><dt>{label(row.parameter)} · reported reading</dt>
            <dd>{doseText(row.value, row.unit)} · {row.device} · {utcTime.format(new Date(row.recorded_at))} UTC</dd>
          </div>)}
          {report.estimates.map(row => <div key={row.id}><dt>{label(row.parameter)}</dt>
            <dd>{doseText(row.value, row.unit)}{row.context?.kind === 'dose_estimate'
              && ' · ' + [row.context.tissue, row.context.model_version, row.context.source_ref].filter(Boolean).join(' · ')}</dd>
          </div>)}
        </dl>}
      </>}
    </section>
    <section className="surface form-panel" aria-labelledby="radiation-effects">
      <h2 id="radiation-effects">Health effects and dose quantities</h2>
      <p>Absorbed dose is measured in gray or rad. The detected absorbed dose is shown in mGy and rad using the same instrument reading.
        Dose equivalent in mSv accounts for radiation quality. Tissue and effective dose estimates use separately documented models.</p>
      <p>NASA studies cancer, cardiovascular and nervous-system effects from space radiation. Personal risk estimates require the radiation field,
        organ dose, exposure history and a validated risk model.</p>
      <div className="form-actions">
        <a className="text-link" href="https://srag.jsc.nasa.gov/SpaceRadiation/FAQ/FAQ.cfm">NASA dosimetry and units</a>
        <a className="text-link" href="https://www.nasa.gov/directorates/esdmd/hhp/space-radiation/">NASA radiation health research</a>
      </div>
    </section>
  </div>
}
