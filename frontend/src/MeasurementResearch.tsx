import { useEffect, useState } from 'react'
import { api, type AssayCoverage, type WaveformWindow } from './api'
import { printable } from './ObservationTrends'

const signalLabels = { II: 'ECG lead II', PLETH: 'Photoplethysmogram', RESP: 'Impedance respiration' }

function SignalChart({ channel, rate }: { channel: WaveformWindow['channels'][number]; rate: number }) {
  const valid = channel.values.filter(value => value !== null)
  const label = signalLabels[channel.code]
  if (!valid.length) return <p>{label} has no samples in this window.</p>
  const lo = Math.min(...valid), hi = Math.max(...valid)
  const segments: string[][] = [[]]
  channel.values.forEach((value, index) => {
    if (value === null) {
      if (segments.at(-1)!.length) segments.push([])
      return
    }
    const x = 8 + (index / (rate * 5)) * 594
    const y = hi === lo ? 41 : 72 - (value - lo) / (hi - lo) * 62
    segments.at(-1)!.push([x, y].join(','))
  })
  return <figure className="observation-plot">
    <svg viewBox="0 0 610 84" preserveAspectRatio="none" role="img" aria-label={label + ' waveform'}>
      <line className="pressure-axis" x1="8" x2="602" y1="76" y2="76" />
      {segments.filter(points => points.length).map((points, index) => points.length > 1
        ? <polyline key={index} points={points.join(' ')} className="vital-sparkline" fill="none" stroke="currentColor" strokeWidth="1.5" />
        : <ellipse key={index} cx={points[0].split(',')[0]} cy={points[0].split(',')[1]} rx="2" ry="2" className="pressure-point" />)}
    </svg>
    <figcaption>{label} · {printable(lo)} to {printable(hi)} {channel.unit} · {valid.length}/{channel.values.length} samples</figcaption>
  </figure>
}

export function WaveformResearch() {
  const [start, setStart] = useState(0)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ start: number; record?: WaveformWindow; error?: string }>()
  const active = state?.start === start ? state : undefined

  useEffect(() => {
    const controller = new AbortController()
    void api.waveforms(start, controller.signal).then(record => {
      if (!controller.signal.aborted) setState({ start, record })
    }, error => {
      if (!controller.signal.aborted) setState({ start, error: String(error.message ?? error) })
    })
    return () => controller.abort()
  }, [start, revision])

  return <section className="surface form-panel observation-stack">
    <h2>BIDMC 01 waveforms</h2>
    <p>Five-second views of the archived ECG, PPG and impedance respiration from the same hospital record.</p>
    <div className="form-actions">
      <button className="button secondary" disabled={start === 0} onClick={() => setStart(Math.max(0, start - 5))}>Previous 5 seconds</button>
      <button className="button secondary" disabled={start === 475} onClick={() => setStart(Math.min(475, start + 5))}>Next 5 seconds</button>
      <form className="form-actions" onSubmit={event => {
        event.preventDefault()
        setStart(Number(new FormData(event.currentTarget).get('start')))
      }}>
        <label>Start second <input key={start} name="start" type="number" min="0" max="475" step="1" defaultValue={start} required /></label>
        <button className="button secondary">Go to time</button>
      </form>
    </div>
    <p role="status">{active?.error || (active?.record ? start + '–' + (start + 5) + ' s · ' + active.record.sample_rate_hz + ' Hz' : 'Loading waveform window…')}</p>
    {active?.error && <button className="button secondary" onClick={() => { setState(undefined); setRevision(revision + 1) }}>Retry waveform</button>}
    {active?.record && <>
      {active.record.channels.map(channel => <SignalChart key={channel.code} channel={channel} rate={active.record!.sample_rate_hz} />)}
      <div className="form-actions"><a className="text-link" href={active.record.download}>Source CSV</a>
        <a className="text-link" href={active.record.header}>Signal header and units</a>
        <a className="text-link" href={active.record.source}>PhysioNet record</a></div>
    </>}
  </section>
}

export function AssayResearch() {
  const [study, setStudy] = useState<AssayCoverage['study']>('OSD-575')
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ study: AssayCoverage['study']; record?: AssayCoverage; error?: string }>()
  const [filter, setFilter] = useState('')
  const active = state?.study === study ? state : undefined

  useEffect(() => {
    const controller = new AbortController()
    void api.assayCoverage(study, controller.signal).then(record => {
      if (!controller.signal.aborted) setState({ study, record })
    }, error => {
      if (!controller.signal.aborted) setState({ study, error: String(error.message ?? error) })
    })
    return () => controller.abort()
  }, [study, revision])

  const record = active?.record
  const visible = record?.fields.filter(item => item.name.toLowerCase().includes(filter.trim().toLowerCase())) ?? []
  return <section className="surface form-panel observation-stack">
    <h2>Inspiration4 laboratory archives</h2>
    <div className="measurement-fields">
      <label>Study<select value={study} onChange={event => { setStudy(event.target.value as AssayCoverage['study']); setFilter('') }}>
        <option value="OSD-575">OSD-575 · Serum metabolic panel</option>
        <option value="OSD-656">OSD-656 · Urine immunoassay</option>
      </select></label>
      <label>Find an assay<input type="search" value={filter} onChange={event => setFilter(event.target.value)} /></label>
    </div>
    <p role="status">{active?.error || (record ? record.rows + ' file rows · ' + visible.length + ' named measurement fields' : 'Loading NASA assay coverage…')}</p>
    {active?.error && <button className="button secondary" onClick={() => { setState(undefined); setRevision(revision + 1) }}>Retry assay coverage</button>}
    {record && <>
      <div className="research-table" tabIndex={0} role="region" aria-label={record.specimen + ' assay coverage'}><table>
        <thead><tr><th scope="col">Assay</th><th scope="col">Published unit</th><th scope="col">Numeric rows</th>
          <th scope="col">Other or empty rows</th></tr></thead>
        <tbody>{visible.map(item => <tr key={item.name + ':' + item.unit}>
          <th scope="row">{item.name}</th><td>{item.unit}</td><td>{item.numeric_rows}</td><td>{item.other_rows}</td>
        </tr>)}</tbody>
      </table></div>
      <p>Coverage is calculated over source file rows. Measurements use the units published by each study.</p>
      <div className="form-actions"><a className="text-link" href={record.source}>NASA study</a>
        <a className="text-link" href={record.download}>Source CSV</a></div>
    </>}
  </section>
}
