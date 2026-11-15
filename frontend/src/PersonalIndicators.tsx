import { useEffect, useState, type FormEvent } from 'react'
import { Activity, CalendarRange } from 'lucide-react'
import { api, type Indicator, type IndicatorReport } from './api'
import { phases, printable, utcTime } from './ObservationTrends'

const valueFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 })
const flags = new Set(['above', 'below'])
const statusText: Record<Indicator['reference']['status'], string> = {
  collecting: 'Building reference',
  flat_history: 'Reference has no measurable spread',
  within: 'Within personal band',
  above: 'Above personal band',
  below: 'Below personal band',
  quality: 'Latest reading needs verification',
  conflict: 'Conflicting latest readings',
}

export function signedValue(value: number | null) {
  return value === null ? '—' : (value > 0 ? '+' : '') + valueFormatter.format(value)
}

export function IndicatorCards({ indicators }: { indicators: Indicator[] }) {
  const deviations = indicators.filter(row => flags.has(row.reference.status))
  if (!indicators.length) return <p className="notice" role="status">Add a reading for this crew member to begin.</p>

  return <section aria-labelledby="personal-indicators">
    <div className="section-heading"><h2 id="personal-indicators">Personal indicators</h2></div>
    {deviations.length > 0 && <p className="notice" role="status"><Activity size={17} aria-hidden="true" />
      {deviations.length} {deviations.length === 1 ? 'indicator is' : 'indicators are'} outside the personal observation band.
    </p>}
    <div className="crew-indicator-grid">
      {indicators.map(row => <article className="surface crew-indicator" key={row.parameter} data-deviation={flags.has(row.reference.status) || undefined}>
        <div className="crew-indicator-header"><h3>{row.label}</h3><span className="crew-indicator-status">{statusText[row.reference.status]}</span></div>
        <p className="crew-indicator-value">{valueFormatter.format(row.value)} <small>{row.unit}</small></p>
        <time dateTime={row.recorded_at}>{utcTime.format(new Date(row.recorded_at))} UTC</time>
        {(row.phase || row.activity || row.device) && <p className="crew-indicator-context">
          {[row.phase && phases[row.phase], row.activity, row.posture, row.timing, row.device]
            .filter(value => value && value !== 'unknown').map(value => value!.replaceAll('_', ' ')).join(' · ')}
        </p>}
        <dl className="crew-indicator-reference">
          <div><dt>Reference median</dt><dd>{row.reference.median === null ? '—' : valueFormatter.format(row.reference.median) + ' ' + row.unit}</dd></div>
          <div><dt>Change</dt><dd>{signedValue(row.reference.change)}{row.reference.change !== null ? ' ' + row.unit : ''}</dd></div>
        </dl>
        <p className="crew-indicator-context">{row.reference.days} {row.reference.days === 1 ? 'day' : 'days'} of comparable history
          {row.reference.lower !== null && row.reference.upper !== null
            && ' · Band ' + printable(row.reference.lower) + ' to ' + printable(row.reference.upper) + ' ' + row.unit}</p>
      </article>)}
    </div>
  </section>
}

const today = () => new Date().toISOString().slice(0, 10)
const startOfDay = (day: string) => new Date(day + 'T00:00:00.000Z')
export const endOfDay = (day: string) => new Date(day + 'T23:59:59.999Z')

export function ReferenceControls({ onApply }: { onApply: (query: string) => void }) {
  const [mode, setMode] = useState('recent')
  const [error, setError] = useState('')

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const date = String(fields.get('through') ?? '')
    const query = new URLSearchParams()
    if (date && date !== today()) query.set('through', endOfDay(date).toISOString())
    if (mode === 'fixed') {
      const start = startOfDay(String(fields.get('referenceStart')))
      const end = endOfDay(String(fields.get('referenceEnd')))
      const through = endOfDay(date || today())
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end > through) {
        setError('Choose a reference period that ends by the review date.')
        return
      }
      query.set('reference_start', start.toISOString())
      query.set('reference_end', new Date(Math.min(end.getTime(), Date.now())).toISOString())
    }
    setError('')
    onApply(query.toString())
  }

  return <form className="surface form-panel crew-reference-form" onSubmit={apply}>
    <div className="section-heading"><h2><CalendarRange size={18} aria-hidden="true" /> Reference period</h2></div>
    <div className="measurement-fields">
      <label>History<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="recent">30 days before each latest reading</option><option value="fixed">Fixed historical period</option>
      </select></label>
      <label>Review date (UTC)<input name="through" type="date" max={today()} /></label>
      {mode === 'fixed' && <>
        <label>Reference start (UTC)<input name="referenceStart" type="date" max={today()} required /></label>
        <label>Reference end (UTC)<input name="referenceEnd" type="date" max={today()} required /></label>
      </>}
    </div>
    <div className="form-actions"><button className="button secondary">Apply period</button></div>
    {error && <p className="form-feedback" role="alert">{error}</p>}
  </form>
}

export function DemoMonitoring({ crewId, reachable, refreshKey }: { crewId: string; reachable: boolean; refreshKey?: string }) {
  const [request, setRequest] = useState({ query: '', revision: 0 })
  const [state, setState] = useState<{ report?: IndicatorReport; error?: string }>()
  useEffect(() => {
    if (!reachable) return
    const controller = new AbortController()
    void api.monitoring(crewId, new URLSearchParams(request.query), controller.signal).then(report => {
      if (!controller.signal.aborted) setState({ report })
    }, error => {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'The reference is unavailable.' })
    })
    return () => controller.abort()
  }, [crewId, reachable, request, refreshKey])

  return <div className="crew-monitoring-stack">
    <ReferenceControls onApply={query => { setState(undefined); setRequest(current => ({ query, revision: current.revision + 1 })) }} />
    {!reachable ? <p className="notice" role="status">Connect to the local API to review personal indicators.</p>
      : state?.report ? <IndicatorCards indicators={state.report.indicators} />
        : <p className="notice" role="status">{state?.error ?? 'Loading personal indicators…'}</p>}
    <p className="muted">The demo compares dates and measurement types from the selected crew member’s recorded history. The observation band describes that history.</p>
  </div>
}
