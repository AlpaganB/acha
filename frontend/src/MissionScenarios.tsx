import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Gauge, Moon, Pause, Play, Radio, RotateCcw } from 'lucide-react'
import { missionElapsed, missionScenarios, scenarioFrame, type ScenarioMetric } from './missionScenarioData'
import { exposureBoundaryKpa } from './pressureAnalysis'
import './mission-scenarios.css'

type Scenario = (typeof missionScenarios)[number]
type Frame = ReturnType<typeof scenarioFrame>

const icons = { 'lunar-fatigue': Moon, 'orbital-pressure': Gauge, 'solar-event': Radio }
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const valueLabel = (value: number, unit: string) => `${number.format(value)} ${unit}`
const differenceLabel = (value: number, unit: string) => `${value > 0 ? '+' : ''}${valueLabel(value, unit)}`

function ScenarioLibrary({ missing }: { missing: boolean }) {
  return <div className="scenario-page">
    <header className="scenario-library-header surface">
      <p className="eyebrow">ACHA · Mission training</p>
      <h1>Space mission scenarios</h1>
      <p>Replay three fictional missions to see how ACHA brings together measurements, crew observations, and follow-up over time.</p>
      <span className="scenario-chip">Synthetic data · Runs in this browser</span>
    </header>
    {missing && <p className="notice" role="status">This scenario was not found. Choose a replay below.</p>}
    <div className="scenario-catalog" aria-label="Available mission scenarios">
      {missionScenarios.map((scenario, index) => {
        const Icon = icons[scenario.id]
        return <a className={`scenario-card surface ${scenario.id}`} href={`/scenarios/${scenario.id}`} key={scenario.id}>
          <div className="scenario-card-top"><span className="scenario-icon"><Icon size={22} aria-hidden="true" /></span>
            <span className="scenario-duration"><Clock3 size={14} aria-hidden="true" /> {scenario.duration}</span></div>
          <p className="eyebrow">0{index + 1} · {scenario.environment}</p>
          <h2>{scenario.title}</h2>
          <p>{scenario.intro}</p>
          <ul className="scenario-topics" aria-label="Topics">{scenario.topics.map(topic => <li key={topic}>{topic}</li>)}</ul>
          <span className="scenario-card-action">Open scenario <ArrowRight size={16} aria-hidden="true" /></span>
        </a>
      })}
    </div>
  </div>
}

function MetricTrace({ metric, column, readings, end }: { metric: ScenarioMetric; column: number; readings: Frame['readings']; end: number }) {
  const value = readings.at(-1)?.values[column] ?? null
  const reference = metric.reference
  const x = (minute: number) => 4 + minute / end * 312
  const [low, high] = metric.range
  const y = (reading: number) => 46 - (reading - low) / (high - low) * 42
  return <article className="scenario-metric">
    <h3>{metric.label}</h3>
    <p className="scenario-metric-value">{value === null ? 'No reading' : valueLabel(value, metric.unit)}</p>
    <svg viewBox="0 0 320 50" preserveAspectRatio="none" aria-hidden="true">
      <line className="scenario-chart-axis" x1="4" x2="316" y1="47" y2="47" />
      {reference != null && <line className="scenario-chart-reference" x1="4" x2="316" y1={y(reference)} y2={y(reference)} />}
      {readings.map((reading, index) => {
        const current = reading.values[column]
        if (current === null) return null
        const previous = readings[index - 1]
        const previousValue = previous?.values[column]
        return <g key={reading.minute}>
          {previousValue != null && <line className="scenario-chart-trace" x1={x(previous.minute)} x2={x(reading.minute)} y1={y(previousValue)} y2={y(current)} />}
          <ellipse className="scenario-chart-point" cx={x(reading.minute)} cy={y(current)} rx="2.3" ry="2" />
        </g>
      })}
    </svg>
    <small>{reference != null ? `Ref. ${valueLabel(reference, metric.unit)}${value === null ? '' : ` · Δ ${differenceLabel(value - reference, metric.unit)}`}`
      : `Observed window · through ${missionElapsed(readings.at(-1)!.minute)}`}</small>
  </article>
}

function ObservationTable({ scenario, frame }: { scenario: Scenario; frame: Frame }) {
  return <details className="scenario-data">
    <summary>View readings through this checkpoint ({frame.readings.length})</summary>
    <div className="research-table" role="region" tabIndex={0} aria-label="Observed scenario readings">
      <table>
        <caption className="muted">A dash means no reading was available at that time.</caption>
        <thead><tr><th scope="col">Mission time</th>{scenario.metrics.map(metric => <th key={metric.label} scope="col">{metric.label} ({metric.unit})</th>)}</tr></thead>
        <tbody>{[...frame.readings].reverse().map(reading => <tr key={reading.minute}>
          <th scope="row">{missionElapsed(reading.minute)}</th>
          {reading.values.map((value, index) => <td key={scenario.metrics[index].label}>{value === null ? '—' : number.format(value)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </details>
}

function ScenarioReplay({ scenario, onOpenPractice }: { scenario: Scenario; onOpenPractice: () => void }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [seconds, setSeconds] = useState(5)
  const endIndex = scenario.checkpoints.length - 1
  const endTime = scenario.checkpoints[endIndex].minute
  const frame = scenarioFrame(scenario, index)
  const { checkpoint, complete, pressure, relay } = frame
  const Icon = icons[scenario.id]

  useEffect(() => {
    if (!playing || complete) return
    const timeout = window.setTimeout(() => {
      setIndex(index + 1)
      if (index + 1 === endIndex) setPlaying(false)
    }, seconds * 1000)
    return () => window.clearTimeout(timeout)
  }, [playing, complete, index, endIndex, seconds])

  function goTo(next: number) {
    setPlaying(false)
    setIndex(Math.min(Math.max(next, 0), endIndex))
  }

  return <div className={`scenario-page ${scenario.id}`}>
    <header className="scenario-replay-header">
      <a className="text-link scenario-back" href="/scenarios"><ArrowLeft size={15} aria-hidden="true" /> All scenarios</a>
      <div className="scenario-title-row"><span className="scenario-icon"><Icon size={25} aria-hidden="true" /></span>
        <div><p className="eyebrow">{scenario.environment} · {scenario.duration} · Synthetic replay</p><h1>{scenario.title}</h1></div>
      </div>
      <p>{scenario.intro}</p>
      <p className="scenario-subject">{scenario.subject}</p>
    </header>

    <section className="surface scenario-panel scenario-player" aria-labelledby="replay-title">
      <div className="scenario-panel-heading">
        <div><h2 id="replay-title">Mission timeline</h2><p className="muted">Step {index + 1} of {endIndex + 1} · {missionElapsed(checkpoint.minute)}</p></div>
        <span className={`scenario-chip${complete ? ' complete' : ''}`}>{complete && <Check size={14} aria-hidden="true" />}{complete ? 'Replay complete' : playing ? 'Playing' : 'Paused'}</span>
      </div>
      <label className="scenario-scrubber">Jump to a checkpoint
        <input type="range" min={0} max={endIndex} value={index}
          aria-valuetext={`${index + 1} of ${endIndex + 1}, ${missionElapsed(checkpoint.minute)}, ${checkpoint.title}`}
          onChange={event => goTo(Number(event.target.value))} />
      </label>
      <div className="scenario-controls">
        <button className="button primary" type="button" onClick={() => {
          if (complete) setIndex(0)
          setPlaying(!playing)
        }}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {playing ? 'Pause' : complete ? 'Replay' : 'Play'}</button>
        <button className="button secondary" type="button" disabled={index === 0} onClick={() => goTo(index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>
        <button className="button secondary" type="button" disabled={complete} onClick={() => goTo(index + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></button>
        <button className="button secondary" type="button" disabled={index === 0 && !playing} onClick={() => goTo(0)}><RotateCcw size={14} aria-hidden="true" /> Reset</button>
        <label className="scenario-speed">Playback <select value={seconds} onChange={event => setSeconds(Number(event.target.value))}>
          <option value={8}>8 sec / step</option><option value={5}>5 sec / step</option><option value={2}>2 sec / step</option>
        </select></label>
      </div>
    </section>

    <section className="surface scenario-panel" aria-labelledby="checkpoint-title">
      <div className="scenario-panel-heading" aria-live="polite" aria-atomic="true">
        <div><p className="eyebrow">{missionElapsed(checkpoint.minute)} · Current checkpoint</p><h2 id="checkpoint-title">{checkpoint.title}</h2></div>
        <span className="scenario-chip">{checkpoint.status}</span>
      </div>
      <dl className="scenario-explanation">
        <div><dt>What happened</dt><dd>{checkpoint.event}</dd></div>
        <div><dt>What ACHA shows</dt><dd>{checkpoint.system}</dd></div>
        <div><dt>What the crew logs</dt><dd>{checkpoint.crew}</dd></div>
      </dl>
    </section>

    <section className="surface scenario-panel" aria-labelledby="telemetry-title">
      <div className="scenario-panel-heading"><div><h2 id="telemetry-title">Measurements</h2>
        <p className="muted">Each chart shows its own scale. Traces stop at the selected checkpoint and break at missing readings.</p></div></div>
      <div className="scenario-metric-grid">{scenario.metrics.map((metric, column) => <MetricTrace key={metric.label}
        metric={metric} column={column} readings={frame.readings} end={endTime} />)}</div>
      {pressure && <dl className="scenario-stats" aria-label="Cabin pressure analysis">
        <div><dt>Pressure transitions</dt><dd>{pressure.transitions.length}</dd></div>
        <div><dt>Pressure coverage</dt><dd>{pressure.coveredMinutes} / {checkpoint.minute} min</dd></div>
        <div><dt>Measured time below {exposureBoundaryKpa} kPa</dt><dd>{pressure.exposureMinutes} min <small>Exercise analysis boundary</small></dd></div>
      </dl>}
      {relay && <dl className="scenario-stats" aria-label="Simulated ground handover">
        <div><dt>Earth relay</dt><dd>{relay.link}</dd></div>
        <div><dt>Simulated handover</dt><dd>{relay.handover}<small>{[
          relay.queuedAt == null ? '' : `Queued ${missionElapsed(relay.queuedAt)}`,
          relay.sentAt == null ? '' : `Sent ${missionElapsed(relay.sentAt)}`,
          relay.acknowledgedAt == null ? '' : `Receipt ${missionElapsed(relay.acknowledgedAt)}`,
        ].filter(Boolean).join(' · ')}</small></dd></div>
      </dl>}
      <ObservationTable scenario={scenario} frame={frame} />
    </section>

    <section className="surface scenario-panel" aria-labelledby="log-title">
      <div className="scenario-panel-heading"><div><h2 id="log-title">Mission log</h2><p className="muted">Select a checkpoint to revisit its measurements and decisions.</p></div></div>
      <ol className="scenario-log">{frame.checkpoints.map((entry, position) => <li key={entry.minute}>
        <button type="button" className="scenario-log-entry" aria-current={position === index ? 'step' : undefined} onClick={() => goTo(position)}>
          <span className="scenario-log-time">{missionElapsed(entry.minute)}</span><strong>{entry.title}</strong><span>{entry.status}</span>
        </button>
      </li>)}</ol>
    </section>

    {complete && <section className="surface scenario-panel scenario-debrief" aria-labelledby="debrief-title">
      <h2 id="debrief-title"><Check size={19} aria-hidden="true" /> Mission debrief</h2>
      <p>{scenario.outcome}</p>
      {scenario.id === 'lunar-fatigue' && <button className="button primary" type="button" onClick={onOpenPractice}>Practice the check-in <ArrowRight size={16} aria-hidden="true" /></button>}
    </section>}

    <footer className="scenario-footer">
      <p>Training replay with scripted events and fictional readings. Playback creates no mission records and sends no messages.</p>
      <div><a className="text-link" href={scenario.related.url}>{scenario.related.label} <ArrowRight size={14} aria-hidden="true" /></a>
        <a className="text-link" href={scenario.source.url}>{scenario.source.label}</a></div>
    </footer>
  </div>
}

export function MissionScenarios({ id, onOpenPractice }: { id?: string; onOpenPractice: () => void }) {
  const scenario = missionScenarios.find(item => item.id === id)
  return scenario ? <ScenarioReplay key={scenario.id} scenario={scenario} onOpenPractice={onOpenPractice} /> : <ScenarioLibrary missing={Boolean(id)} />
}
