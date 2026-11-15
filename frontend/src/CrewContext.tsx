import type { CrewReport } from './api'
import { phases, printable, utcTime } from './ObservationTrends'
import { signedValue } from './PersonalIndicators'

const gravityNames: Record<string, string> = {
  microgravity: 'Microgravity', partial_gravity: 'Partial gravity', one_g: '1 g', unknown: 'Unclassified regime',
}

export function CrewContext({ report }: { report: CrewReport }) {
  const through = utcTime.format(new Date(report.through))
  return <div className="crew-monitoring-stack">
    <section className="surface form-panel">
      <div className="section-heading"><h2>Nutrition and exercise</h2></div>
      <p className="muted">Reported intake and exercise by UTC date through {through}. Measurement comparisons match recorded posture and timing.</p>
      {report.daily_context.length === 0 ? <p className="notice">No intake or exercise entries in the seven-day review period.</p>
        : <div className="research-table" tabIndex={0} role="region" aria-label="Daily nutrition and exercise">
          <table><thead><tr><th scope="col">UTC day</th><th scope="col">Energy (kcal)</th><th scope="col">Protein (g)</th>
            <th scope="col">Fluid (mL)</th><th scope="col">Sodium (mg)</th><th scope="col">Exercise</th></tr></thead>
            <tbody>{[...report.daily_context].reverse().map(day => <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{printable(day.intake.energy_intake)}</td><td>{printable(day.intake.protein_intake)}</td>
              <td>{printable(day.intake.fluid_intake)}</td><td>{printable(day.intake.sodium_intake)}</td>
              <td>
                {day.exercise_minutes === null ? '—' : printable(day.exercise_minutes) + ' timed min'}
                {Object.entries(day.exercise_by_mode).map(([mode, duration]) => <div key={mode}>{mode} · {printable(duration)} min</div>)}
                {day.exercise_conflict_minutes > 0 && <div>{printable(day.exercise_conflict_minutes)} min with conflicting entries</div>}
                {day.untimed_exercise_minutes !== null && <div>{printable(day.untimed_exercise_minutes)} min reported without session times</div>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
      {report.daily_context.length > 0 && <p className="muted">Intake totals cover entries on file. A dash indicates missing or conflicting data.</p>}
    </section>
    <section className="surface form-panel">
      <div className="section-heading"><h2>Gravity exposure and adaptation</h2></div>
      {report.gravity ? <>
        <p className="muted">Recorded intervals from {utcTime.format(new Date(report.gravity.since))} UTC to {through} UTC.</p>
        <dl className="crew-exposure-metrics">
          {Object.entries(report.gravity.hours).map(([regime, hours]) => <div key={regime}><dt>{gravityNames[regime]}</dt><dd>{printable(hours)} h</dd></div>)}
          <div><dt>Unlogged</dt><dd>{printable(report.gravity.unlogged_hours)} h</dd></div>
          {report.gravity.conflict_hours > 0 && <div><dt>Conflicting regimes</dt><dd>{printable(report.gravity.conflict_hours)} h</dd></div>}
        </dl>
      </> : <p className="notice">No verified gravity intervals in the 30-day review period.</p>}
      {report.adaptation.length > 0 && <div className="research-table" tabIndex={0} role="region" aria-label="Changes since preflight">
        <table><thead><tr><th scope="col">Measurement</th><th scope="col">Latest phase</th><th scope="col">Latest</th>
          <th scope="col">Comparable preflight</th><th scope="col">Change</th></tr></thead>
          <tbody>{report.adaptation.map(item => <tr key={item.parameter}>
            <th scope="row">{item.label}</th><td>{phases[item.phase]}</td><td>{printable(item.value)} {item.unit}</td>
            <td>{item.preflight === null ? 'No matched reading'
              : printable(item.preflight) + ' ' + item.unit + ' · ' + item.days + ' days'}</td>
            <td>{item.change === null ? '—' : signedValue(item.change) + ' ' + item.unit
              + (item.percentage_change === null ? '' : ' · ' + signedValue(item.percentage_change) + '%')}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <p className="muted">NASA tracks changes in muscle strength, aerobic capacity and bone mineral density during and after flight. The table shows this person’s measured changes for matched conditions.</p>
      <a className="text-link" href="https://www.nasa.gov/reference/4-0-human-performance/">NASA human performance evidence</a>
    </section>
  </div>
}
