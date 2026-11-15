import { useEffect, useState } from 'react'
import { api, type DoseResearchRecord } from './api'
import { nasaCrewStandard, nasaRadiationSource } from './HealthMonitoring'
import { radiationTime, reviewRadiation } from './monitoringAnalysis'
import { archiveError, dosTelSource, dosTelSourceExport } from './nasaArchive'

const artemisSource = 'https://doi.org/10.1038/s41586-024-07927-7'
const cnsSource = 'https://ntrs.nasa.gov/citations/20150016007'
const doseFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 3 })
const stampLabel = (stamp: string) => stamp.replace('T', ' ')

export function RadiationResearch() {
  const [window, setWindow] = useState<'sample' | 'day'>('day')
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState(0)
  const [boundary, setBoundary] = useState('')
  const [selection, setSelection] = useState<{ window: 'sample' | 'day'; attempt: number; record?: DoseResearchRecord; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    void api.doseResearchRecord(window, controller.signal).then(record => {
      if (!controller.signal.aborted) setSelection({ window, attempt, record })
    }, reason => {
      if (!controller.signal.aborted) setSelection({ window, attempt, error: archiveError(reason, 'DosTel1') })
    })
    return () => controller.abort()
  }, [window, attempt])
  const current = selection?.window === window && selection.attempt === attempt ? selection : undefined
  const record = current?.record
  const limit = boundary.trim() && Number(boundary) > 0 ? Number(boundary) : null
  const review = record && reviewRadiation(record.samples, limit)
  const perPage = 25

  return <>
    <section className="surface form-panel" aria-labelledby="radiation-review">
      <div className="section-heading monitoring-heading"><h2 id="radiation-review">ISS radiation archive</h2>
        <label>Archive window <select value={window} onChange={event => {
          setWindow(event.target.value as 'sample' | 'day'); setPage(0)
        }}>
          <option value="day">1 April 2022 · full day</option><option value="sample">1–2 April 2022 · short sample</option>
        </select></label></div>
      <p>Historical NASA OSDR RadLab data from DosTel1, a fixed instrument in the ISS Columbus module. Source timestamps lack a time zone offset.</p>
      <div className="form-actions"><a className="text-link" href={record?.source ?? dosTelSource}>Instrument metadata · DosTel1</a>
        <a className="text-link" href={record?.download ?? dosTelSourceExport(window)}>Original RadLab CSV</a>
        <button className="button secondary" onClick={() => { setAttempt(value => value + 1); setPage(0) }} disabled={!current}>Reload archive</button></div>
      {!current && <p className="notice" role="status">Loading RadLab instrument data…</p>}
      {current?.error && <p className="notice" role="status">{current.error} Open the original RadLab CSV for this window. No archive readings are displayed.</p>}
      {record && review && <>
        <dl className="monitoring-metrics">
          <div><dt>Usable absorbed dose rate samples</dt><dd>{review.points.length} of {record.samples.length}</dd><small>{review.missing} missing or unusable</small></div>
          <div><dt>Highest recorded absorbed dose rate</dt><dd>{review.max === null ? '—' : `${doseFormat.format(review.max)} µGy/h`}</dd></div>
          <div><dt>Time covered by usable readings</dt><dd>{Math.round(review.coveredSeconds / 60)} min</dd><small>Gaps between usable intervals: {review.gapCount}</small></div>
          <div><dt>Samples with a dose equivalent rate</dt><dd>{record.samples.filter(item => item.dose_equivalent_rate !== null).length}</dd></div>
        </dl>
        {(record.conflicting_timestamps ?? 0) > 0 && <p className="notice" role="status">{record.conflicting_timestamps} conflicting archive timestamps were excluded from rate calculations.</p>}
        <p className="muted">The export does not report measurement uncertainty. It describes the instrument’s location and provides no personal dose data.</p>
        {review.max !== null && <RadiationPlot points={review.points} maximum={review.max} />}
        <details className="research-observations"><summary>Review rate excursions</summary>
          <p>Run a historical check against a review boundary you enter. The check flags two or more consecutive readings above the boundary.</p>
          <div className="measurement-fields"><label>Replay boundary (µGy/h)<input type="number" min="0" step="any" value={boundary}
            onChange={event => setBoundary(event.target.value)} /></label></div>
          <p className="muted">Gaps over five minutes and missing observations end a series. This threshold is for archive exploration. No mission alert threshold is active.</p>
          {limit !== null && <p className="notice" role="status">{review.events.length} sustained excursion(s) over {doseFormat.format(limit)} µGy/h.</p>}
          {review.events.length > 0 && <div className="research-table" role="region" aria-label="Archive excursions" tabIndex={0}><table>
            <thead><tr><th scope="col">Start (source time)</th><th scope="col">End (source time)</th><th scope="col">Samples</th><th scope="col">Peak (µGy/h)</th></tr></thead>
            <tbody>{review.events.map(item => <tr key={item.start}><th scope="row">{stampLabel(item.start)}</th>
              <td>{stampLabel(item.end)}</td><td>{item.samples}</td><td>{doseFormat.format(item.peak)}</td></tr>)}</tbody>
          </table></div>}
        </details>
        <details className="research-observations"><summary>Browse {record.samples.length} instrument observations</summary>
          <div className="research-table" tabIndex={0} role="region" aria-label="Instrument readings"><table>
            <thead><tr><th scope="col">Source time</th><th scope="col">Absorbed dose rate (µGy/h)</th><th scope="col">Dose equivalent rate (µSv/h)</th></tr></thead>
            <tbody>{record.samples.slice(page * perPage, (page + 1) * perPage).map(item => <tr key={item.timestamp}>
              <th scope="row">{stampLabel(item.timestamp)}</th>
              <td>{item.absorbed_dose_rate === null ? '—' : doseFormat.format(item.absorbed_dose_rate)}</td>
              <td>{item.dose_equivalent_rate === null ? '—' : doseFormat.format(item.dose_equivalent_rate)}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="form-actions">
            <button className="button secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous page</button>
            <span role="status">Page {page + 1} of {Math.ceil(record.samples.length / perPage)}</span>
            <button className="button secondary" disabled={(page + 1) * perPage >= record.samples.length}
              onClick={() => setPage(value => value + 1)}>Next page</button>
          </div>
        </details>
      </>}
    </section>
    <section className="surface form-panel observation-stack">
      <h2>Human health context</h2>
      <p>NASA studies acute radiation exposure and long-term risks to crew health. A fixed instrument measures dose rates at its location. Personal exposure requires separate measurements.</p>
      <p>Absorbed dose rate (µGy/h) and dose equivalent rate (µSv/h) describe different quantities. Estimating a crew member’s dose requires calibrated dosimetry and mission-approved methods.</p>
      <div className="form-actions"><a className="text-link" href={nasaRadiationSource}>NASA radiation health research</a>
        <a className="text-link" href={cnsSource}>NASA CNS evidence and uncertainties</a>
        <a className="text-link" href={nasaCrewStandard}>NASA crew health standard</a>
        <a className="text-link" href={artemisSource}>Artemis I measurements and source data</a></div>
    </section>
  </>
}

function RadiationPlot({ points, maximum }: {
  points: { timestamp: string; absorbed_dose_rate: number }[]; maximum: number
}) {
  const first = points[0].timestamp
  const last = points[points.length - 1].timestamp
  const offset = radiationTime(first)
  const span = radiationTime(last) - offset
  const x = (time: string) => span === 0 ? 360 : 8 + (radiationTime(time) - offset) / span * 704
  return <figure className="monitoring-figure">
    <svg viewBox="0 0 720 110" preserveAspectRatio="none" role="img" aria-label="Measured absorbed dose rate points over source time">
      <line x1="8" y1="104" x2="712" y2="104" className="pressure-axis" />
      {points.map(point => <circle key={point.timestamp} r="2.4" className="pressure-point" cx={x(point.timestamp)}
        cy={105 - point.absorbed_dose_rate / (maximum || 1) * 95}><title>{stampLabel(point.timestamp)} · {doseFormat.format(point.absorbed_dose_rate)} µGy/h</title></circle>)}
    </svg>
    <figcaption><div className="pressure-time-axis"><span>{stampLabel(first)}</span><span>{stampLabel(last)}</span></div>
      <p>The source timestamps have no time zone offset. Each point shows a recorded dose rate.</p></figcaption>
  </figure>
}
