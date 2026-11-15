import { useState } from 'react'
import archive from './data/sleep-edf.json'
import { reviewSleepStages, type SleepSegment } from './monitoringAnalysis'

const source = 'https://physionet.org/content/sleep-edfx/1.0.0/'
const files = 'https://physionet.org/files/sleep-edfx/1.0.0/'
const license = 'https://physionet.org/content/sleep-edfx/view-license/1.0.0/'
const records = archive.map(record => ({ ...record, segments: record.segments.map(
  ([start, duration, stage]): SleepSegment => [Number(start), Number(duration), String(stage)],
) }))
const participants = new Set(records.map(record => record.participant)).size
const stages = {
  W: 'Wake', '1': 'Stage 1', '2': 'Stage 2', '3': 'Stage 3', '4': 'Stage 4', R: 'REM', M: 'Movement', '?': 'Unscored',
} as const
const labels = Object.keys(stages) as (keyof typeof stages)[]
const minutes = (seconds: number) => `${Number((seconds / 60).toFixed(1))} min`

export function SleepResearch() {
  const [id, setId] = useState(records[0].id)
  const current = records.find(record => record.id === id) ?? records[0]
  const review = reviewSleepStages(current.segments)

  return <section className="surface form-panel" aria-labelledby="sleep-research">
    <div className="section-heading monitoring-heading"><h2 id="sleep-research">Scored sleep research</h2>
      <label>Recording <select value={current.id} onChange={event => setId(event.target.value)}>
        {records.map(item => <option key={item.id}>{item.id}</option>)}
      </select></label></div>
    <p>PhysioNet Sleep-EDF Expanded · {records.length} home recordings from {participants} adult participants in the Sleep Cassette study.</p>
    <dl className="monitoring-metrics">
      <div><dt>Scored sleep</dt><dd>{minutes(review.sleepSeconds)}</dd></div>
      <div><dt>Wake after first sleep epoch</dt><dd>{minutes(review.wakeSeconds)}</dd></div>
      <div><dt>Longest scored wake interval</dt><dd>{minutes(review.longestWakeSeconds)}</dd></div>
      <div><dt>Movement, unscored or missing</dt><dd>{minutes(review.unknownSeconds)}</dd></div>
    </dl>
    <figure className="monitoring-figure">
      <svg viewBox="0 0 720 96" preserveAspectRatio="none" role="img" aria-label="Manually scored sleep stages by time from first scored sleep">
        <rect width="720" height="96" className="monitoring-plot-base" />
        {current.segments.map(([start, duration, stage]) => <rect key={start} x={start / review.periodSeconds * 720}
          y={labels.indexOf(stage as keyof typeof stages) * 12 + 2} width={duration / review.periodSeconds * 720}
          height="8" className={`sleep-phase sleep-phase-${stage === '?' ? 'unknown' : stage}`}><title>{stages[stage as keyof typeof stages]} · {minutes(start)} from first scored sleep · {minutes(duration)}</title></rect>)}
      </svg>
      <figcaption className="pressure-time-axis"><span>First scored sleep</span><span>{minutes(review.periodSeconds)} elapsed</span></figcaption>
    </figure>
    <div className="research-table" role="region" aria-label="Scored stage totals" tabIndex={0}><table>
      <thead><tr><th scope="col">Scored stage</th><th scope="col">Time</th></tr></thead>
      <tbody>{labels.filter(label => label !== 'M' && label !== '?').map(label => <tr key={label}>
        <th scope="row"><span className={`sleep-key sleep-phase-${label}`} aria-hidden="true" />{stages[label]}</th>
        <td>{minutes(review.stageSeconds[label])}</td></tr>)}</tbody>
    </table></div>
    <p className="muted">The chart covers first to last scored sleep. It omits wake outside that interval and cannot establish sleep latency or time-in-bed efficiency. The underlying stages were scored using Rechtschaffen–Kales criteria.</p>
    <div className="form-actions"><a className="text-link" href={source}>PhysioNet dataset and attribution</a>
      <a className="text-link" href={files + current.path}>Recording annotations (EDF+)</a>
      <a className="text-link" href={license}>ODC Attribution license</a></div>
  </section>
}
