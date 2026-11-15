import { useEffect, useId, useRef, useState } from 'react'
import { Activity, ArrowUpRight, Brain, Check, ChevronLeft, ChevronRight, CircleAlert, Gauge, Info, Pause, Play, Radio, RotateCcw } from 'lucide-react'
import { anatomyViews } from './AnatomyDashboard'
import { missionElapsed, missionScenarios, type ScenarioMetric } from './missionScenarioData'
import { navigate } from './navigation'
import { exposureBoundaryKpa } from './pressureAnalysis'
import { categoryLabels, sampleContext, type ScenarioEvent, type ScenarioId } from './scenarioEvents'
import { readLunarPractice, scenarioKey, updateLunarPractice } from './localScenario'
import type { ScenarioPlayer } from './useScenarioPlayer'
import './scenario-console.css'

const labels: Record<ScenarioId, string> = {
  'lunar-fatigue': 'Lunar fatigue', 'orbital-pressure': 'Orbital pressure', 'solar-event': 'Solar relay outage',
}
const systemContext = {
  recovery: { label: 'Brain & recovery', icon: Brain, view: anatomyViews[2], note: 'Sleep and performance observations' },
  cardiorespiratory: { label: 'Cardiovascular & respiratory', icon: Activity, view: anatomyViews[1], note: 'Crew readings alongside cabin pressure' },
  environment: { label: 'Mission environment', icon: Radio, view: anatomyViews[0], note: 'Vehicle monitor and separate personal dosimeter' },
}
const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const formatValue = (value: number, unit: string) => `${formatter.format(value)} ${unit}`
const formatDelta = (value: number, unit: string) => `${value > 0 ? '+' : ''}${formatValue(value, unit)}`
type Frame = NonNullable<ScenarioPlayer['frame']>

function Trace({ metric, column, frame, end, events, detailed = false }: {
  metric: ScenarioMetric; column: number; frame: Frame; end: number; events: ScenarioEvent[]; detailed?: boolean
}) {
  const height = detailed ? 126 : 37
  const x = (minute: number) => 8 + minute / Math.max(end, 1) * 344
  const y = (value: number) => height - 9 - (value - metric.range[0]) / (metric.range[1] - metric.range[0]) * (height - 17)
  const latest = frame.latest.values[column]
  return <svg viewBox={`0 0 360 ${height}`} className={detailed ? 'replay-trace detailed' : 'replay-trace'}
    role={detailed ? 'img' : undefined} aria-hidden={!detailed} preserveAspectRatio="none"
    aria-label={detailed ? `${metric.label}, ${metric.unit}, through ${missionElapsed(frame.latest.minute)}. ${latest === null ? 'Latest reading unavailable.' : `Latest reading ${formatValue(latest, metric.unit)}.`} Open the sample table for individual readings.` : undefined}>
    {[8, height / 2, height - 8].map(line => <line className="trace-grid" key={line} x1="8" x2="352" y1={line} y2={line} />)}
    {metric.reference != null && <line className="trace-reference" x1="8" x2={x(frame.latest.minute)} y1={y(metric.reference)} y2={y(metric.reference)} />}
    {detailed && events.filter(event => event.column === column).map(event => <line className={`trace-event ${event.category}`} key={event.id}
      x1={x(event.observedAt)} x2={x(event.observedAt)} y1="8" y2={height - 8}><title>{event.timeLabel} · {event.title}</title></line>)}
    {frame.readings.map((reading, index) => {
      const value = reading.values[column]
      if (value === null) return null
      const previous = frame.readings[index - 1]
      const before = previous?.values[column]
      return <g key={reading.minute}>
        {before != null && <line className="trace-reading" x1={x(previous.minute)} x2={x(reading.minute)} y1={y(before)} y2={y(value)} />}
        {(detailed || index === frame.readings.length - 1 || frame.readings.length < 8) && <circle className="trace-point" cx={x(reading.minute)} cy={y(value)} r="2.6"><title>{missionElapsed(reading.minute)} · {formatValue(value, metric.unit)}</title></circle>}
      </g>
    })}
    {detailed && <line className="trace-cursor" x1={x(frame.latest.minute)} x2={x(frame.latest.minute)} y1="8" y2={height - 8} />}
  </svg>
}

function EventBadge({ event }: { event: ScenarioEvent }) {
  const Icon = event.category === 'quality' ? CircleAlert : event.category === 'health' ? Activity : Info
  return <span className={`event-badge ${event.category}`}><Icon size={13} aria-hidden="true" /> {event.severity} · {categoryLabels[event.category]}</span>
}

function eventMeasurement(event: ScenarioEvent) {
  if (!event.metric || !event.unit) return ''
  const reading = event.currentValue === null ? 'Sample unavailable' : formatValue(event.currentValue, event.unit)
  const reference = event.reference === null ? '' : ` · Reference ${formatValue(event.reference, event.unit)}`
  const change = event.delta === null ? '' : ` · ${formatDelta(event.delta, event.unit)}`
  return `${event.metric}: ${reading}${reference}${change}`
}

function ScenarioEventNotice({ event, newest, onReview }: {
  event?: ScenarioEvent; newest?: ScenarioEvent; onReview: (event: ScenarioEvent) => void
}) {
  const announced = useRef(new Set<string>())
  const [announcement, setAnnouncement] = useState('')
  const id = newest?.id
  const message = newest ? `Synthetic training. ${categoryLabels[newest.category]}. ${newest.title}. ${eventMeasurement(newest)}` : ''
  useEffect(() => {
    if (!id || announced.current.has(id)) { setAnnouncement(''); return }
    announced.current.add(id)
    setAnnouncement(message)
  }, [id, message])

  return <>
    <span className="sr-only" role="status" aria-atomic="true">{announcement}</span>
    {event && <section className="replay-notification" aria-label="Scenario event notice">
      <div className="replay-notification-copy">
        <EventBadge event={event} /><strong>{event.title}</strong>
        {event.metric && <span>{eventMeasurement(event)}</span>}
        <p>{event.comparisonContext}</p>
      </div>
      <button type="button" className="button secondary" onClick={() => onReview(event)}>
        Review evidence <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </section>}
  </>
}

function PracticeCheckIn({ index, practice, onUpdate }: {
  index: number; practice: ReturnType<typeof readLunarPractice>; onUpdate: () => void
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const next = !practice.opened ? 'open' : !practice.repeat ? 'repeat' : !practice.linked ? 'link' : 'close'
  const repeatValue = missionScenarios[0].readings[3].values[1]
  const action = { open: 'Open fictional check-in', repeat: `Record ${repeatValue} bpm repeat`, link: 'Link repeat to check-in', close: 'Close follow-up' }[next]

  async function run() {
    setWorking(true)
    setError('')
    try { await updateLunarPractice(next); onUpdate() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save this training action.') }
    finally { setWorking(false) }
  }

  return <section className="surface replay-detail replay-practice" aria-label="Fictional assessment and follow-up">
    <div><p className="eyebrow">Synthetic records · Saved on this device</p><h3>Practice the check-in</h3></div>
    <p>Assessment evidence at T+2d: fatigue report, 5 h of reported sleep and 83 bpm with activity and posture unavailable.</p>
    {practice.opened && <p>Repeat at T+2d 30m: sit at rest and use the training pulse monitor. The original reading stays attached.</p>}
    <p className="practice-state" role="status">{practice.closed ? 'Follow-up closed. Workflow completion documented.' : practice.linked ? 'Repeat linked. Follow-up open.' : practice.repeat ? `Fictional repeat saved: ${practice.repeat.value} bpm at rest. Link it to the assessment.` : practice.opened ? 'Fictional assessment open. Repeat pending.' : 'Fictional assessment ready.'}</p>
    {!practice.closed && <button className="button primary" type="button" onClick={() => void run()} disabled={working || (next === 'repeat' && index < 3)}>{action}</button>}
    {!practice.closed && practice.opened && !practice.repeat && index === 2 && <small>Advance to the resting repeat checkpoint to record it.</small>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>
}

export function ScenarioConsole({ player, embedded = false }: { player: ScenarioPlayer; embedded?: boolean }) {
  const headingId = useId()
  const detailsId = useId()
  const evidence = useRef<HTMLElement>(null)
  const [practice, setPractice] = useState(readLunarPractice)
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key.endsWith(`.${scenarioKey}`)) setPractice(readLunarPractice())
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  const { scenario, frame, events, state, dispatch } = player
  if (!scenario || !frame || !state.selectedSystem) return null
  const { frameIndex: index, selectedMetric: column, playing } = state
  const { checkpoint, complete, pressure, relay } = frame
  const endIndex = scenario.checkpoints.length - 1
  const end = scenario.checkpoints[endIndex].minute
  const system = systemContext[state.selectedSystem]
  const SystemIcon = system.icon
  const selected = events.find(event => event.id === state.selectedEvent)
  const current = events.filter(event => event.status === 'current')
  const newest = current.find(event => event.observedAt === checkpoint.minute)
  const featured = selected ?? newest ?? current[0]
  const metric = scenario.metrics[column]
  const last = frame.latest.values[column]
  const elapsed = missionElapsed(checkpoint.minute)
  const lunar = scenario.id === 'lunar-fatigue'
  const seek = (position: number) => dispatch({ type: 'seek', index: position })
  const missing = frame.latest.values.filter(value => value === null).length

  return <div className={`replay-console ${scenario.id}`}
    onKeyDown={event => { if (event.key === 'Escape' && selected) dispatch({ type: 'dismiss' }) }}>
    <section className="replay-actions" aria-label="Action required summary">
      <span><Activity size={16} aria-hidden="true" /><strong>{current.filter(event => event.severity === 'Review').length}</strong> to review</span>
      <span><Radio size={16} aria-hidden="true" /><strong>{current.filter(event => event.category === 'operations').length}</strong> operational</span>
      <span><CircleAlert size={16} aria-hidden="true" /><strong>{missing}</strong> unavailable {missing === 1 ? 'sample' : 'samples'}</span>
      <span><Check size={16} aria-hidden="true" /><strong>{lunar && index >= 2 && !practice.closed ? '1' : '0'}</strong> open follow-ups</span>
      {current.every(event => event.severity !== 'Review') && <span className="replay-no-findings">No active review items</span>}
    </section>

    <ScenarioEventNotice event={featured} newest={newest} onReview={event => {
      dispatch({ type: 'inspect', event })
      evidence.current?.focus()
    }} />

    <div className="replay-metrics" aria-label="Synthetic observations at this checkpoint">
      {scenario.metrics.map((item, position) => {
        const value = frame.latest.values[position]
        return <button className="surface replay-metric" type="button" key={item.label} aria-pressed={position === column}
          aria-controls={detailsId} onClick={() => dispatch({ type: 'metric', column: position })}>
          <span className="metric-name">{item.label}</span>
          <strong>{value === null ? 'Unavailable' : <>{formatter.format(value)} <small>{item.unit}</small></>}</strong>
          <span className="metric-source">Synthetic · {missionElapsed(frame.latest.minute)}</span>
          <Trace metric={item} column={position} frame={frame} end={end} events={events} />
          {item.reference != null && <span>Ref. {formatValue(item.reference, item.unit)}{value === null ? '' : ` · ${formatDelta(value - item.reference, item.unit)}`}</span>}
          <span>{value === null ? 'No sample at this time' : sampleContext(scenario.id, position, index)}</span>
        </button>
      })}
    </div>

    <section className="surface replay-anatomy" aria-labelledby={headingId}>
      <header className="replay-toolbar">
        <div><p className="eyebrow">Synthetic training · {scenario.environment}</p><h2 id={headingId}>Body systems</h2></div>
        <div className="replay-picker">
          <label>Scenario <select value={scenario.id} onChange={event => {
            const id = event.target.value as ScenarioId
            if (embedded) dispatch({ type: 'open', id })
            else navigate(`/scenarios/${id}`)
          }}>{missionScenarios.map(item => <option key={item.id} value={item.id}>{labels[item.id]}</option>)}</select></label>
          {embedded ? <button type="button" className="button secondary" onClick={() => {
            dispatch({ type: 'exit' })
            if (new URLSearchParams(window.location.search).has('scenario')) navigate('/')
          }}>Exit scenario</button>
            : <a href="/scenarios" className="button secondary">All scenarios</a>}
        </div>
      </header>
      <div className="replay-transport" aria-label="Scenario playback controls">
        <label className="replay-range">Jump to a checkpoint <input type="range" min="0" max={endIndex} value={index}
          aria-valuetext={`${index + 1} of ${endIndex + 1}, ${elapsed}, ${checkpoint.title}`} onChange={event => seek(event.target.valueAsNumber)} /></label>
        <div className="replay-buttons">
          <button className="button primary" type="button" onClick={() => dispatch({ type: 'toggle' })}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pause' : complete ? 'Replay' : 'Play'}</button>
          <button className="button secondary" type="button" disabled={index === 0} onClick={() => seek(index - 1)}><ChevronLeft size={15} /> Previous</button>
          <button className="button secondary" type="button" disabled={complete} onClick={() => seek(index + 1)}>Next <ChevronRight size={15} /></button>
          <button className="button secondary" type="button" disabled={index === 0 && !playing} onClick={() => seek(0)}><RotateCcw size={14} /> Reset</button>
          <label>Playback <select value={state.speed} onChange={event => dispatch({ type: 'speed', seconds: Number(event.target.value) })}>
            <option value={8}>8 sec/step</option><option value={5}>5 sec/step</option><option value={2}>2 sec/step</option>
          </select></label>
        </div>
      </div>
      <div className="replay-stage">
        <figure className={`replay-illustration ${state.selectedSystem}`}>
          <img src={system.view.image} alt={system.view.alt} draggable={false} />
          <figcaption><SystemIcon size={17} aria-hidden="true" /><span>{system.label}<small>{system.note}</small></span></figcaption>
          <button className="replay-hotspot" type="button" title={`${system.label} trace`} aria-label={`Focus ${system.label} trace`}
            onClick={() => document.getElementById(detailsId)?.focus()}><SystemIcon size={18} aria-hidden="true" /></button>
        </figure>
        <div className="replay-checkpoint">
          <div className="replay-time"><strong>{elapsed}</strong><span>{scenario.subject}</span></div>
          <p className="eyebrow">Checkpoint {index + 1} of {endIndex + 1} · {checkpoint.status}</p>
          <h3 aria-live="polite">{checkpoint.title}</h3>
          <p>{checkpoint.event}</p>
          {relay && <p className="relay-status">Relay {relay.link.toLowerCase()} · {relay.handover}</p>}
          {lunar && index >= 2 && <a className="text-link" href="#fictional-check-in">{practice.closed ? 'Review closed follow-up' : 'Practice the check-in'} <ChevronRight size={14} aria-hidden="true" /></a>}
        </div>
      </div>
      <aside className="replay-feed" aria-label="Scenario event feed">
        <div className="replay-feed-heading"><h3>Mission events</h3><span>{events.length} through {elapsed}</span></div>
        {events.length ? <ol>{events.map(event => <li key={event.id}>
          <button type="button" aria-pressed={selected?.id === event.id} onClick={() => dispatch({ type: 'inspect', event })}>
            <EventBadge event={event} /><strong>{event.title}</strong><small>{event.timeLabel}{event.status === 'recorded' ? ' · Recorded' : ''}</small>
          </button>
        </li>)}</ol> : <p>No events recorded at this checkpoint.</p>}
        <small>Clinical escalation requires an approved protocol. This replay has no clinical escalation rules.</small>
      </aside>
    </section>

    <div className="replay-lower">
      <section className="surface replay-detail" aria-labelledby={detailsId}>
        <h3 id={detailsId} tabIndex={-1}>{metric.label} trend</h3>
        <p>Synthetic samples · {metric.unit} · {last === null ? 'Latest sample unavailable' : `${formatValue(last, metric.unit)} at ${elapsed}`}</p>
        <Trace metric={metric} column={column} frame={frame} end={end} events={events} detailed />
        <div className="trace-ticks"><span>T+0m</span><span>{elapsed} current</span><span>{missionElapsed(end)}</span></div>
        {metric.reference != null && <p>Reference {formatValue(metric.reference, metric.unit)} · Median of five training sessions before T+0m, on the simulated mission clock. Pulse reference collected at rest.</p>}
        <details className="replay-samples"><summary>View samples ({frame.readings.length})</summary><div className="research-table" tabIndex={0} role="region" aria-label="Synthetic sample table">
          <table><thead><tr><th scope="col">Mission time</th>{scenario.metrics.map(item => <th scope="col" key={item.label}>{item.label} ({item.unit})</th>)}</tr></thead>
            <tbody>{[...frame.readings].reverse().map(reading => <tr key={reading.minute}><th scope="row">{missionElapsed(reading.minute)}</th>
              {reading.values.map((value, position) => <td key={scenario.metrics[position].label}>{value === null ? 'Unavailable' : formatter.format(value)}</td>)}</tr>)}</tbody></table>
        </div></details>
      </section>
      <section ref={evidence} tabIndex={-1} className="surface replay-detail" aria-label="Observation explanation">
        <div className="replay-explain-heading"><h3>{selected ? 'Why this event appears' : 'Checkpoint evidence'}</h3>
          {selected && <button className="text-link" type="button" onClick={() => dispatch({ type: 'dismiss' })}>Back to checkpoint</button>}</div>
        {selected ? <>
          <EventBadge event={selected} /> <strong>{selected.title}</strong>
          <p>{selected.timeLabel} · {selected.validationScope} · {selected.source}</p>
          {selected.metric && <p>{eventMeasurement(selected)}</p>}
          <p>{selected.dataQuality}. {selected.rationale}</p><p>{selected.comparisonContext}</p><p><strong>Next step</strong> {selected.recommendedWorkflow}</p>
          <a href={selected.link} className="text-link">Open checkpoint as a full replay <ArrowUpRight size={14} aria-hidden="true" /></a>
        </> : <><p>{checkpoint.system}</p><p><strong>Crew action</strong> {checkpoint.crew}</p></>}
        {pressure && <p><Gauge size={15} aria-hidden="true" /> {pressure.transitions.length} transitions · {pressure.coveredMinutes}/{checkpoint.minute} min covered · {pressure.exposureMinutes} min below the exercise boundary ({exposureBoundaryKpa} kPa).</p>}
        {relay && <p>Simulated handover: {[
          relay.queuedAt != null && `Queued ${missionElapsed(relay.queuedAt)}`, relay.sentAt != null && `Sent ${missionElapsed(relay.sentAt)}`,
          relay.acknowledgedAt != null && `Receipt ${missionElapsed(relay.acknowledgedAt)}`,
        ].filter(Boolean).join(' · ') || 'No handover yet'}</p>}
      </section>
      {lunar && index >= 2 && <div id="fictional-check-in"><PracticeCheckIn index={index} practice={practice} onUpdate={() => setPractice(readLunarPractice())} /></div>}
      <section className="surface replay-detail" aria-label="Data provenance and limits"><h3>Sources and limits</h3>
        <p>Data: scripted synthetic mission replay. Method: {lunar ? 'descriptive comparison to personal training sessions' : pressure ? 'measured intervals and pressure transitions in a simulated instrument trace' : 'separate instrument traces and scripted communication states'}.</p>
        <p>NASA evidence provides mission context. Scenario readings and events are fictional. This research and training prototype does not establish clinical status, causation or effective dose.</p>
        <a className="text-link" href={scenario.source.url}>{scenario.source.label} <ArrowUpRight size={14} aria-hidden="true" /></a>
        <a className="text-link" href="/research">Explore archived NASA data <ArrowUpRight size={14} aria-hidden="true" /></a>
        {complete && <p><strong>Debrief</strong> {scenario.outcome}</p>}
        {embedded && <a className="text-link" href={`/scenarios/${scenario.id}`}>Open full replay <ArrowUpRight size={14} aria-hidden="true" /></a>}
      </section>
    </div>
  </div>
}
