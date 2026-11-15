import { useEffect, useRef, useState } from 'react'
import { Activity, ChevronRight, HeartPulse, Moon, Pause, Play, Thermometer, TriangleAlert, Waves } from 'lucide-react'
import { api, type Assessment, type Measurement } from './api'
import { formatDate, measurementLabels, symptomLabel } from './content'
import skeleton from './assets/full-body-skeleton.png.png'
import heart from './assets/torso-heart.png.png'
import brain from './assets/skull-brain.png.png'
import digestive from './assets/digestive-urinary.png.png'
import './anatomy.css'

const HOLD_MS = 4000
const FADE_MS = 1000
const STEP_MS = HOLD_MS + FADE_MS
const INTRO_MS = 1500
const views = [
  { title: 'Whole-body overview', image: skeleton, alt: 'Full human skeleton anatomical illustration' },
  { title: 'Cardiovascular health', image: heart, alt: 'Torso showing the heart and rib cage' },
  { title: 'Brain & recovery', image: brain, alt: 'Skull and brain anatomical illustration' },
  { title: 'Digestive & urinary health', image: digestive, alt: 'Digestive and urinary systems anatomical illustration' },
]
const kinds = ['heart_rate', 'spo2', 'blood_pressure', 'body_temperature', 'sleep_duration']

function SystemSignal({ index }: { index: number }) {
  const paths = [
    'M1 12h6l3-8 5 16 4-12 3 4h9',
    'M16 11L8 4M16 11L26 4M16 11L27 18M16 11L6 19M16 11v10',
    'M11 3C3 2 2 16 9 17c5 0 4-6 1-7M22 3c8-1 9 13 2 14-5 0-4-6-1-7M11 17l5 5 6-5',
  ]
  return <svg className={`system-signal system-signal-${index}`} viewBox="0 0 32 24" aria-hidden="true">
    <path className="signal-base" d={paths[index - 1]} />
    <path className="signal-trace" pathLength="100" d={paths[index - 1]} />
    {index === 2 && <circle className="signal-node" cx="16" cy="11" r="3" />}
  </svg>
}

function Reading({ reading, label, kind }: { reading?: Measurement; label?: string; kind: string }) {
  return <div className="anatomy-reading">
    {label && <span>{label}</span>}
    <strong>{reading ? <>{reading.value}{reading.diastolic !== null && `/${reading.diastolic}`} <small>{reading.unit}</small></> : '—'}</strong>
    <small>{reading ? <time dateTime={reading.recorded_at}>{formatDate(reading.recorded_at)}</time> : 'No readings'}</small>
    <a className="text-link" href={`/measurements?kind=${kind}`}>{reading ? 'History' : 'Record'} <ChevronRight size={12} /></a>
  </div>
}

function HistoryPlot({ records, kind }: { records: Measurement[]; kind: string }) {
  const points = records.filter(record => record.kind === kind).sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
  if (!points.length) return null
  const min = Math.min(...points.map(point => point.value)), max = Math.max(...points.map(point => point.value))
  const pad = Math.max((max - min) * .2, 1)
  const first = Date.parse(points[0].recorded_at), last = Date.parse(points.at(-1)!.recorded_at)
  const x = (record: Measurement) => first === last ? 160 : 28 + (Date.parse(record.recorded_at) - first) / (last - first) * 266
  const y = (value: number) => 94 - (value - min + pad) / (max - min + 2 * pad) * 76
  return <>
    <svg viewBox="0 0 320 116" className="anatomy-plot" role="img" aria-label={`${measurementLabels[kind]} history: ${points.map(point => `${point.value} ${point.unit} at ${formatDate(point.recorded_at)}`).join('; ')}`}>
      {[20, 58, 96].map(value => <line key={value} x1="28" x2="294" y1={value} y2={value} />)}
      <polyline points={points.map(point => `${x(point)},${y(point.value)}`).join(' ')} />
      {points.map(point => <circle key={point.id} cx={x(point)} cy={y(point.value)} r="3"><title>{point.value} {point.unit} · {formatDate(point.recorded_at)}</title></circle>)}
    </svg>
    <p className="anatomy-footnote">{points.length} {points.length === 1 ? 'reading' : 'readings'}</p>
  </>
}

function SymptomCard({ assessment, codes, title }: { assessment?: Assessment; codes?: string[]; title: string }) {
  const reported = assessment?.symptoms.filter(item => !codes || codes.includes(item.code)) ?? []
  return <article className="anatomy-card"><h3><Waves size={15} /> {title}</h3>
    {reported.length ? <ul className="anatomy-symptoms">{reported.map(item => <li key={item.code}><span>{symptomLabel(item.code)}</span><small>{item.severity === null ? 'Reported' : `${item.severity}/10`}</small></li>)}</ul>
      : <p className="anatomy-empty">{assessment ? 'None reported in the last check-in.' : 'No check-ins yet.'}</p>}
    {assessment && <p className="anatomy-footnote">Latest check-in · {formatDate(assessment.assessed_at)}</p>}
    <a className="text-link" href="/assessment">Log a check-in <ChevronRight size={12} /></a>
  </article>
}

export function AnatomyDashboard({ crewId, measurements, assessments, reachable, showIntro, onIntroStarted }: {
  crewId?: string; measurements: Measurement[]; assessments: Assessment[]; reachable: boolean
  showIntro: boolean; onIntroStarted: () => void
}) {
  const [stage, setStage] = useState(() => ({ index: showIntro ? 0 : 1, sequence: 0, previous: null as number | null }))
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [hidden, setHidden] = useState(document.hidden)
  const [ready, setReady] = useState(false)
  const [retry, setRetry] = useState(0)
  const [failedImages, setFailedImages] = useState<string[]>([])
  const [history, setHistory] = useState<{ crewId: string; records: Measurement[]; failedKinds: string[] }>()
  const timing = useRef({ remaining: showIntro ? INTRO_MS : STEP_MS, started: 0 })
  const introStarted = useRef(false)
  const revision = measurements.map(record => record.id).join(',')
  const stopped = paused || hidden || !ready

  useEffect(() => {
    if (ready && !introStarted.current && showIntro) { introStarted.current = true; onIntroStarted() }
  }, [ready, showIntro, onIntroStarted])

  useEffect(() => {
    let active = true
    void Promise.all(views.map(async view => {
      const image = new Image()
      image.src = view.image
      try { await image.decode() } catch { if (active) setFailedImages(current => [...current, view.image]) }
    })).then(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const update = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => { timing.current.remaining = stage.index === 0 ? INTRO_MS : STEP_MS }, [stage.index, stage.sequence])
  useEffect(() => {
    if (stopped) return
    const timerState = timing.current
    timerState.started = performance.now()
    const timer = window.setTimeout(() => setStage(current => ({ index: current.index === 3 ? 1 : current.index + 1, sequence: current.sequence + 1, previous: current.index })), timerState.remaining)
    return () => {
      window.clearTimeout(timer)
      timerState.remaining = Math.max(0, timerState.remaining - (performance.now() - timerState.started))
    }
  }, [stage.sequence, stopped])

  useEffect(() => {
    if (!crewId || !reachable) return
    let active = true
    void Promise.allSettled(kinds.map(kind => api.measurements(crewId, { kind, limit: 12 }))).then(results => {
      if (!active) return
      const records = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      setHistory({ crewId, records, failedKinds: results.flatMap((result, index) => result.status === 'rejected' ? [kinds[index]] : []) })
    })
    return () => { active = false }
  }, [crewId, reachable, revision, retry])

  const crewHistory = history && history.crewId === crewId ? history : undefined
  const visibleKinds = [['body_temperature'], ['heart_rate', 'spo2', 'blood_pressure'], ['sleep_duration'], []][stage.index]
  const failedVisibleKinds = crewHistory?.failedKinds.filter(kind => visibleKinds.includes(kind)) ?? []
  const records = [...new Map([...(crewHistory?.records ?? []), ...measurements].map(record => [record.id, record])).values()]
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
  const latest = (kind: string) => records.find(record => record.kind === kind)
  const assessment = assessments[0]
  const flagged = assessment && ['urgent', 'review', 'needs_attention'].includes(assessment.status)
  const cardReading = (kind: string, label?: string) => <Reading kind={kind} label={label} reading={latest(kind)} />

  return <section className={`anatomy-dashboard ${ready ? 'is-ready' : ''} ${stopped ? 'is-paused' : ''}`} aria-label="Body systems overview">
    <header className="anatomy-toolbar">
      <h2>Health systems</h2>
      <button className="anatomy-pause" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play body system rotation' : 'Pause body system rotation'}>{paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? 'Play' : 'Pause'}</span></button>
    </header>
    <nav className="anatomy-navigation" aria-label="Body system views">
      {views.slice(1).map((view, index) => <button key={view.title} aria-current={stage.index === index + 1 ? 'step' : undefined}
        onClick={() => setStage(current => ({ index: index + 1, sequence: current.sequence + 1, previous: current.index === index + 1 ? null : current.index }))}>
        <span className="anatomy-tab-number">0{index + 1}</span><span>{view.title}</span>
        <span className="anatomy-progress-rail" aria-hidden="true"><SystemSignal index={index + 1} /><span className="anatomy-progress">{stage.index === index + 1 && <span key={stage.sequence} />}</span></span>
      </button>)}
    </nav>
    {reachable && failedVisibleKinds.length > 0 && <p className="anatomy-history-error" role="status">Couldn’t load {failedVisibleKinds.map(kind => measurementLabels[kind].toLowerCase()).join(', ')} history. <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    <div className={`anatomy-stage ${stage.index === 0 ? 'intro-stage' : ''}`}>
      {views.map((view, index) => <div key={view.title} className={`anatomy-panel ${stage.index === index ? 'is-active' : stage.previous === index ? 'is-exiting' : ''}`} aria-hidden={stage.index !== index} inert={stage.index !== index}>
        <div className="anatomy-column anatomy-column-left">
          {index === 0 && <>
            <article className="anatomy-card"><h3><Thermometer size={15} /> Body temperature</h3>{cardReading('body_temperature')}</article>
            <article className={`anatomy-card ${flagged ? 'anatomy-attention' : ''}`}><h3><TriangleAlert size={15} /> Latest assessment</h3>
              <p className="anatomy-assessment-label">{assessment ? assessment.status.replaceAll('_', ' ') : 'No assessment yet'}</p>
              {assessment?.rationale && <p className="anatomy-empty">{assessment.rationale}</p>}
              <a className="text-link" href={assessment ? `/assessments/${assessment.id}` : '/assessment'}>Review check-in <ChevronRight size={12} /></a>
            </article>
          </>}
          {index === 1 && <>
            <article className="anatomy-card"><h3><HeartPulse size={15} /> Heart rate</h3>{cardReading('heart_rate')}<HistoryPlot records={records} kind="heart_rate" /></article>
            <article className="anatomy-card"><h3><Activity size={15} /> Blood pressure</h3>{cardReading('blood_pressure')}</article>
          </>}
          {index === 2 && <>
            <article className="anatomy-card"><h3><Moon size={15} /> Sleep duration</h3>{cardReading('sleep_duration', 'Previous 24 hours')}<HistoryPlot records={records} kind="sleep_duration" /></article>
          </>}
          {index === 3 && <SymptomCard title="Digestive check-in" assessment={assessment} codes={['nausea', 'abdominal_discomfort', 'constipation', 'diarrhea']} />}
        </div>
        <figure className={`anatomy-visual anatomy-visual-${index}`}>
          <div className="anatomy-orbit" aria-hidden="true" />
          <div className="anatomy-image-window"><div className="anatomy-image-track">
            {failedImages.includes(view.image) ? <p className="anatomy-empty">Illustration unavailable</p> : <img src={view.image} alt={view.alt} decoding="async" draggable={false} />}
          </div></div>
          {index === 0 && <div className="anatomy-intro-loader" aria-label="Opening overview">
            <span className="anatomy-loader-ring" aria-hidden="true" /><span className="anatomy-loader-inner" aria-hidden="true" />
            <Activity size={19} aria-hidden="true" />
          </div>}
        </figure>
        <div className="anatomy-column anatomy-column-right">
          {index === 0 && <SymptomCard title="Reported concerns" assessment={assessment} />}
          {index === 1 && <>
            <article className="anatomy-card"><h3><Waves size={15} /> {measurementLabels.spo2}</h3>{cardReading('spo2')}<HistoryPlot records={records} kind="spo2" />
              {records.some(record => record.kind === 'spo2') && <div className="oxygen-readings"><span>Recent oxygen readings</span>{records.filter(record => record.kind === 'spo2').slice(0, 3).map(record => <div key={record.id}><time dateTime={record.recorded_at}>{formatDate(record.recorded_at)}</time><strong>{record.value}%</strong></div>)}</div>}
            </article>
          </>}
          {index === 2 && <>
            <SymptomCard title="Recovery check-in" assessment={assessment} codes={['fatigue', 'headache', 'dizziness', 'new_confusion']} />
          </>}
          {index === 3 && <>
            <SymptomCard title="Urinary check-in" assessment={assessment} codes={['urinary_discomfort']} />
          </>}
        </div>
      </div>)}
    </div>
  </section>
}
