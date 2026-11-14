import { useEffect, useState } from 'react'
import { api, type DoseResearchRecord, type IssResearchRecord, type ResearchRecord } from './api'

const utc = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
const issMetrics = [
  { key: 'temperature_c', label: 'Temperature', unit: '°C' },
  { key: 'relative_humidity_pct', label: 'Relative humidity', unit: '%' },
  { key: 'carbon_dioxide_ppm', label: 'Ambient CO₂', unit: 'ppm' },
] as const

function IssResearch() {
  const [record, setRecord] = useState<IssResearchRecord>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchRecord() {
    setLoading(true)
    setError('')
    try {
      setRecord(await api.issResearchRecord())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The NASA record could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="surface form-panel research-section" aria-labelledby="iss-research" aria-busy={loading}>
      <h2 id="iss-research">ISS cabin environment</h2>
      <p>NASA OSDR · Rodent Research 6 · historical cabin telemetry from 15–16 December 2017 (UTC).</p>
      <div className="form-actions">
        <button className="button secondary" disabled={loading} onClick={() => void fetchRecord()}>
          {record ? 'Refresh from NASA' : 'Fetch from NASA'}
        </button>
        <a className="text-link" href={record?.source ?? 'https://osdr.nasa.gov/bio/repo/data/payloads/RR-6'}>NASA dataset</a>
        {record && <a className="text-link" href={record.download}>Source JSON</a>}
      </div>
      <p className="form-feedback" role="status">{error || (loading ? 'Fetching NASA telemetry…'
        : record ? `${record.samples.length} timestamps · NASA environmental research` : '')}</p>
      {record && <>
        <dl className="detail-list">{issMetrics.map(metric => {
          const values = record.samples.flatMap(sample => sample[metric.key] ?? [])
          return <div key={metric.key}><dt>{metric.label}</dt><dd>{values.length
            ? `${Math.min(...values)}–${Math.max(...values)} ${metric.unit} · ${values.length} available`
            : 'No observations'}</dd></div>
        })}</dl>
        <details className="research-observations">
          <summary>First 12 observations</summary>
          <div className="research-table" tabIndex={0} role="region" aria-label="ISS cabin observations"><table>
            <thead><tr><th scope="col">Recorded (UTC)</th>{issMetrics.map(metric =>
              <th key={metric.key} scope="col">{metric.label} ({metric.unit})</th>)}</tr></thead>
            <tbody>{record.samples.slice(0, 12).map(sample => <tr key={sample.recorded_at}>
              <th scope="row"><time dateTime={sample.recorded_at}>{utc.format(new Date(sample.recorded_at))}</time></th>
              {issMetrics.map(metric => <td key={metric.key}>{sample[metric.key] ?? '—'}</td>)}
            </tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </section>
  )
}

function RadiationResearch() {
  const [record, setRecord] = useState<DoseResearchRecord>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchRecord() {
    setLoading(true)
    setError('')
    try {
      setRecord(await api.doseResearchRecord())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'RadLab could not be reached.')
    } finally {
      setLoading(false)
    }
  }

  return <section className="surface form-panel research-section" aria-labelledby="radiation-research" aria-busy={loading}>
    <h2 id="radiation-research">ISS radiation measurements</h2>
    <p>NASA OSDR RadLab · DORELI DosTel1 instrument in the Columbus module · 1–2 April 2022.</p>
    <div className="form-actions">
      <button className="button secondary" disabled={loading} onClick={() => void fetchRecord()}>
        {record ? 'Refresh from RadLab' : 'Fetch from RadLab'}
      </button>
      <a className="text-link" href={record?.source ?? 'https://visualization.osdr.nasa.gov/radlab/gui/knowledgebase/dostel1'}>Instrument metadata</a>
      {record && <a className="text-link" href={record.download}>Source CSV</a>}
    </div>
    <p className="form-feedback" role="status">{error || (loading ? 'Fetching RadLab observations…' : record
      ? `${record.samples.length} instrument timestamps · Dose equivalent rate available at ${record.samples.filter(sample =>
        sample.dose_equivalent_rate !== null).length} timestamps.` : '')}</p>
    {record && <details className="research-observations">
      <summary>First 12 observations</summary>
      <div className="research-table" tabIndex={0} role="region" aria-label="Radiation observations"><table>
        <caption>Source timestamps as published. The CSV supplies no timezone offset.</caption>
        <thead><tr><th scope="col">Source timestamp</th><th scope="col">Absorbed dose rate (µGy/h)</th>
          <th scope="col">Dose equivalent rate (µSv/h)</th></tr></thead>
        <tbody>{record.samples.slice(0, 12).map(sample => <tr key={sample.timestamp}>
          <th scope="row"><time dateTime={sample.timestamp}>{sample.timestamp.replace('T', ' ')}</time></th>
          <td>{sample.absorbed_dose_rate?.toFixed(3) ?? '—'}</td><td>{sample.dose_equivalent_rate?.toFixed(3) ?? '—'}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="muted">These readings describe a fixed instrument. A personal dose requires individual dosimetry.</p>
    </details>}
  </section>
}

export function Research() {
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
      <header className="page-title"><h1>Research data</h1></header>
      <section className="surface form-panel" aria-label="PhysioNet BIDMC" aria-busy={!record && !error}>
        {!record ? <p role="status">{error || 'Loading research record…'}</p> : <>
          <h2>{record.record}</h2>
          <p>Published hospital observations from PhysioNet.</p>
          <p>{record.samples.length} observations · Median heart rate {record.medians.heart_rate} bpm · Median blood oxygen {record.medians.spo2}%</p>
          <div className="research-table"><table>
            <caption>First 12 observations</caption>
            <thead><tr><th scope="col">Second</th><th scope="col">Heart rate</th><th scope="col">Pulse</th><th scope="col">Breathing</th><th scope="col">SpO₂</th></tr></thead>
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
      <RadiationResearch />
    </>
  )
}
