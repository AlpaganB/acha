import { lazy, Suspense, useEffect, useState } from 'react'
import { api, type IssResearchRecord, type ResearchRecord } from './api'
import { RadiationResearch } from './RadiationResearch'
import { WellbeingResearch } from './WellbeingResearch'
import { AssayResearch, WaveformResearch } from './MeasurementResearch'
import { Evidence } from './Evidence'
import { archiveError, rr6Source, rr6SourceExport } from './nasaArchive'

const SleepResearch = lazy(() => import('./SleepResearch').then(module => ({ default: module.SleepResearch })))

const utc = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
const issMetrics = [
  { key: 'temperature_c', label: 'Temperature', unit: '°C' },
  { key: 'relative_humidity_pct', label: 'Relative humidity', unit: '%' },
  { key: 'carbon_dioxide_ppm', label: 'Ambient CO₂', unit: 'ppm' },
] as const

function IssCarbonDioxidePlot({ samples }: { samples: IssResearchRecord['samples'] }) {
  const values = samples.flatMap(sample => sample.carbon_dioxide_ppm ?? [])
  if (!values.length) return null
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const first = Date.parse(samples[0].recorded_at)
  const last = Date.parse(samples.at(-1)!.recorded_at)
  const x = (stamp: string) => 8 + (Date.parse(stamp) - first) / Math.max(1, last - first) * 704
  const y = (value: number) => 96 - (value - minimum) / (maximum - minimum || 1) * 85
  return <figure className="monitoring-figure">
    <svg viewBox="0 0 720 110" role="img" aria-label={`Archived RR-6 cabin carbon dioxide, ${minimum} to ${maximum} parts per million`} preserveAspectRatio="none">
      <line className="pressure-axis" x1="8" x2="712" y1="101" y2="101" />
      {samples.map((sample, index) => {
        const value = sample.carbon_dioxide_ppm
        const previous = samples[index - 1]
        if (value === null) return null
        return <g key={sample.recorded_at}>
          {previous?.carbon_dioxide_ppm != null && Date.parse(sample.recorded_at) - Date.parse(previous.recorded_at) === 300_000 &&
            <line className="pressure-trace" x1={x(previous.recorded_at)} x2={x(sample.recorded_at)} y1={y(previous.carbon_dioxide_ppm)} y2={y(value)} />}
          <circle className="pressure-point" cx={x(sample.recorded_at)} cy={y(value)} r="1.7"><title>{utc.format(new Date(sample.recorded_at))} UTC · {value} ppm</title></circle>
        </g>
      })}
    </svg>
    <figcaption>Cabin CO₂ (ppm). Lines connect samples exactly five minutes apart with values at both times.</figcaption>
  </figure>
}

function IssResearch() {
  const [record, setRecord] = useState<IssResearchRecord>()
  const [window, setWindow] = useState<'day' | 'week'>('week')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const perPage = 25

  async function fetchRecord() {
    setLoading(true)
    setError('')
    try {
      setRecord(await api.issResearchRecord(window))
      setPage(0)
    } catch (reason) {
      setError(archiveError(reason, 'RR-6'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="surface form-panel research-section" aria-labelledby="iss-research" aria-busy={loading}>
      <div className="section-heading monitoring-heading"><h2 id="iss-research">ISS cabin environment</h2>
        <label>Archive window <select value={window} disabled={loading} onChange={event => {
          setWindow(event.target.value as 'day' | 'week'); setRecord(undefined); setError(''); setPage(0)
        }}><option value="week">15–22 December 2017 (UTC)</option><option value="day">15–16 December 2017 (UTC)</option></select></label></div>
      <p>NASA OSDR · Rodent Research 6 · historical ISS cabin environment collected in support of rodent research.</p>
      <div className="form-actions">
        <button className="button secondary" disabled={loading} onClick={() => void fetchRecord()}>
          {record ? 'Refresh from NASA' : 'Fetch from NASA'}
        </button>
        <a className="text-link" href={record?.source ?? rr6Source}>NASA dataset · RR-6</a>
        <a className="text-link" href={record?.download ?? rr6SourceExport(window)}>Original NASA JSON</a>
      </div>
      <p className="form-feedback" role="status">{error ? `${error} Open the original NASA JSON for this window. ${record ? 'Showing the last successful historical result.' : 'No archive readings are displayed.'}` : (loading ? 'Fetching NASA telemetry…'
        : record ? `${record.samples.length} timestamps · NASA environmental research` : '')}</p>
      {record && <>
        {record.samples.length > 0 && <p className="muted">First sample {utc.format(new Date(record.samples[0].recorded_at))} UTC · Last sample {utc.format(new Date(record.samples[record.samples.length - 1].recorded_at))} UTC.</p>}
        <dl className="detail-list">{issMetrics.map(metric => {
          const values = record.samples.flatMap(sample => sample[metric.key] ?? [])
          const intervals = record.samples.slice(1).filter((sample, index) => {
            const earlier = record.samples[index]
            return sample[metric.key] !== null && earlier[metric.key] !== null
              && Date.parse(sample.recorded_at) - Date.parse(earlier.recorded_at) === 300_000
          }).length
          return <div key={metric.key}><dt>{metric.label}</dt><dd>{values.length
            ? `${Math.min(...values)}–${Math.max(...values)} ${metric.unit} · ${values.length} of ${record.samples.length} values · ${intervals} five-minute intervals with both readings`
            : 'No observations'}</dd></div>
        })}</dl>
        <p className="muted">Coverage counts measured pairs only. The export does not report calibration or measurement uncertainty. These observations describe the habitat.</p>
        <IssCarbonDioxidePlot samples={record.samples} />
        <details className="research-observations">
          <summary>Browse {record.samples.length} observations</summary>
          <div className="research-table" tabIndex={0} role="region" aria-label="ISS cabin observations"><table>
            <thead><tr><th scope="col">Recorded (UTC)</th>{issMetrics.map(metric =>
              <th key={metric.key} scope="col">{metric.label} ({metric.unit})</th>)}</tr></thead>
            <tbody>{record.samples.slice(page * perPage, (page + 1) * perPage).map(sample => <tr key={sample.recorded_at}>
              <th scope="row"><time dateTime={sample.recorded_at}>{utc.format(new Date(sample.recorded_at))}</time></th>
              {issMetrics.map(metric => <td key={metric.key}>{sample[metric.key] ?? '—'}</td>)}
            </tr>)}</tbody>
          </table></div>
          <div className="form-actions">
            <button className="button secondary" disabled={!page} onClick={() => setPage(value => value - 1)}>Previous page</button>
            <span role="status">Page {page + 1} of {Math.ceil(record.samples.length / perPage)}</span>
            <button className="button secondary" disabled={(page + 1) * perPage >= record.samples.length}
              onClick={() => setPage(value => value + 1)}>Next page</button>
          </div>
        </details>
      </>}
    </section>
  )
}

function OtherRecords() {
  const [record, setRecord] = useState<ResearchRecord>()
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    let active = true
    void api.researchRecord().then(data => { if (active) setRecord(data) })
      .catch(() => { if (active) setError('Research data is currently unavailable.') })
    return () => { active = false }
  }, [])

  async function refresh() {
    setRefreshing(true)
    setError('')
    try {
      setRecord(await api.researchRecord(true))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not fetch the source record.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <section className="surface form-panel" aria-label="PhysioNet BIDMC" aria-busy={!record && !error}>
        {!record ? <p role="status">{error || 'Loading research record…'}</p> : <>
          <h2>{record.record}</h2>
          <p>Published hospital observations from PhysioNet.</p>
          <p>{record.samples.length} observations · Median heart rate {record.medians.heart_rate} bpm · Median blood oxygen saturation {record.medians.spo2}%</p>
          <div className="research-table"><table>
            <caption>First 12 observations</caption>
            <thead><tr><th scope="col">Elapsed time (s)</th><th scope="col">Heart rate</th><th scope="col">Pulse rate</th><th scope="col">Respiratory rate</th><th scope="col">SpO₂</th></tr></thead>
            <tbody>{record.samples.slice(0, 12).map(sample => <tr key={sample.seconds}>
              <td>{sample.seconds}</td><td>{sample.heart_rate ?? '—'}</td><td>{sample.pulse_rate ?? '—'}</td>
              <td>{sample.respiratory_rate ?? '—'}</td><td>{sample.spo2 ?? '—'}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="form-actions">
            <a className="text-link" href={record.source}>Published dataset</a>
            <button className="button secondary" disabled={refreshing} onClick={() => void refresh()}>Fetch from PhysioNet</button>
          </div>
          <p className="form-feedback" role="status">{error || (record.retrieval === 'physionet'
            ? 'Downloaded from PhysioNet.' : 'Showing the bundled copy of the published record.')}</p>
        </>}
      </section>
      <IssResearch />
    </>
  )
}

export function Research({ view }: { view: string }) {
  return <>
    <header className="page-title"><h1>Research data</h1></header>
    <nav className="monitoring-tabs" aria-label="Research datasets">
      <a className="button secondary" aria-current={!['sleep', 'radiation', 'wellbeing', 'waveforms', 'laboratory', 'evidence'].includes(view) ? 'page' : undefined}
        href="/research">Vitals and cabin</a>
      <a className="button secondary" aria-current={view === 'sleep' ? 'page' : undefined} href="/research?view=sleep">Sleep</a>
      <a className="button secondary" aria-current={view === 'radiation' ? 'page' : undefined} href="/research?view=radiation">Radiation</a>
      <a className="button secondary" aria-current={view === 'wellbeing' ? 'page' : undefined} href="/research?view=wellbeing">Well-being</a>
      <a className="button secondary" aria-current={view === 'waveforms' ? 'page' : undefined} href="/research?view=waveforms">Waveforms</a>
      <a className="button secondary" aria-current={view === 'laboratory' ? 'page' : undefined} href="/research?view=laboratory">Laboratory</a>
      <a className="button secondary" aria-current={view === 'evidence' ? 'page' : undefined} href="/research?view=evidence">NASA evidence</a>
    </nav>
    {view === 'sleep' ? <Suspense fallback={<p className="notice" role="status">Loading scored sleep research…</p>}>
      <SleepResearch /></Suspense> : view === 'radiation' ? <RadiationResearch /> : view === 'wellbeing' ? <WellbeingResearch />
        : view === 'waveforms' ? <WaveformResearch /> : view === 'laboratory' ? <AssayResearch /> : view === 'evidence' ? <Evidence /> : <OtherRecords />}
  </>
}
