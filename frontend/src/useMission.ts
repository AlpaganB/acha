import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type Assessment, type AssessmentInput, type Measurement } from './api'
import {
  listQueued, queueAssessment, readLocal, removeQueued, saveLocal,
  type Workspace,
} from './storage'

export function useMission() {
  const [online, setOnline] = useState(navigator.onLine)
  const [workspace, setWorkspace] = useState(() => readLocal<Workspace>('workspace'))
  const [crewId, setCrewId] = useState(() => readLocal<string>('crew'))
  const [connection, setConnection] = useState<'checking' | 'connected' | 'unreachable'>('checking')
  const [measurements, setMeasurements] = useState<{ crewId: string; records: Measurement[] }>()
  const [history, setHistory] = useState<Record<string, Assessment[]>>({})
  const [queued, setQueued] = useState(() => listQueued())
  const [syncIssues, setSyncIssues] = useState<Record<string, string>>({})
  const [changingProfile, setChangingProfile] = useState(false)
  const syncing = useRef(false)
  const profileWrite = useRef(false)
  const workspaceRequest = useRef(0)
  const selected = workspace?.crew.find(crew => crew.id === crewId) ?? workspace?.crew[0]
  const activeCrewId = selected?.id
  const reachable = online && connection === 'connected'

  const refreshWorkspace = useCallback(async (signal?: AbortSignal) => {
    if (profileWrite.current) return
    const request = ++workspaceRequest.current
    try {
      const [crew, profiles] = await Promise.all([api.crew(), api.profiles()])
      if (signal?.aborted || request !== workspaceRequest.current) return
      setWorkspace({ crew, profiles })
      setConnection('connected')
    } catch {
      if (!signal?.aborted && request === workspaceRequest.current) setConnection('unreachable')
    }
  }, [])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const updateQueue = () => setQueued(listQueued())
    window.addEventListener('storage', updateQueue)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('storage', updateQueue)
    }
  }, [])

  useEffect(() => {
    if (!online) return
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
  }, [online, refreshWorkspace])

  useEffect(() => {
    if (!activeCrewId || !reachable) return
    let active = true

    void api.measurements(activeCrewId).then(records => {
      if (!active) return
      saveLocal(`measurements.${activeCrewId}`, records)
      setMeasurements({ crewId: activeCrewId, records })
    }).catch(() => {})

    void api.assessments(activeCrewId).then(records => {
      if (!active) return
      setHistory(current => {
        const byId = new Map(records.map(record => [record.id, record]))
        for (const record of current[activeCrewId] ?? []) {
          const incoming = byId.get(record.id)
          if (!incoming || (incoming.status === 'pending' && record.status !== 'pending')) {
            byId.set(record.id, record)
          }
        }
        return { ...current, [activeCrewId]: sortAssessments([...byId.values()]) }
      })
    }).catch(() => {})

    return () => { active = false }
  }, [activeCrewId, reachable])

  useEffect(() => {
    for (const [crewId, records] of Object.entries(history)) saveLocal(`history.${crewId}`, records)
  }, [history])

  const remember = useCallback((record: Assessment) => {
    setHistory(current => {
      const crewId = record.crew_member_id
      const previous = current[crewId] ?? readLocal<Assessment[]>(`history.${crewId}`) ?? []
      const existing = previous.find(item => item.id === record.id)
      if (existing && existing.status !== 'pending' && record.status === 'pending') return current
      return {
        ...current,
        [crewId]: sortAssessments([record, ...previous.filter(item => item.id !== record.id)]),
      }
    })
  }, [])

  useEffect(() => {
    if (!reachable) return
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
  }, [reachable, remember, syncIssues])

  function selectCrew(id: string) {
    setCrewId(id)
    saveLocal('crew', id)
  }

  async function changeProfile(profileId: string) {
    if (!selected || !reachable || profileWrite.current) return false
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
    if (workspace) saveLocal('workspace', workspace)
  }, [workspace])

  async function submit(input: AssessmentInput) {
    if (!selected) throw new Error('Choose a crew member before submitting.')
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

  function discard(id: string) {
    removeQueued(id)
    setQueued(listQueued())
  }

  const profile = workspace?.profiles.find(profile => profile.id === selected?.mission_profile_id)

  return {
    online,
    connection,
    reachable,
    crew: workspace?.crew ?? [],
    profiles: workspace?.profiles ?? [],
    selected,
    profile,
    measurements: measurements?.crewId === activeCrewId
      ? measurements?.records ?? []
      : readLocal<Measurement[]>(`measurements.${activeCrewId}`) ?? [],
    history: activeCrewId ? history[activeCrewId]
      ?? readLocal<Assessment[]>(`history.${activeCrewId}`) ?? [] : [],
    queued: queued.filter(entry => entry.crewId === activeCrewId),
    syncIssues,
    changingProfile,
    selectCrew,
    changeProfile,
    refreshWorkspace,
    remember,
    submit,
    discard,
  }
}

function sortAssessments(records: Assessment[]) {
  return records.sort((a, b) => Date.parse(b.assessed_at) - Date.parse(a.assessed_at)).slice(0, 20)
}
