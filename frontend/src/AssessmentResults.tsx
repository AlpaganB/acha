import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, Plus, RefreshCw, TriangleAlert, Clock3, Info, CircleCheck } from 'lucide-react'
import { api, type Assessment, type EngineFinding } from './api'
import { formatDate, humanize, symptomLabel } from './content'
import { navigate } from './navigation'
import type { QueuedAssessment } from './storage'

interface RecordsProps {
  records: Assessment[]
  queued: QueuedAssessment[]
  syncIssues: Record<string, string>
  available: boolean
  pending: boolean
  limit?: number
}

function recordTitle(input: Assessment | QueuedAssessment['input']) {
  return input.symptoms.length
    ? input.symptoms.map(symptom => symptomLabel(symptom.code)).join(', ')
    : 'Measurement review'
}

function statusStyle(status: string) {
  if (status === 'urgent') return 'urgent'
  if (['pending', 'review', 'insufficient_data', 'needs_attention', 'saved_locally'].includes(status)) return 'pending'
  if (['completed', 'demo_reviewed'].includes(status)) return 'completed'
  return ''
}

function StatusBadge({ status }: { status: string }) {
  const style = statusStyle(status)
  const Icon = style === 'urgent' ? TriangleAlert : style === 'pending' ? Clock3 : style === 'completed' ? CircleCheck : Info
  return <span className={`record-status ${style}`}><Icon size={12} aria-hidden="true" />{humanize(status)}</span>
}

function findingText(finding: EngineFinding) {
  const metricLabels: Record<string, string> = {
    spo2: 'Blood oxygen', systolic_bp: 'Systolic blood pressure', temperature: 'Body temperature',
  }
  const metric = finding.metric ? metricLabels[finding.metric] ?? humanize(finding.metric) : null
  switch (finding.code) {
    case 'reported_symptom': return finding.symptom
      ? `Reported symptom · ${symptomLabel(finding.symptom)}` : 'Reported symptom'
    case 'unknown_symptom': return `This profile has no rule for ${symptomLabel(finding.symptom ?? 'this symptom')}.`
    case 'news2_missing_context': return 'The crew context required for NEWS2 is unavailable.'
    case 'news2_missing_measurement':
    case 'missing_measurement': return `${metric ?? 'Measurement'} is missing.`
    default: return [humanize(finding.code.replace(/^news2_/, '')), metric,
      finding.observed !== null && `${finding.observed}${finding.unit ? ` ${finding.unit}` : ''}`]
      .filter(item => item !== false && item !== null).join(' · ')
  }
}

export function Records({ records, queued, syncIssues, available, pending, limit }: RecordsProps) {
  const saved = new Set(records.map(record => record.id))
  const items = [
    ...records.map(record => ({
      id: record.id, title: recordTitle(record), date: record.assessed_at,
      status: record.status,
    })),
    ...queued.filter(item => !saved.has(item.input.id)).map(({ input }) => ({
      id: input.id, title: recordTitle(input), date: input.assessed_at,
      status: syncIssues[input.id] ? 'needs_attention' : 'saved_locally',
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  if (!items.length) {
    return (
      <div className="empty-state" role="status">
        <strong>{pending ? 'Loading assessments…' : available ? 'No assessments yet' : 'Assessment history unavailable'}</strong>
      </div>
    )
  }

  return (
    <ul className="records">
      {items.slice(0, limit).map(item => (
        <li key={item.id}>
          <a className="record-link" href={`/assessments/${item.id}`}>
            <span className="record-label"><strong>{item.title}</strong><small>{formatDate(item.date)}</small></span>
            <StatusBadge status={item.status} />
            <ChevronRight size={16} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  )
}

interface ResultProps {
  id: string
  crewId?: string
  record?: Assessment
  queued?: QueuedAssessment
  syncIssue?: string
  reachable: boolean
  pending: boolean
  onRecord: (record: Assessment) => void
  onDiscard: (id: string) => void
}

export function AssessmentResult({
  id, crewId, record, queued, syncIssue, reachable, pending, onRecord, onDiscard,
}: ResultProps) {
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const queuedLocally = Boolean(queued)
  const waiting = record?.status === 'pending'

  useEffect(() => {
    if (!crewId || !reachable || queuedLocally) return
    let active = true
    const load = async () => {
      try {
        const result = await api.assessment(crewId, id)
        if (!active) return
        onRecord(result)
        setLoadError('')
      } catch (reason) {
        if (active) setLoadError(reason instanceof Error ? reason.message : 'The result could not be loaded.')
      }
    }
    void load()
    const interval = waiting ? window.setInterval(() => void load(), 12_000) : undefined
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [crewId, id, onRecord, queuedLocally, reachable, waiting])

  async function evaluate() {
    if (!crewId || evaluating) return
    setEvaluating(true)
    setError('')
    try {
      onRecord(await api.evaluate(crewId, id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The assessment could not be evaluated.')
    } finally {
      setEvaluating(false)
    }
  }

  const input = record ?? queued?.input
  const status = record?.status ?? (syncIssue ? 'needs_attention' : 'saved_locally')
  const findings = [...new Set(record?.engine_result?.rationale.map(findingText))]
  const engine = record?.engine_result

  return (
    <>
      <a className="back-link" href="/assessments"><ArrowLeft size={16} aria-hidden="true" /> All assessments</a>
      <header className="page-title">
        <h1>Assessment result</h1>
        {input && <p>{formatDate(input.assessed_at)}</p>}
      </header>
      {input ? (
        <section className="surface result-panel">
          <div className="section-heading">
            <h2>{recordTitle(input)}</h2>
            <StatusBadge status={status} />
          </div>
          <div aria-live="polite">
            {queuedLocally && !record && <p>{syncIssue
              ? 'This assessment is still saved on this device. The mission service did not accept it.'
              : 'This assessment is saved on this device and will be sent when the mission service is reachable.'}</p>}
            {waiting && <p>This assessment was recorded without a result. Run the demonstration engine to review it.</p>}
            {record?.status === 'demo_reviewed' && <p className="notice">This example uses synthetic data for demonstration.</p>}
            {record?.engine_result && <p className="notice">Demonstration rules. Follow mission-approved procedures for medical decisions.</p>}
            {record?.rationale && <div className="result-block"><h3>Rationale</h3><p>{record.rationale}</p></div>}
            {record?.engine_result && (
              <details className="engine-details">
                <summary>Assessment evidence</summary>
                <p>Engine {record.engine_result.engine_version} · Profile {record.engine_result.profile_version}</p>
                {record.engine_result.news2 && <p>{record.engine_result.news2.complete
                  ? `NEWS2 reference score: ${record.engine_result.news2.total_score}`
                  : 'NEWS2 reference score unavailable because the required observations are incomplete.'}</p>}
                {findings.length > 0 && (
                  <ul>{findings.map(finding => <li key={finding}>{finding}</li>)}</ul>
                )}
              </details>
            )}
            {record?.next_step && <div className="result-block"><h3>Next step</h3><p>{record.next_step}</p></div>}
            {engine?.comparisons && Object.keys(engine.comparisons).length > 0 && (
              <div className="result-block">
                <h3>Compared with previous readings</h3>
                <p>Reference uses up to {engine.comparison_window_days} days of earlier readings for this crew member.</p>
                <dl className="detail-list">{Object.entries(engine.comparisons).map(([metric, comparison]) => (
                  <div key={metric}>
                    <dt>{humanize(metric)}</dt>
                    <dd>{!comparison.usable ? 'Check the entered reading.' : comparison.difference === null
                      ? `${comparison.observed} ${comparison.unit}. ${comparison.samples} of ${engine.comparison_min_samples} prior readings needed for a reference.`
                      : `${comparison.observed} ${comparison.unit} · Prior median ${comparison.reference} ${comparison.unit} (${comparison.samples} readings) · Change ${comparison.difference > 0 ? '+' : ''}${comparison.difference} ${comparison.unit}`}
                      {comparison.usable && comparison.median_absolute_deviation != null && (
                        <small className="muted">Median distance from prior median: {comparison.median_absolute_deviation} {comparison.unit}</small>
                      )}</dd>
                  </div>
                ))}</dl>
              </div>
            )}
          </div>
          {(syncIssue || error) && <p className="notice error" role="alert">{syncIssue || error}</p>}
          <dl className="detail-list">
            {input.symptoms.length > 0 && <div><dt>Reported symptoms</dt><dd>
              {input.symptoms.map(symptom => symptomLabel(symptom.code)
                + (symptom.severity === null ? '' : ` (${symptom.severity}/10)`)).join(', ')}
            </dd></div>}
            <div><dt>Measurements attached</dt><dd>{input.measurement_ids.length}</dd></div>
            {input.notes && <div><dt>Notes</dt><dd>{input.notes}</dd></div>}
          </dl>
          <div className="form-actions">
            {record?.protocol_id && (
              <a className="button primary" href={`/guides/${encodeURIComponent(record.protocol_id)}`}>
                Open referenced guide <ArrowRight size={17} aria-hidden="true" />
              </a>
            )}
            {waiting && <button className="button secondary" disabled={!reachable || evaluating}
              onClick={() => void evaluate()}>
              <RefreshCw size={16} aria-hidden="true" /> Run assessment
            </button>}
            {syncIssue && (confirmDiscard ? <>
              <button className="button danger" onClick={() => { onDiscard(id); navigate('/assessments') }}>
                Confirm discard
              </button>
              <button className="button secondary" onClick={() => setConfirmDiscard(false)}>Keep saved copy</button>
            </> : <button className="button secondary" onClick={() => setConfirmDiscard(true)}>Discard local copy</button>)}
          </div>
        </section>
      ) : (
        <p className="notice" role="status">{loadError || (reachable || pending
          ? 'Loading assessment…' : 'This assessment is unavailable on this device.')}</p>
      )}
    </>
  )
}

export function AssessmentHistory(props: RecordsProps) {
  return (
    <>
      <header className="page-title split">
        <h1>Assessments</h1>
        <a className="button primary" href="/assessment"><Plus size={18} aria-hidden="true" /> Start assessment</a>
      </header>
      <section className="surface"><Records {...props} /></section>
    </>
  )
}
