import { useEffect, useRef, useState } from 'react'
import { api, type Measurement } from './api'
import { formatDate, measurementLabels } from './content'

const pageSize = 40

function dateBoundary(date: string, nextDay = false) {
  const value = new Date(`${date}T00:00:00`)
  if (nextDay) value.setDate(value.getDate() + 1)
  return value.toISOString()
}

function Trend({ readings, kind }: { readings: Measurement[]; kind: string }) {
  const [focused, setFocused] = useState<string | null>(null)
  const points = readings.filter(reading => reading.kind === kind)
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
  if (!points.length) return <p className="empty-state">No {measurementLabels[kind].toLowerCase()} readings yet. Record your first measurement to start this chart.</p>
  const values = points.flatMap(point => point.diastolic === null ? [point.value] : [point.value, point.diastolic])
  const min = Math.min(...values), max = Math.max(...values)
  const padding = Math.max((max - min) * .15, 1)
  const low = min - padding, high = max + padding
  const first = Date.parse(points[0].recorded_at), last = Date.parse(points[points.length - 1].recorded_at)
  const x = (point: Measurement) => last === first ? 360 : 58 + (Date.parse(point.recorded_at) - first) / (last - first) * 604
  const y = (value: number) => 170 - (value - low) / (high - low) * 145
  const series = kind === 'blood_pressure' ? ['Systolic', 'Diastolic'] : [measurementLabels[kind]]
  const active = points.find(point => point.id === focused) ?? points.at(-1)!
  return <>
    <div className="trend-legend">{series.map((label, index) => <span key={label} className={index ? 'secondary-series' : ''}>{label}</span>)}<span>{points[0].unit}</span></div>
    <svg className="measurement-chart" viewBox="0 0 720 218" role="img" aria-label={`${measurementLabels[kind]} over time. ${points.length} readings. Exact values are listed in the history below.`}>
      {[low, low + (high - low) / 4, (low + high) / 2, high - (high - low) / 4, high].map(value => <g key={value}>
        <line x1="58" x2="662" y1={y(value)} y2={y(value)} className="chart-grid" />
        <text x="48" y={y(value) + 4} textAnchor="end">{value.toFixed(1)}</text>
      </g>)}
      {[58, 209, 360, 511, 662].map(value => <line key={value} x1={value} x2={value} y1="25" y2="170" className="chart-grid chart-grid-vertical" />)}
      {points.length > 1 && <polygon className="chart-area" points={` ${x(points[0])},170 ${points.map(point => `${x(point)},${y(point.value)}`).join(' ')} ${x(points.at(-1)!)},170`} />}
      <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1="25" y2="170" />
      {series.map((label, index) => <g key={label} className={index ? 'chart-series secondary-series' : 'chart-series'}>
        <polyline fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={index ? '6 4' : undefined}
          points={points.map(point => `${x(point)},${y(index ? point.diastolic! : point.value)}`).join(' ')} />
        {points.map(point => <g key={point.id}>
          <circle className="chart-point" cx={x(point)} cy={y(index ? point.diastolic! : point.value)} r={active.id === point.id ? 5 : 3} />
          <circle className="chart-hit" cx={x(point)} cy={y(index ? point.diastolic! : point.value)} r="12" tabIndex={0}
            onPointerEnter={() => setFocused(point.id)} onPointerLeave={() => setFocused(null)} onFocus={() => setFocused(point.id)} onBlur={() => setFocused(null)}
            aria-label={`${label}: ${index ? point.diastolic : point.value} ${point.unit}, ${formatDate(point.recorded_at)}`}>
            <title>{label}: {index ? point.diastolic : point.value} {point.unit}, {formatDate(point.recorded_at)}</title>
          </circle>
        </g>)}
      </g>)}
      <text x="58" y="204">{formatDate(points[0].recorded_at)}</text>
      {last !== first && <text x="662" y="204" textAnchor="end">{formatDate(points[points.length - 1].recorded_at)}</text>}
    </svg>
    <div className="chart-readout"><span>{formatDate(active.recorded_at)}</span><strong>{active.value}{active.diastolic !== null && `/${active.diastolic}`} <small>{active.unit}</small></strong></div>
  </>
}

export function MeasurementTrends({ readings, fixedKind }: {
  readings: Measurement[]; fixedKind?: string
}) {
  const [selected, setSelected] = useState('')
  const counts = Object.keys(measurementLabels).map(kind => ({ kind, count: readings.filter(reading => reading.kind === kind).length }))
  const best = [...counts].sort((a, b) => b.count - a.count)[0].kind
  const kind = fixedKind || selected || best
  const points = readings.filter(reading => reading.kind === kind).sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
  const latest = points.at(-1)
  const difference = points.length > 1 ? latest!.value - points[0].value : null
  return <>
    {!fixedKind && <div className="indicator-tabs" role="group" aria-label="Chart indicator">
      {counts.map(item => <button key={item.kind} aria-pressed={kind === item.kind} onClick={() => setSelected(item.kind)}>
        {measurementLabels[item.kind]} <span>{item.count}</span>
      </button>)}
    </div>}
    <div className="trend-heading"><h3>{measurementLabels[kind]} trend</h3><span className="muted">{points.length} readings</span></div>
    {latest && <dl className="trend-stats">
      <div><dt>Latest reading</dt><dd>{latest.value}{latest.diastolic !== null && `/${latest.diastolic}`} <small>{latest.unit}</small></dd></div>
      <div><dt>{kind === 'blood_pressure' ? 'Systolic range' : 'Recorded range'}</dt><dd>{Math.min(...points.map(point => point.value))}–{Math.max(...points.map(point => point.value))} <small>{latest.unit}</small></dd></div>
      <div><dt>{kind === 'blood_pressure' ? 'Systolic change' : 'First to latest'}</dt><dd>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${Number(difference.toFixed(2))}`} <small>{difference === null ? 'One reading' : kind === 'spo2' ? 'percentage points' : latest.unit}</small></dd></div>
    </dl>}
    <Trend readings={readings} kind={kind} />
  </>
}

export function MeasurementHistory({ crewId, cached, reachable, revision, onReconnect, initialKind = '' }: {
  crewId?: string; cached: Measurement[]; reachable: boolean; revision?: string
  onReconnect: () => Promise<void>
  initialKind?: string
}) {
  const [kind, setKind] = useState(initialKind)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [retry, setRetry] = useState(0)
  const [snapshot, setSnapshot] = useState(() => new Date().toISOString())
  const [page, setPage] = useState(0)
  const [records, setRecords] = useState<Measurement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const requestId = useRef(0)
  const invalid = Boolean(since && until && since > until)
  const queryKey = JSON.stringify([crewId, kind, since, until, revision, retry, reachable])
  const [loadedKey, setLoadedKey] = useState('')

  useEffect(() => {
    setPage(0)
    setSnapshot(new Date().toISOString())
  }, [queryKey])

  useEffect(() => {
    const id = ++requestId.current
    if (!crewId || !reachable || invalid) { setLoading(false); return }
    // A changed filter always starts with the first page, before the reset effect renders.
    const offset = loadedKey === queryKey ? page * pageSize : 0
    setLoading(true)
    setError('')
    const from = since ? dateBoundary(since) : undefined
    const through = until && dateBoundary(until, true) < snapshot ? dateBoundary(until, true) : snapshot
    const request = from && from >= through ? Promise.resolve<Measurement[]>([]) : api.measurements(crewId, {
      kind, since: from, until: through,
      limit: pageSize, offset,
    })
    void request.then(items => {
      if (id !== requestId.current) return
      setRecords(previous => offset ? [...new Map([...previous, ...items].map(item => [item.id, item])).values()] : items)
      setLoadedKey(queryKey)
      setHasMore(items.length === pageSize)
    }).catch(reason => {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : 'Could not load readings.')
    }).finally(() => { if (id === requestId.current) setLoading(false) })
    return () => { requestId.current++ }
    // loadedKey records which filters the displayed data belongs to; it is not a request trigger.
  }, [crewId, reachable, invalid, kind, since, until, snapshot, page, queryKey])

  const usingCache = !reachable
  const visible = usingCache ? cached.filter(reading => (!kind || reading.kind === kind)
    && (!since || Date.parse(reading.recorded_at) >= Date.parse(dateBoundary(since)))
    && (!until || Date.parse(reading.recorded_at) < Date.parse(dateBoundary(until, true))))
    : loadedKey === queryKey ? records : []

  return <section className="measurement-history" aria-labelledby="history-heading">
    <h2 id="history-heading">Measurement history</h2>
    <div className="surface history-panel">
      <div className="measurement-fields history-filters">
        <label>Indicator<select value={kind} onChange={event => setKind(event.target.value)}>
          <option value="">All indicators</option>
          {Object.entries(measurementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>From<input type="date" value={since} onChange={event => setSince(event.target.value)} /></label>
        <label>Through<input type="date" value={until} min={since || undefined} onChange={event => setUntil(event.target.value)} /></label>
      </div>
      {invalid && <p className="notice error" role="alert">The end date must be on or after the start date.</p>}
      {usingCache && <p className="notice" role="status">Connection unavailable. Showing only recent readings cached on this device. <button className="text-link" onClick={() => void onReconnect()}>Retry connection</button></p>}
      {error && <p className="notice error" role="alert">Could not load measurement history. {error} <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
      {!invalid && <>
        {loading && !visible.length ? <p className="empty-state">Loading trend…</p> : <MeasurementTrends readings={visible} fixedKind={kind} />}
        <div aria-busy={loading}>
          {visible.length ? <div className="measurement-table-wrap"><table className="measurement-table">
            <caption>Recorded measurements · newest first</caption>
            <thead><tr><th scope="col">Indicator</th><th scope="col">Reading</th><th scope="col">Recorded at</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{visible.map(reading => <tr key={reading.id}>
              <th scope="row">{measurementLabels[reading.kind]}</th>
              <td className="table-reading">{reading.value}{reading.diastolic !== null && `/${reading.diastolic}`} <small>{reading.unit}</small></td>
              <td><time dateTime={reading.recorded_at}>{formatDate(reading.recorded_at)}</time></td>
              <td><a className="text-link" href={`/assessment?measurement=${reading.id}`} aria-label={`Assess ${measurementLabels[reading.kind]} from ${formatDate(reading.recorded_at)}`}>Assess</a></td>
            </tr>)}</tbody>
          </table></div> : <p className="empty-state">{loading ? 'Loading readings…' : error ? 'Readings are unavailable.' : !crewId ? 'Choose a crew member to view readings.' : 'No readings match these filters.'}</p>}
        </div>
        <div className="history-actions" role="status">
          {visible.length > 0 && <span className="muted">{visible.length} {visible.length === 1 ? 'reading' : 'readings'}</span>}
          {!usingCache && hasMore && loadedKey === queryKey && !error && <button className="button secondary" disabled={loading} onClick={() => setPage(value => value + 1)}>{loading ? 'Loading…' : 'Load older readings'}</button>}
        </div>
      </>}
    </div>
  </section>
}
