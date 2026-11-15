import { useEffect, useState } from 'react'
import { Activity, ArrowRight, Gauge, Moon, Radio } from 'lucide-react'
import { api, type CrewMember, type Measurement, type MissionObservation } from './api'
import { formatDate } from './content'
import { reviewSleepLogs } from './monitoringAnalysis'
import { comparableTo, usableSeries } from './observationAnalysis'

export const nasaSleepSource = 'https://ntrs.nasa.gov/citations/20230003916'
export const nasaRadiationSource = 'https://www.nasa.gov/directorates/esdmd/hhp/space-radiation/'
export const nasaCrewStandard = 'https://standards.nasa.gov/standard/NASA/NASA-STD-3001_VOL_1'
const sleepResearch = '/research?view=sleep'
const radiationResearch = '/research?view=radiation'
const restrictedLog = '/mission/observations?source=restricted'
const dayLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function MonitoringLinks() {
  return <section className="monitoring-section" aria-labelledby="monitoring-shortcuts">
    <div className="section-heading"><h2 id="monitoring-shortcuts">Health monitoring</h2></div>
    <div className="monitoring-grid">
      <a className="surface monitoring-shortcut" href="/mission/monitoring"><Moon size={20} aria-hidden="true" />
        <span><strong>Sleep and crew records</strong><small>Sleep history, personal baseline, and data gaps</small></span><ArrowRight size={16} aria-hidden="true" /></a>
      <a className="surface monitoring-shortcut" href="/mission/pressure"><Gauge size={20} aria-hidden="true" />
        <span><strong>Cabin pressure</strong><small>Training timeline and crew response</small></span><ArrowRight size={16} aria-hidden="true" /></a>
      <a className="surface monitoring-shortcut" href={radiationResearch}><Radio size={20} aria-hidden="true" />
        <span><strong>Space radiation</strong><small>NASA instrument archive and review flags</small></span><ArrowRight size={16} aria-hidden="true" /></a>
    </div>
  </section>
}

type SleepReadings = Pick<Measurement, 'kind' | 'recorded_at' | 'value'>[]
const readingHours = (hours: number) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(hours)} h`

function SleepHistory({ records, days }: { records: SleepReadings; days: number }) {
  const report = reviewSleepLogs(records, days)
  const missing = days - report.usable.length - report.ambiguousDays.length
  return <>
    <dl className="monitoring-metrics">
      <div><dt>Latest daily report</dt><dd>{report.latest ? readingHours(report.latest.hours) : 'No report'}</dd>
        {report.latest && <small>{dayLabel.format(new Date(report.latest.day))} UTC</small>}</div>
      <div><dt>Personal median</dt><dd>{report.reference === null ? 'Pending' : readingHours(report.reference)}</dd>
        <small>{report.baselineCount} non-overlapping earlier reports · minimum 5</small></div>
      <div><dt>Coverage</dt><dd>{report.usable.length} of {days} days</dd>
        <small>{missing} missing · {report.ambiguousDays.length} conflicting</small></div>
    </dl>
    {report.difference !== null && <p className="muted">Latest report {report.difference === 0 ? 'matches the personal median.'
      : `is ${readingHours(Math.abs(report.difference))} ${report.difference < 0 ? 'below' : 'above'} the personal median.`}</p>}
    {report.ambiguousDays.length > 0 && <p className="notice" role="status">Review days with conflicting duration entries before using the trend.</p>}
    {report.usable.length > 0 && <figure className="monitoring-figure">
      <svg viewBox={`0 0 ${days * 20} 110`} preserveAspectRatio="none" role="img" aria-label="Self-reported sleep hours on a 0 to 24 hour scale">
        <line x1="0" x2={days * 20} y1="100" y2="100" className="pressure-axis" />
        {report.daily.map((item, index) => item.hours === null ? null : <rect key={item.day} x={index * 20 + 4}
          width="12" y={100 - (item.hours / 24) * 96} height={Math.max(2, (item.hours / 24) * 96)}
          className="pressure-point"><title>{dayLabel.format(new Date(item.day))} UTC · {readingHours(item.hours)}</title></rect>)}
      </svg>
      <figcaption>Daily reports in UTC. Blank days have no usable value.</figcaption>
    </figure>}
    <div className="research-table" tabIndex={0} role="region" aria-label="Daily sleep history"><table>
      <thead><tr><th scope="col">Report date (UTC)</th><th scope="col">Previous 24 h</th><th scope="col">Status</th></tr></thead>
      <tbody>{[...report.daily].reverse().map(item => <tr key={item.day}>
        <th scope="row"><time dateTime={item.day}>{dayLabel.format(new Date(item.day))}</time></th>
        <td>{item.hours === null ? '—' : readingHours(item.hours)}</td>
        <td>{item.conflicting ? 'Conflicting reports' : item.hours === null ? 'Missing' : 'Self-reported'}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="muted">Duration alone does not describe sleep quality. A personal median is a descriptive reference.</p>
  </>
}

export function HealthMonitoring({ crew, reachable }: { crew?: CrewMember; reachable: boolean }) {
  const [days, setDays] = useState(14)
  const [state, setState] = useState<{ crewId: string; days: number; records?: Measurement[]; error?: string }>()
  const crewId = crew?.id
  useEffect(() => {
    if (!crewId || !reachable) return
    let active = true
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - days + 1)
    void api.measurements(crewId, { kind: 'sleep_duration', since: start.toISOString(), limit: 200 }).then(records => {
      if (active) setState({ crewId, days, records })
    }, () => { if (active) setState({ crewId, days, error: 'The mission API could not load the sleep history.' }) })
    return () => { active = false }
  }, [crewId, days, reachable])
  const current = state?.crewId === crewId && state?.days === days ? state : undefined

  return <>
    <header className="page-title"><h1>Health monitoring</h1><p>{crew?.display_name ?? 'Crew workspace'}</p></header>
    <section className="surface form-panel" aria-labelledby="crew-sleep-trend">
      <div className="section-heading monitoring-heading"><h2 id="crew-sleep-trend"><Moon size={18} /> Sleep log</h2>
        <label>Time range <select value={days} onChange={event => setDays(Number(event.target.value))}>
          {[7, 14, 30].map(value => <option key={value} value={value}>{value} days</option>)}
        </select></label></div>
      <p className="muted">Use sample data here. Record sensitive crew observations in the restricted mission log.</p>
      <div className="form-actions">
        <a className="text-link" href="/measurements?kind=sleep_duration">Record sleep duration</a>
        <a className="text-link" href={restrictedLog}>Open restricted log</a>
        <a className="text-link" href={sleepResearch}>Explore scored sleep research</a>
      </div>
      {current?.records && <>
        {(!reachable || current.records.length >= 200) && <p className="notice" role="status">{!reachable
          ? 'Showing records loaded before the service became unavailable.' : 'Showing the latest 200 reports in this period.'}</p>}
        <SleepHistory records={current.records} days={days} />
      </>}
      {!current?.records && <p className="notice" role="status">{current?.error || (!crewId
        ? 'Choose a crew member to view sleep history.' : reachable
          ? 'Loading sleep history…' : 'Connect to the mission service to load sleep history.')}</p>}
      <a className="text-link" href={nasaSleepSource}>NASA astronaut sleep study</a>
    </section>
    <section className="surface form-panel observation-stack" aria-labelledby="crew-exposure">
      <h2 id="crew-exposure"><Radio size={18} /> Radiation exposure</h2>
      <p>Review archived radiation dose rates from the ISS or open the restricted log to view personal dosimeter records.</p>
      <div className="form-actions"><a className="button secondary" href={radiationResearch}>Review radiation archive</a>
        <a className="text-link" href={restrictedLog}>Open restricted log</a></div>
    </section>
  </>
}

export function RestrictedHealthReview({ records }: { records: MissionObservation[] }) {
  const sleep = records.flatMap(item => item.parameter === 'sleep_minutes' && item.value !== null && item.quality !== 'suspect'
    ? [{ kind: 'sleep_duration', value: item.value / 60, recorded_at: item.recorded_at }] : [])
  const personal = usableSeries(records, 'personal_dose_equivalent_rate')
  const latest = personal.at(-1)
  const comparable = latest ? personal.filter(item => comparableTo(item, latest) && item.phase === latest.phase) : []
  const rejected = records.filter(item => item.parameter === 'personal_dose_equivalent_rate').length - personal.length
  if (!sleep.length && !latest && !rejected) return null

  return <section className="surface form-panel observation-stack" aria-labelledby="restricted-health-review">
    <h2 id="restricted-health-review"><Activity size={18} /> Crew monitoring review</h2>
    {sleep.length > 0 && <details className="research-observations"><summary>Daily sleep review</summary>
      <p className="muted">Based on the self-reports loaded for this location. Suspect entries are excluded.</p>
      <SleepHistory records={sleep} days={30} />
    </details>}
    {(latest || rejected > 0) && <details className="research-observations" open><summary>Individual dosimeter review</summary>
      {latest && <p>{latest.value} {latest.unit} · {formatDate(latest.recorded_at)} · {latest.device} · {comparable.length} comparable verified readings</p>}
      {rejected > 0 && <p className="notice" role="status">{rejected === 1 ? 'One reading was' : `${rejected} readings were`} excluded from the analysis.</p>}
      <p className="muted">Device-reported rate. Personal accumulated dose, organ dose and risk assessment require mission-approved dosimetry.</p>
      <a className="text-link" href={nasaCrewStandard}>NASA crew health standard</a>
    </details>}
  </section>
}
