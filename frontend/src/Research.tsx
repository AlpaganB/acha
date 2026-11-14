import { useEffect, useState } from 'react'
import { api, type ResearchRecord } from './api'

export function Research() {
  const [record, setRecord] = useState<ResearchRecord>()
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    let active = true
    void api.researchRecord().then(data => { if (active) setRecord(data) })
      .catch(() => { if (active) setError('Research data is currently unavailable.') })
    return () => { active = false }
  }, [])

  async function refresh() {
    setRefreshing(true)
    setError('')
    try {
      setRecord(await api.researchRecord(true))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not fetch the source record.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <header className="page-title"><h1>Research record</h1><p>Published hospital observations from PhysioNet BIDMC.</p></header>
      <section className="surface form-panel" aria-busy={!record && !error}>
        {!record ? <p role="status">{error || 'Loading research record…'}</p> : <>
          <h2>{record.record}</h2>
          <p>{record.samples.length} observations · Median heart rate {record.medians.heart_rate} bpm · Median blood oxygen {record.medians.spo2}%</p>
          <div className="research-table"><table>
            <caption>First 12 observations</caption>
            <thead><tr><th scope="col">Second</th><th scope="col">Heart rate</th><th scope="col">Pulse</th><th scope="col">Breathing</th><th scope="col">SpO₂</th></tr></thead>
            <tbody>{record.samples.slice(0, 12).map(sample => <tr key={sample.seconds}>
              <td>{sample.seconds}</td><td>{sample.heart_rate ?? '—'}</td><td>{sample.pulse_rate ?? '—'}</td>
              <td>{sample.respiratory_rate ?? '—'}</td><td>{sample.spo2 ?? '—'}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="form-actions">
            <a className="text-link" href={record.source}>Published dataset</a>
            <button className="button secondary" disabled={refreshing} onClick={() => void refresh()}>Fetch from PhysioNet</button>
          </div>
          <p className="form-feedback" role="status">{error || (record.retrieval === 'physionet'
            ? 'Downloaded from PhysioNet.' : 'Showing the bundled copy of the published record.')}</p>
        </>}
      </section>
    </>
  )
}
