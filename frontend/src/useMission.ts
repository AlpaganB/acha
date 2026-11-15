import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type Assessment, type AssessmentInput, type Measurement, type MeasurementInput } from './api'
import { localMission, scenarioKey, scenarioWorkspace } from './localScenario'
import {
  listQueued, queueAssessment, readLocal, removeQueued, saveLocal,
  type Workspace,
} from './storage'

type CrewRecords<T> = Record<string, T[] | null>

export function useMission(local: boolean) {
  const records = local ? localMission : api
  const [online, setOnline] = useState(navigator.onLine)
  const [workspace, setWorkspace] = useState(() => local ? scenarioWorkspace : readLocal<Workspace>('active-workspace'))
  const [crewId, setCrewId] = useState(() => local ? null : readLocal<string>('crew'))
  const [connection, setConnection] = useState<'checking' | 'connected' | 'unreachable'>('checking')
  const [measurements, setMeasurements] = useState<CrewRecords<Measurement>>({})
  const [history, setHistory] = useState<CrewRecords<Assessment>>({})
  const [queued, setQueued] = useState(() => local ? [] : listQueued())
  const [scenarioRevision, setScenarioRevision] = useState(0)
  const [syncIssues, setSyncIssues] = useState<Record<string, string>>({})
  const [changingProfile, setChangingProfile] = useState(false)
  const syncing = useRef(false)
  const profileWrite = useRef(false)
  const workspaceRequest = useRef(0)
  const measurementRevisions = useRef(new Map<string, number>())
  const selected = workspace?.crew.find(crew => crew.id === crewId) ?? workspace?.crew[0]
  const activeCrewId = selected?.id
  const reachable = local || (online && connection === 'connected')

  const refreshWorkspace = useCallback(async (signal?: AbortSignal) => {
    if (local || profileWrite.current) return
    const request = ++workspaceRequest.current
    try {
      const [crew, profiles] = await Promise.all([api.crew(), api.profiles()])
      if (signal?.aborted || request !== workspaceRequest.current) return
      setWorkspace({ crew, profiles })
      setConnection('connected')
    } catch {
      if (!signal?.aborted && request === workspaceRequest.current) setConnection('unreachable')
    }
  }, [local])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const updateQueue = (event: StorageEvent) => {
      if (!local) setQueued(listQueued())
      else if (event.key?.endsWith(`.${scenarioKey}`)) setScenarioRevision(value => value + 1)
    }
    window.addEventListener('storage', updateQueue)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('storage', updateQueue)
    }
  }, [local])

  useEffect(() => {
    if (local || !online) return
    const controller = new AbortController()
    const refresh = () => {
      if (!profileWrite.current) void refreshWorkspace(controller.signal)
    }
    refresh()
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [local, online, refreshWorkspace])

  useEffect(() => {
    if (!activeCrewId || !reachable) return
    let active = true
    const revision = measurementRevisions.current.get(activeCrewId)

    void records.measurements(activeCrewId).then(items => {
      if (!active || revision !== measurementRevisions.current.get(activeCrewId)) return
      if (!local) saveLocal(`measurements.${activeCrewId}`, items)
      setMeasurements(current => ({ ...current, [activeCrewId]: items }))
    }).catch(() => {
      if (active) setMeasurements(current => ({ ...current, [activeCrewId]: current[activeCrewId] ?? null }))
    })

    void records.assessments(activeCrewId).then(items => {
      if (!active) return
      setHistory(current => {
        const byId = new Map(items.map(record => [record.id, record]))
        for (const record of current[activeCrewId] ?? []) {
          const incoming = byId.get(record.id)
          if (!incoming || (incoming.status === 'pending' && record.status !== 'pending')) {
            byId.set(record.id, record)
          }
        }
        return { ...current, [activeCrewId]: sortAssessments([...byId.values()]) }
      })
    }).catch(() => {
      if (active) setHistory(current => ({ ...current, [activeCrewId]: current[activeCrewId] ?? null }))
    })

    return () => { active = false }
  }, [activeCrewId, local, reachable, records, scenarioRevision])

  useEffect(() => {
    if (local) return
    for (const [crewId, records] of Object.entries(history)) {
      if (records) saveLocal(`history.${crewId}`, records)
    }
  }, [history, local])

  const remember = useCallback((record: Assessment) => {
    setHistory(current => {
      const crewId = record.crew_member_id
      const previous = current[crewId] ?? (local ? null : readLocal<Assessment[]>(`history.${crewId}`)) ?? []
      const existing = previous.find(item => item.id === record.id)
      if (existing && existing.status !== 'pending' && record.status === 'pending') return current
      return {
        ...current,
        [crewId]: sortAssessments([record, ...previous.filter(item => item.id !== record.id)]),
      }
    })
  }, [local])

  useEffect(() => {
    if (local || !reachable) return
    const flush = async () => {
      if (syncing.current) return
      syncing.current = true
      try {
        for (const entry of listQueued()) {
          if (syncIssues[entry.input.id]) continue
          try {
            const record = await api.submit(entry.crewId, entry.input)
            remember(record)
            removeQueued(entry.input.id)
          } catch (error) {
            if (!(error instanceof ApiError) || error.retryable) break
            setSyncIssues(current => ({ ...current, [entry.input.id]: error.message }))
          }
        }
        setQueued(listQueued())
      } finally {
        syncing.current = false
      }
    }
    void flush()
    const retry = window.setInterval(() => void flush(), 15_000)
    return () => window.clearInterval(retry)
  }, [local, reachable, remember, syncIssues])

  function selectCrew(id: string) {
    setCrewId(id)
    if (!local) saveLocal('crew', id)
  }

  async function changeProfile(profileId: string) {
    if (local || !selected || !reachable || profileWrite.current) return false
    profileWrite.current = true
    workspaceRequest.current++
    setChangingProfile(true)
    try {
      const updated = await api.setProfile(selected.id, profileId)
      setWorkspace(current => current && ({
        ...current,
        crew: current.crew.map(crew => crew.id === updated.id ? updated : crew),
      }))
      return true
    } finally {
      profileWrite.current = false
      setChangingProfile(false)
    }
  }

  useEffect(() => {
    if (!local && workspace) saveLocal('active-workspace', workspace)
  }, [local, workspace])

  async function submit(input: AssessmentInput) {
    if (!selected) throw new Error('Choose a crew member before submitting.')
    if (local) {
      const record = await localMission.submit(selected.id, input)
      remember(record)
      return record
    }
    if (online) {
      try {
        const record = await api.submit(selected.id, input)
        remember(record)
        return record
      } catch (error) {
        if (!(error instanceof ApiError) || !error.retryable) throw error
        setConnection('unreachable')
      }
    }
    if (!queueAssessment({ crewId: selected.id, input })) {
      throw new Error('This device could not save the assessment. Keep this screen open and try again.')
    }
    setQueued(listQueued())
    return null
  }

  async function recordMeasurement(input: MeasurementInput) {
    if (!activeCrewId) throw new Error('Choose a crew member before saving.')
    const saved = await records.recordMeasurement(activeCrewId, input)
    measurementRevisions.current.set(activeCrewId, (measurementRevisions.current.get(activeCrewId) ?? 0) + 1)
    const previous = measurements[activeCrewId] ?? (local ? null : readLocal<Measurement[]>(`measurements.${activeCrewId}`)) ?? []
    const updated = [saved, ...previous.filter(record => record.id !== saved.id)]
      .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)).slice(0, 12)
    if (!local) saveLocal(`measurements.${activeCrewId}`, updated)
    setMeasurements(current => ({ ...current, [activeCrewId]: updated }))
    return saved
  }

  function discard(id: string) {
    removeQueued(id)
    setQueued(listQueued())
  }

  const profile = workspace?.profiles.find(profile => profile.id === selected?.mission_profile_id)
  const measurementsForCrew = activeCrewId
    ? measurements[activeCrewId] ?? (local ? null : readLocal<Measurement[]>(`measurements.${activeCrewId}`)) : null
  const historyForCrew = activeCrewId
    ? history[activeCrewId] ?? (local ? null : readLocal<Assessment[]>(`history.${activeCrewId}`)) : null
  const connecting = !local && online && connection === 'checking'

  return {
    online,
    connection: local ? 'connected' : connection,
    local,
    records,
    reachable,
    crew: workspace?.crew ?? [],
    profiles: workspace?.profiles ?? [],
    selected,
    profile,
    measurements: measurementsForCrew ?? [],
    measurementsPending: !measurementsForCrew && (connecting || (
      reachable && Boolean(activeCrewId && measurements[activeCrewId] === undefined)
    )),
    measurementsAvailable: measurementsForCrew !== null,
    history: historyForCrew ?? [],
    historyPending: !historyForCrew && (connecting || (
      reachable && Boolean(activeCrewId && history[activeCrewId] === undefined)
    )),
    historyAvailable: historyForCrew !== null,
    queued: queued.filter(entry => entry.crewId === activeCrewId),
    syncIssues,
    changingProfile,
    selectCrew,
    changeProfile,
    refreshWorkspace,
    remember,
    submit,
    recordMeasurement,
    discard,
  }
}

function sortAssessments(records: Assessment[]) {
  return records.sort((a, b) => Date.parse(b.assessed_at) - Date.parse(a.assessed_at)).slice(0, 20)
}
