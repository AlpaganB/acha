import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ClipboardList, CloudUpload, Plus, RefreshCw } from 'lucide-react'
import { api, type Assessment, type EngineFinding } from './api'
import { formatDate, humanize, symptomLabel } from './content'
import type { QueuedAssessment } from './storage'

interface RecordsProps {
  records: Assessment[]
  queued: QueuedAssessment[]
  syncIssues: Record<string, string>
  crewAvailable: boolean
}

function recordTitle(input: Assessment | QueuedAssessment['input']) {
  return input.symptoms.length
    ? input.symptoms.map(symptom => symptomLabel(symptom.code)).join(', ')
    : 'Measurement review'
}

function statusStyle(status: string) {
  if (status === 'urgent') return 'urgent'
  if (['pending', 'review', 'insufficient_data', 'needs_attention', 'saved_locally'].includes(status)) return 'pending'
  return ''
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

export function Records({ records, queued, syncIssues, crewAvailable }: RecordsProps) {
  const saved = new Set(records.map(record => record.id))
  const items = [
    ...records.map(record => ({
      id: record.id, title: recordTitle(record), date: record.assessed_at,
      status: record.status, local: false,
    })),
    ...queued.filter(item => !saved.has(item.input.id)).map(({ input }) => ({
      id: input.id, title: recordTitle(input), date: input.assessed_at,
      status: syncIssues[input.id] ? 'needs_attention' : 'saved_locally', local: true,
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  if (!items.length) {
    return (
      <div className="empty-state">
        <span className="icon-tile"><ClipboardList size={21} aria-hidden="true" /></span>
        <div><strong>{crewAvailable ? 'No assessments yet' : 'Assessment history unavailable'}</strong>
          <p>{crewAvailable ? 'Saved assessments will appear here.' : 'Connect to the mission service to load your crew records.'}</p></div>
      </div>
    )
  }

  return (
    <ul className="records">
      {items.map(item => (
        <li key={item.id}>
          <a className="record-link" href={`#results/${item.id}`}>
            <span className="icon-tile">
              {item.local ? <CloudUpload size={19} aria-hidden="true" /> : <ClipboardList size={19} aria-hidden="true" />}
            </span>
            <span className="record-label"><strong>{item.title}</strong><small>{formatDate(item.date)}</small></span>
            <span className={`record-status ${statusStyle(item.status)}`}>
              {humanize(item.status)}
            </span>
            <ArrowRight size={17} aria-hidden="true" />
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
  onRecord: (record: Assessment) => void
  onDiscard: (id: string) => void
}

export function AssessmentResult({
  id, crewId, record, queued, syncIssue, reachable, onRecord, onDiscard,
}: ResultProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const queuedLocally = Boolean(queued)
  const waiting = record?.status === 'pending'

  useEffect(() => {
    if (!crewId || !reachable || queuedLocally) return
    let active = true
    const load = async (showProgress: boolean) => {
      if (showProgress) setLoading(true)
      try {
        const result = await api.assessment(crewId, id)
        if (!active) return
        onRecord(result)
        setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'The result could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load(true)
    const interval = waiting ? window.setInterval(() => void load(false), 12_000) : undefined
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [crewId, id, onRecord, queuedLocally, reachable, waiting])

  async function evaluate() {
    if (!crewId || loading) return
    setLoading(true)
    setError('')
    try {
      onRecord(await api.evaluate(crewId, id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The assessment could not be evaluated.')
    } finally {
      setLoading(false)
    }
  }

  const input = record ?? queued?.input
  const status = record?.status ?? (syncIssue ? 'needs_attention' : 'saved_locally')
  const findings = [...new Set(record?.engine_result?.rationale.map(findingText))]

  return (
    <>
      <a className="back-link" href="#results"><ArrowLeft size={16} aria-hidden="true" /> All assessments</a>
      <header className="page-title">
        <h1>Assessment result</h1>
        {input && <p>{formatDate(input.assessed_at)}</p>}
      </header>
      {input ? (
        <section className="surface result-panel">
          <div className="section-heading">
            <h2>{recordTitle(input)}</h2>
            <span className={`record-status ${statusStyle(status)}`}>{humanize(status)}</span>
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
              <a className="button primary" href={`#guides/${encodeURIComponent(record.protocol_id)}`}>
                Open referenced guide <ArrowRight size={17} aria-hidden="true" />
              </a>
            )}
            {waiting && <button className="button secondary" disabled={!reachable || loading}
              onClick={() => void evaluate()}>
              <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Checking…' : 'Run assessment'}
            </button>}
            {syncIssue && (confirmDiscard ? <>
              <button className="button danger" onClick={() => { onDiscard(id); window.location.hash = 'results' }}>
                Confirm discard
              </button>
              <button className="button secondary" onClick={() => setConfirmDiscard(false)}>Keep saved copy</button>
            </> : <button className="button secondary" onClick={() => setConfirmDiscard(true)}>Discard local copy</button>)}
          </div>
        </section>
      ) : (
        <p className="notice" role="status">{error || (loading || reachable
          ? 'Loading assessment…' : 'This assessment is unavailable on this device.')}</p>
      )}
    </>
  )
}

export function AssessmentHistory(props: RecordsProps) {
  return (
    <>
      <header className="page-title split">
        <div><h1>Assessments</h1><p>Review submitted results and assessments saved on this device.</p></div>
        <a className="button primary" href="#assessment"><Plus size={18} aria-hidden="true" /> Start assessment</a>
      </header>
      <section className="surface"><Records {...props} /></section>
    </>
  )
}
