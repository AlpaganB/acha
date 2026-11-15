import { useEffect, useRef, useState } from 'react'
import { observationsApi, type HealthReviewAction, type HealthReviewDecision, type HealthReviewReport, type ParameterDefinition } from './api'
import { utcTime } from './ObservationTrends'

const format = new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 7 })
const values = (value: number, unit: string) => format.format(value) + ' ' + unit
const utc = (value: string) => utcTime.format(new Date(value)) + ' UTC'
const comparators = { minimum_inclusive: '≥', maximum_inclusive: '≤', maximum_exclusive: '<' }
const outcomes: Record<HealthReviewDecision['status'], string> = {
  insufficient_data: 'Insufficient evidence',
  boundary_uncertain: 'Uncertain at the boundary',
  within_rule: 'Within this rule',
  review_required: 'Clinical review required',
}
const actions: Record<HealthReviewAction, string> = {
  reviewed: 'Reviewed',
  recheck_requested: 'Repeat measurement requested',
  referred_to_flight_team: 'Referred to flight team',
}

function EvidenceRow({ row, onRecord, busy }: {
  row: HealthReviewDecision
  onRecord: (key: string, action: HealthReviewAction) => Promise<void>
  busy: boolean
}) {
  const [action, setAction] = useState<HealthReviewAction | ''>('')
  const needsReview = row.status === 'review_required' || row.status === 'boundary_uncertain'
  return <article className="crew-dose-channel">
    <div className="section-heading"><h3>{row.title}</h3><strong>{outcomes[row.status]}</strong></div>
    <p>{row.explanation}</p>
    <dl className="detail-list">
      <div><dt>Approved limits</dt><dd>{[
        row.minimum !== null && '≥ ' + values(row.minimum, row.unit),
        row.maximum !== null && (row.maximum_exclusive ? '< ' : '≤ ') + values(row.maximum, row.unit),
      ].filter(Boolean).join(' · ')}</dd></div>
      {row.value !== null && row.lower !== null && row.upper !== null && <div>
        <dt>Result and uncertainty</dt><dd>{values(row.value, row.unit)} · {values(row.lower, row.unit)} to {values(row.upper, row.unit)}
          {row.observed_at && ' · ' + utc(row.observed_at)}</dd></div>}
      <div><dt>Procedure reference</dt><dd>{row.procedure_ref}</dd></div>
      <div><dt>Basis</dt><dd>{row.source_url ? <a className="text-link" href={row.source_url}>{row.evidence}</a> : row.evidence}</dd></div>
    </dl>
    {row.acknowledgment ? <p role="status">{actions[row.acknowledgment.action]} · {row.acknowledgment.actor} · {utc(row.acknowledgment.recorded_at)}</p>
      : needsReview && row.decision_key && <form className="form-actions" onSubmit={event => {
        event.preventDefault()
        if (action && row.decision_key) void onRecord(row.decision_key, action)
      }}>
        <label>Record completed follow-up <select required value={action} disabled={busy}
          onChange={event => setAction(event.target.value as HealthReviewAction | '')}>
          <option value="">Select action</option>
          {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <button className="button secondary" disabled={busy || !action}>Save acknowledgment</button>
      </form>}
  </article>
}

export function HealthReview({ token, mission, crew, definitions, onFindings }: {
  token: string; mission: string; crew: string; definitions: ParameterDefinition[]; onFindings: (count: number | null) => void
}) {
  const [revision, setRevision] = useState(0)
  const [report, setReport] = useState<HealthReviewReport>()
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRequest = useRef<AbortController | null>(null)
  const errorText = (reason: unknown) => reason instanceof Error ? reason.message : 'The health review request failed.'

  useEffect(() => {
    let request: AbortController | undefined
    const load = () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      void observationsApi.healthReview(token, mission, crew, controller.signal).then(value => {
        if (!controller.signal.aborted) {
          setReport(value)
          setLoadError('')
          onFindings(value.decisions.filter(row => row.decision_key && !row.acknowledgment).length)
        }
      }, reason => {
        if (!controller.signal.aborted) { setReport(undefined); setLoadError(errorText(reason)); onFindings(null) }
      })
    }
    load()
    const interval = window.setInterval(load, 30_000)
    return () => { window.clearInterval(interval); request?.abort() }
  }, [token, mission, crew, revision, onFindings])

  useEffect(() => () => savingRequest.current?.abort(), [])

  async function record(decision_key: string, action: HealthReviewAction) {
    if (savingRequest.current) return
    const controller = new AbortController()
    savingRequest.current = controller
    setSaveError('')
    setSaving(true)
    try {
      await observationsApi.acknowledgeHealthReview(token, mission, crew, { decision_key, action }, controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setSaveError(errorText(reason))
    } finally {
      savingRequest.current = null
      if (!controller.signal.aborted) { setSaving(false); setRevision(value => value + 1) }
    }
  }

  if (!report) return <p className="notice" role="status">{loadError || 'Loading the mission medical review…'}
    {!!loadError && <button type="button" className="button secondary" onClick={() => setRevision(value => value + 1)}>Retry</button>}
  </p>

  const attention = report.decisions.filter(row => row.decision_key && !row.acknowledgment).length
  return <div className="crew-monitoring-stack">
    <section className="surface form-panel" aria-labelledby="health-review-heading">
      <div className="section-heading"><h2 id="health-review-heading">Mission medical review</h2>
        <span className="muted">Evaluated {utc(report.evaluated_at)}</span>
        <button type="button" className="button secondary" onClick={() => setRevision(value => value + 1)}>Refresh review</button>
      </div>
      {report.policy ? <>
        <p>Mission policy {report.policy.version}. Follow the recorded procedure and document the clinical follow-up here.</p>
        <div className="detail-list">
          {report.policy.flight_medicine && <p>Flight medicine · {report.policy.flight_medicine.authority} · {report.policy.flight_medicine.reference}</p>}
          {report.policy.radiation_safety && <p>Radiation safety · {report.policy.radiation_safety.authority} · {report.policy.radiation_safety.reference}</p>}
        </div>
        {attention > 0 && <p className="notice" role="status">{attention} findings awaiting acknowledgment.</p>}
        {saveError && <p className="form-feedback" role="alert">{saveError}</p>}
        {report.decisions.map(row => <EvidenceRow key={row.decision_key ?? row.rule_id} row={row} busy={saving} onRecord={record} />)}
      </> : <p className="notice" role="status">Awaiting a documented mission approval. Published references are available below.</p>}
    </section>
    {report.recent_acknowledgments.length > 0 && <section className="surface form-panel">
      <details className="research-observations"><summary>Recent recorded follow-up</summary>
        <dl className="detail-list">{report.recent_acknowledgments.map(row => <div key={row.decision_key}>
          <dt>{row.title} · Policy {row.policy_version}</dt>
          <dd>{actions[row.action]} · {row.actor} · {utc(row.recorded_at)}</dd>
        </div>)}</dl>
      </details>
    </section>}
    <section className="surface form-panel" aria-labelledby="reviewed-model-results">
      <h2 id="reviewed-model-results">Externally reviewed radiation results</h2>
      {!report.model_results.length && <p className="muted">Record a reviewed dose or cancer-risk result from its source report in Records.</p>}
      {report.model_results.map(item => item.context?.kind === 'radiation_assessment' && <article className="crew-dose-channel" key={item.id}>
        <h3>{definitions.find(row => row.id === item.parameter)?.label ?? item.parameter}{item.context.tissue && ' · ' + item.context.tissue.replaceAll('_', ' ')}</h3>
        <dl className="detail-list">
          <div><dt>Reported result</dt><dd>{values(item.value!, item.unit)} · {values(item.context.lower, item.unit)} to {values(item.context.upper, item.unit)}
            {' '}({item.context.interval_description})</dd></div>
          <div><dt>Exposure period</dt><dd>{utc(item.context.exposure_start)} to {utc(item.context.exposure_end)}
            {!item.context.complete_history && ' · Partial or unknown coverage'}</dd></div>
          <div><dt>Model and evidence</dt><dd>{item.context.model} · {item.context.model_version} · {item.context.source_ref}
            {' '}· Inputs {item.context.input_manifest_ref} · Review {item.context.review_ref}</dd></div>
        </dl>
      </article>)}
      <div className="form-actions">
        <a className="text-link" href="https://ntrs.nasa.gov/citations/20210013314">NASA Space Cancer Risk model</a>
        <a className="text-link" href="https://oltaris.nasa.gov/">NASA OLTARIS</a>
      </div>
    </section>
    <section className="surface form-panel">
      <details className="research-observations"><summary>Published NASA reference criteria</summary>
        <div className="research-table" tabIndex={0} role="region" aria-label="NASA health reference criteria">
          <table><thead><tr><th scope="col">Reference</th><th scope="col">Criterion</th><th scope="col">Required evidence</th></tr></thead>
            <tbody>{report.references.map(row => <tr key={row.rule_id}>
              <th scope="row">{row.title} <a className="text-link" href={row.source_url}>{row.requirement}</a></th>
              <td>{comparators[row.comparator]} {values(row.limit, row.unit)}</td><td>{row.required_evidence}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  </div>
}
