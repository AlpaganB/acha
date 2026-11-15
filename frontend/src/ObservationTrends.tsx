import { useState } from 'react'
import type { MissionObservation, ParameterDefinition } from './api'
import { comparableTo, compareSeries, median, phaseSummary, pressureIntervals, priorBaseline, usableSeries,
  type NumericObservation } from './observationAnalysis'

export const phases = {
  preflight: 'Preflight', in_flight: 'In flight', eva: 'EVA', postflight: 'Postflight',
} as const

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
export const printable = (value: number | null) => value === null ? '—' : number.format(value)
export const utcTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })

function ObservationPlot({ series, definition }: { series: NumericObservation[]; definition: ParameterDefinition }) {
  const times = series.map(item => Date.parse(item.recorded_at))
  const values = series.map(item => item.value)
  const [start, end] = [Math.min(...times), Math.max(...times)]
  const [low, high] = [Math.min(...values), Math.max(...values)]
  const x = (time: number) => end === start ? 305 : 12 + (time - start) / (end - start) * 586
  const y = (value: number) => high === low ? 42 : 76 - (value - low) / (high - low) * 65
  return <figure className="observation-plot">
    <svg viewBox="0 0 610 84" preserveAspectRatio="none" role="img" aria-label={`${definition.label} observations over time`}>
      <line x1="12" y1="78" x2="598" y2="78" className="pressure-axis" />
      {series.map(item => <ellipse key={item.id} cx={x(Date.parse(item.recorded_at))} cy={y(item.value)} rx="3.4" ry="3.1"
        className="pressure-point"><title>{utcTime.format(new Date(item.recorded_at))} UTC · {item.value} {item.unit}</title></ellipse>)}
    </svg>
    <figcaption>
      <div className="pressure-time-axis"><span>{utcTime.format(start)} UTC</span><span>{utcTime.format(end)} UTC</span></div>
      <p className="observation-range">{definition.label} · {printable(low)}{low === high ? '' : `–${printable(high)}`} {definition.unit}</p>
    </figcaption>
  </figure>
}

export function ObservationTrends({ records, definitions }: { records: MissionObservation[]; definitions: ParameterDefinition[] }) {
  const available = definitions.filter(parameter => parameter.input_kind === 'number'
    && records.some(record => record.parameter === parameter.id))
  const [firstId, setFirstId] = useState('sleep_minutes')
  const [secondId, setSecondId] = useState('reaction_time')
  const [minutes, setMinutes] = useState(720)
  const [phase, setPhase] = useState('in_flight')
  const [threshold, setThreshold] = useState('')
  const first = available.find(item => item.id === firstId) ?? available[0]
  if (!first) return null
  const alternatives = available.filter(item => item.id !== first.id)
  const second = alternatives.find(item => item.id === secondId) ?? alternatives[0]
  const a = usableSeries(records, first.id)
  const b = second ? usableSeries(records, second.id) : []
  const withinPhase = a.filter(item => phase === 'all' || item.phase === phase)
  const compared = b.filter(item => phase === 'all' || item.phase === phase)
  const baseline = priorBaseline(withinPhase)
  const phasesCompared = phaseSummary(a)
  const last = withinPhase.at(-1)
  const lastCompared = compared.at(-1)
  const pairableFirst = last ? withinPhase.filter(item => comparableTo(item, last)) : []
  const pairableSecond = lastCompared ? compared.filter(item => comparableTo(item, lastCompared)) : []
  const { pairs, correlation } = compareSeries(pairableFirst, pairableSecond, minutes)
  const recent = last ? pairableFirst.filter(item => item.phase === last.phase && item.activity === last.activity).slice(-3) : []
  const intervals = ['cabin_pressure', 'suit_pressure'].includes(first.id) ? pressureIntervals(withinPhase) : []
  const boundary = threshold === '' ? null : Number(threshold)
  const exposure = boundary === null ? null : intervals.filter(item => item.initial < boundary && item.final < boundary)
    .reduce((sum, item) => sum + item.minutes, 0)
  const mostRapid = intervals.reduce<typeof intervals[number] | undefined>((best, item) =>
    !best || Math.abs(item.rate) > Math.abs(best.rate) ? item : best, undefined)

  return <section className="surface form-panel observation-stack" aria-labelledby="observation-trends">
    <h2 id="observation-trends">Trends and comparisons</h2>
    <div className="measurement-fields">
      <label>First parameter<select value={first.id} onChange={event => setFirstId(event.target.value)}>{available.map(item =>
        <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Compare with<select value={second?.id ?? ''} disabled={!second} onChange={event => setSecondId(event.target.value)}>
        {!second && <option value="">No second parameter</option>}{alternatives.map(item =>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Phase<select value={phase} onChange={event => setPhase(event.target.value)}>
        <option value="all">All phases</option>{Object.entries(phases).map(([value, title]) =>
          <option key={value} value={value}>{title}</option>)}</select></label>
      <label>Pairing window<select value={minutes} onChange={event => setMinutes(Number(event.target.value))}>
        <option value={5}>Within 5 min</option><option value={15}>Within 15 min</option><option value={720}>Within 12 h</option>
      </select></label>
    </div>
    {last ? <>
      <ObservationPlot series={withinPhase} definition={first} />
      <dl className="detail-list">
        <div><dt>Latest of {withinPhase.length} usable observations</dt><dd>{printable(last.value)} {first.unit}</dd></div>
        <div><dt>Latest vs comparable 30-day median</dt><dd>{baseline.value === null ? `Needs five earlier readings (${baseline.count} available)`
          : `${printable(baseline.delta)} ${first.unit} vs ${printable(baseline.value)} ${first.unit} (${baseline.count} earlier)`}</dd></div>
        <div><dt>Latest three comparable readings</dt><dd>{recent.length === 3
          ? `${printable(recent.reduce((total, item) => total + item.value, 0) / 3)} ${first.unit} mean` : 'Fewer than three readings'}</dd></div>
        {mostRapid && <div><dt>Steepest observed pressure rate</dt><dd>{printable(mostRapid.rate)} kPa/min ·
          {' '}{printable(mostRapid.initial)} to {printable(mostRapid.final)} kPa in {printable(mostRapid.minutes)} min ·
          {' '}{utcTime.format(new Date(mostRapid.end))} UTC</dd></div>}
      </dl>
      {['cabin_pressure', 'suit_pressure'].includes(first.id) && <details className="research-observations">
        <summary>Review sampled pressure exposure</summary>
        <div className="measurement-fields"><label>Review boundary (kPa)<input type="number" min="0" step="any"
          value={threshold} onChange={event => setThreshold(event.target.value)} /></label></div>
        <p className="muted">{intervals.length} comparable intervals up to five minutes long.
          {exposure !== null && boundary !== null && boundary >= 0 && ` ${printable(exposure)} sampled minutes below the entered boundary.`}
          {' '}Intervals count only if both endpoints are below the review value. This calculation leaves gaps and crossings unclassified.</p>
      </details>}
    </> : <p className="notice">No verified observations for this parameter and phase.</p>}
    <div className="research-table" role="region" tabIndex={0} aria-label="Phase summary"><table>
      <caption>Comparable {first.label.toLowerCase()} by mission phase</caption>
      <thead><tr><th scope="col">Phase</th><th scope="col">Median ({first.unit})</th><th scope="col">Samples</th></tr></thead>
      <tbody>{phasesCompared.map(item => <tr key={item.phase}><th scope="row">{phases[item.phase as keyof typeof phases]}</th>
        <td>{printable(item.median)}</td><td>{item.count}</td></tr>)}</tbody>
    </table></div>
    {second && <div className="notice observation-comparison">
      <strong>{first.label} and {second.label}</strong>
      <p>{pairs.length} matched pairs · {correlation === null ? 'Correlation requires five pairs and variation in both series.'
        : `Pearson r = ${printable(correlation)} · Median lag ${printable(median(pairs.map(pair => pair.lag)))} min.`}</p>
      <p>Pairs use the nearest unused later or simultaneous reading in the same phase and location. Each series uses its latest device, calibration and recorded session conditions.
        Activity, workload and shared trends may affect associations.</p>
      {pairs.length > 0 && <details className="research-observations">
        <summary>View matched readings</summary>
        <div className="research-table" tabIndex={0} role="region" aria-label="Matched observation pairs"><table>
          <thead><tr><th scope="col">First observation (UTC)</th><th scope="col">{first.label} ({first.unit})</th>
            <th scope="col">{second.label} ({second.unit})</th><th scope="col">Lag (min)</th></tr></thead>
          <tbody>{pairs.map(pair => <tr key={pair.left.id}>
            <th scope="row">{utcTime.format(new Date(pair.left.recorded_at))}</th>
            <td>{printable(pair.left.value)}</td><td>{printable(pair.right.value)}</td><td>{printable(pair.lag)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
    </div>}
    <p className="muted">Plots show recorded points. Unverified, suspect and conflicting observations are excluded from calculations.</p>
  </section>
}
