import { useState } from 'react'
import {
  atmosphericStandard, compareResponse, exposureBoundaryKpa, minimumBaselineSamples, pressureScenario,
  responseMetrics, responseWindowMinutes, sampleMinutes, summarizePressure, transitionStepKpa,
  type PressureSample, type PressureTransition,
} from './pressureAnalysis'

const pressureMetrics = [{ key: 'pressure', label: 'Cabin pressure', unit: 'kPa' }, ...responseMetrics] as const
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const time = (at: string) => clock.format(new Date(at))
const signed = (value: number) => value > 0 ? `+${value}` : String(value)
const gap = '—'

function PressureChart({ samples, transitions }: { samples: PressureSample[]; transitions: PressureTransition[] }) {
  const start = Date.parse(samples[0].at)
  const end = Date.parse(samples[samples.length - 1].at)
  const x = (at: string) => 8 + (Date.parse(at) - start) / (end - start) * 684

  return (
    <figure className="pressure-charts">
      {pressureMetrics.map(metric => {
        const values = samples.flatMap(sample => sample[metric.key] ?? [])
        const minimum = Math.min(...values)
        const maximum = Math.max(...values)
        const y = (value: number) => maximum === minimum ? 23 : 40 - (value - minimum) / (maximum - minimum) * 34
        return (
          <div className="pressure-chart" key={metric.key}>
            <div><strong>{metric.label}</strong><small>{values.length ? `${minimum}–${maximum} ${metric.unit}` : 'No observations'}</small></div>
            <svg aria-hidden="true" viewBox="0 0 700 46" preserveAspectRatio="none">
              {transitions.map(transition => <rect key={transition.start} x={x(transition.start)} y="0"
                width={x(transition.end) - x(transition.start)} height="46" className="pressure-band" />)}
              <line x1="8" y1="45" x2="692" y2="45" className="pressure-axis" />
              {samples.map((sample, index) => {
                const value = sample[metric.key]
                if (value === null) return null
                const previous = samples[index - 1]
                const previousValue = previous?.[metric.key]
                const consecutive = previous && Date.parse(sample.at) - Date.parse(previous.at) === sampleMinutes * 60_000
                return <g key={sample.at}>
                  {consecutive && previousValue != null && <line x1={x(previous.at)} y1={y(previousValue)}
                    x2={x(sample.at)} y2={y(value)} className="pressure-trace" />}
                  <ellipse cx={x(sample.at)} cy={y(value)} rx="2.5" ry="1.8" className="pressure-point" />
                </g>
              })}
            </svg>
          </div>
        )
      })}
      <div className="pressure-chart pressure-symptoms">
        <div><strong>Symptoms</strong><small>Simulated reports</small></div>
        <svg aria-hidden="true" viewBox="0 0 700 26" preserveAspectRatio="none">
          <line x1="8" y1="24" x2="692" y2="24" className="pressure-axis" />
          {samples.filter(sample => sample.symptoms.length).map(sample => <line key={sample.at}
            x1={x(sample.at)} x2={x(sample.at)} y1="2" y2="24" className="pressure-marker" />)}
        </svg>
      </div>
      <figcaption className="muted">
        <div className="pressure-chart"><span>15 Nov 2026, UTC</span>
          <span className="pressure-time-axis"><time dateTime={samples[0].at}>{time(samples[0].at)}</time>
            <time dateTime={samples[samples.length - 1].at}>{time(samples[samples.length - 1].at)}</time></span>
        </div>
        <p className="pressure-chart-note">Shaded intervals mark detected transitions. Breaks in a line mark missing readings.</p>
      </figcaption>
    </figure>
  )
}

function TransitionReview({ transition }: { transition: PressureTransition }) {
  const response = compareResponse(pressureScenario.samples, transition)
  return (
    <article className="pressure-transition">
      <h3>{transition.direction} · {time(transition.start)}–{time(transition.end)} UTC</h3>
      <p>{transition.initial} to {transition.final} kPa over {transition.minutes} min. Total change {signed(transition.change)} kPa.
        Steepest recorded rate of change: {signed(transition.fastestStep)} kPa/min.</p>
      <div className="research-table" tabIndex={0} role="region" aria-label={`${transition.direction} response readings`}><table>
        <caption>Median readings through {responseWindowMinutes} min after the transition</caption>
        <thead><tr><th scope="col">Measurement</th><th scope="col">Resting baseline (n)</th>
          <th scope="col">Response (n)</th><th scope="col">Difference</th></tr></thead>
        <tbody>{response.metrics.map(metric => <tr key={metric.key}>
          <th scope="row">{metric.label} ({metric.unit})</th>
          <td>{metric.reference ?? gap} ({metric.baselineCount})</td><td>{metric.observed ?? gap} ({metric.afterCount})</td>
          <td>{metric.difference === null ? gap : `${signed(metric.difference)} ${metric.unit}`}</td>
        </tr>)}</tbody>
      </table></div>
      {response.exercise && <p className="muted">Exercise overlaps the response window and can influence the comparison.</p>}
      <p className="muted">{response.symptoms.length === 0 ? 'No symptoms reported in this window.' : response.symptoms
        .map(symptom => `${symptom.label} at ${time(symptom.at)} UTC`).join(' · ')}</p>
    </article>
  )
}

export function Pressure() {
  const [window, setWindow] = useState('mission')
  const samples = window === 'transitions' ? pressureScenario.samples.slice(23, 48) : pressureScenario.samples
  const { transitions, coveredMinutes, exposureMinutes } = summarizePressure(samples)
  const windowMinutes = (Date.parse(samples[samples.length - 1].at) - Date.parse(samples[0].at)) / 60_000

  return (
    <>
      <header className="page-title"><h1>Cabin pressure</h1>
        <p>Synthetic training scenario · {pressureScenario.location} · {pressureScenario.subject}</p>
      </header>
      <section className="surface form-panel" aria-labelledby="pressure-timeline">
        <div className="section-heading pressure-heading"><h2 id="pressure-timeline">Atmosphere and crew response</h2>
          <label className="pressure-window">Time window <select value={window} onChange={event => setWindow(event.target.value)}>
            <option value="mission">Full scenario · 6 h</option><option value="transitions">Around both transitions · 2 h</option>
          </select></label>
        </div>
        <dl className="pressure-summary">
          <div><dt>Detected transitions</dt><dd>{transitions.length}</dd></div>
          <div><dt>Sampled time below {exposureBoundaryKpa} kPa</dt><dd>{exposureMinutes} min</dd></div>
          <div><dt>Time without usable pressure readings</dt><dd>{windowMinutes - coveredMinutes} min</dd></div>
        </dl>
        <PressureChart samples={samples} transitions={transitions} />
        <details className="pressure-method"><summary>View observations</summary>
          <div className="research-table" tabIndex={0} role="region" aria-label="Synthetic scenario observations"><table>
            <caption>Synthetic readings every {sampleMinutes} min. {gap} indicates a missing reading.</caption>
            <thead><tr><th scope="col">UTC</th>
              {pressureMetrics.map(metric => <th key={metric.key} scope="col">{metric.label} ({metric.unit})</th>)}
              <th scope="col">Activity</th><th scope="col">Reported symptoms</th></tr></thead>
            <tbody>{samples.map(sample => <tr key={sample.at}>
              <th scope="row"><time dateTime={sample.at}>{time(sample.at)}</time></th>
              {pressureMetrics.map(metric => <td key={metric.key}>{sample[metric.key] ?? gap}</td>)}
              <td>{sample.activity}</td><td>{sample.symptoms.join(', ') || gap}</td>
            </tr>)}</tbody>
          </table></div>
        </details>
      </section>
      <section className="surface form-panel pressure-review" aria-labelledby="pressure-review">
        <h2 id="pressure-review">Transition review</h2>
        <p className="muted">The training rule groups consecutive pressure changes of at least {transitionStepKpa} kPa in the same direction.
          Review the readings, data gaps, and crew activity when interpreting these changes.</p>
        {transitions.map(transition => <TransitionReview key={transition.start} transition={transition} />)}
        <details className="pressure-method"><summary>Analysis method and NASA reference</summary>
          <p>The baseline uses at least {minimumBaselineSamples} valid readings from the scenario’s initial rest period.
            The time below {exposureBoundaryKpa} kPa includes only {sampleMinutes}-minute intervals with both readings below that level.
            Intervals with missing data or a threshold crossing remain unclassified. Both pressure thresholds are training settings.</p>
          <p className="muted">{pressureScenario.collection} · Scenario {pressureScenario.id}.</p>
          <a className="text-link" href={atmosphericStandard}>NASA-STD-3001 Volume 2 Revision F · atmospheric monitoring requirements</a>
        </details>
      </section>
    </>
  )
}
