import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, ChevronDown, Radio, WifiOff,
} from 'lucide-react'
import { AssessmentForm } from './AssessmentForm'
import { AssessmentHistory, AssessmentResult, Records } from './AssessmentResults'
import { Guidance } from './Guidance'
import { Measurements } from './Measurements'
import { Research } from './Research'
import { environmentLabels, formatDate, measurementLabels } from './content'
import { navigate } from './navigation'
import { useMission } from './useMission'
import type { Measurement, MissionProfile } from './api'

type Mission = ReturnType<typeof useMission>

function locationPath() {
  const legacy = window.location.hash.match(/^#(assessment|results|guides|mission)(\/[a-zA-Z0-9_-]+)?$/)
  if (legacy) return `/${legacy[1] === 'results' ? 'assessments' : legacy[1]}${legacy[2] ?? ''}`
  return (window.location.pathname.replace(/\/+$/, '') + window.location.search) || '/'
}

function useRoute() {
  const [route, setRoute] = useState(locationPath)
  useEffect(() => {
    const update = () => {
      const path = locationPath()
      if (window.location.hash && path !== window.location.pathname + window.location.search) {
        window.history.replaceState(null, '', path)
      }
      setRoute(path)
    }
    update()
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
    }
  }, [])
  return route
}

function useOfflineShell() {
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {})
  }, [])
}

function LatestMeasurements({ measurements, pending, available }: {
  measurements: Measurement[]; pending: boolean; available: boolean
}) {
  const latest = new Map<string, Measurement>()
  for (const reading of measurements) {
    const previous = latest.get(reading.kind)
    if (!previous || Date.parse(reading.recorded_at) > Date.parse(previous.recorded_at)) {
      latest.set(reading.kind, reading)
    }
  }

  return (
    <section aria-labelledby="measurements-heading">
      <div className="section-heading"><h2 id="measurements-heading">Recent measurements</h2>
        <a className="text-link" href="/measurements">View readings</a>
      </div>
      <dl className="vital-grid surface" aria-busy={pending}>
        {Object.entries(measurementLabels).map(([kind, label]) => {
          const reading = latest.get(kind)
          return (
            <div key={kind}>
              <dt>{label}</dt>
              {reading ? (
                <dd>
                  <span className="vital-value">
                    {reading.value}{reading.diastolic !== null && `/${reading.diastolic}`}
                    <small>{reading.unit}</small>
                  </span>
                  <time dateTime={reading.recorded_at}>{formatDate(reading.recorded_at)}</time>
                </dd>
              ) : <dd className="missing-reading">
                {pending ? <span className="reading-placeholder" aria-hidden="true" />
                  : available ? 'No recent reading' : 'Unavailable'}
              </dd>}
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function Home({ mission }: { mission: Mission }) {
  return (
    <>
      <header className="overview-heading">
        <div>
          <h1>Crew health</h1>
          <p className="crew-context">{mission.selected?.display_name}
            {mission.profile && <> <span aria-hidden="true">/</span> {mission.profile.name}</>}
          </p>
          <div className="overview-actions">
            <a className="button primary" href="/assessment">Start assessment <ArrowRight size={17} aria-hidden="true" /></a>
            <a className="button secondary" href="/measurements">Record measurement</a>
          </div>
        </div>
      </header>
      <div className="home-grid">
        <LatestMeasurements measurements={mission.measurements} pending={mission.measurementsPending}
          available={mission.measurementsAvailable} />
        <section aria-labelledby="recent-heading">
          <div className="section-heading">
            <h2 id="recent-heading">Recent assessments</h2>
            <a className="text-link" href="/assessments">View all</a>
          </div>
          <div className="surface">
            <Records records={mission.history} queued={mission.queued} limit={3} pending={mission.historyPending}
              available={mission.historyAvailable} syncIssues={mission.syncIssues} />
          </div>
        </section>
      </div>
    </>
  )
}

function MissionProfiles({ mission }: { mission: Mission }) {
  const [message, setMessage] = useState<{ body: string; error: boolean }>()

  async function change(profile: MissionProfile) {
    setMessage(undefined)
    try {
      if (await mission.changeProfile(profile.id)) {
        setMessage({ body: `${profile.name} is now active.`, error: false })
      }
    } catch (error) {
      setMessage({ body: error instanceof Error ? error.message : 'The mission profile could not be saved.', error: true })
    }
  }

  return (
    <>
      <header className="page-title"><h1>Mission profile</h1></header>
      <section className="surface crew-panel">
        <label htmlFor="crew-select">Crew member</label>
        <div className="select-wrap">
          <select id="crew-select" value={mission.selected?.id ?? ''} disabled={!mission.crew.length || mission.changingProfile}
            onChange={event => { mission.selectCrew(event.target.value); setMessage(undefined) }}>
            {!mission.crew.length && <option value="">Unavailable</option>}
            {mission.crew.map(crew => <option key={crew.id} value={crew.id}>{crew.display_name}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
      </section>
      {!mission.reachable && (mission.connection !== 'checking' || !mission.online) && <p className="notice" role="status">
        <WifiOff size={18} aria-hidden="true" /> Connect to the mission service to change the active profile.
        {mission.online && <button className="text-link" onClick={() => void mission.refreshWorkspace()}>Retry connection</button>}
      </p>}
      {message && <p className={`notice ${message.error ? 'error' : ''}`}
        role={message.error ? 'alert' : 'status'}>{message.body}</p>}
      {mission.profiles.length > 0 && (
        <div className="profile-grid">
          {mission.profiles.map(profile => {
            const active = profile.id === mission.profile?.id
            return (
              <article key={profile.id} className={`surface profile-card ${active ? 'current' : ''}`}>
                <div className="section-heading"><h2>{profile.name}</h2>
                  {active && <span className="active-profile"><Check size={16} aria-hidden="true" /> Active</span>}
                </div>
                <p>{environmentLabels[profile.environment]}</p>
                <dl className="detail-list">
                  <div><dt>Equipment</dt><dd>{profile.equipment.join(', ') || 'None listed'}</dd></div>
                  {profile.constraints.length > 0 && <div><dt>Constraints</dt><dd>{profile.constraints.join(', ')}</dd></div>}
                </dl>
                {!active && <div className="form-actions">
                  <button className="button secondary" disabled={!mission.reachable || !mission.selected || mission.changingProfile}
                    onClick={() => void change(profile)}>Use this profile</button>
                </div>}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}

export function App() {
  const mission = useMission()
  const route = useRoute()
  useOfflineShell()
  const main = useRef<HTMLElement>(null)
  const previousRoute = useRef(route)
  const [pathname, query] = route.split('?')
  const [, page, rawId] = pathname.split('/')
  const id = rawId && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId) ? rawId : undefined
  const initialMeasurementId = new URLSearchParams(query).get('measurement') ?? undefined
  const home = !['assessment', 'assessments', 'measurements', 'guides', 'mission', 'research'].includes(page)

  useLayoutEffect(() => {
    if (previousRoute.current === route) return
    previousRoute.current = route
    window.scrollTo(0, 0)
    main.current?.focus({ preventScroll: true })
  }, [route])

  const assessmentRecords = {
    records: mission.history,
    queued: mission.queued,
    syncIssues: mission.syncIssues,
    available: mission.historyAvailable,
    pending: mission.historyPending,
  }

  return (
    <div className="app" onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/"]') : null
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return
      event.preventDefault()
      navigate(anchor.pathname + anchor.search)
    }}>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
      <header className="site-header">
        <div className="header-inner">
          <a href="/" className="brand" aria-label="ACHA home">
            <img src={`${import.meta.env.BASE_URL}acha.svg`} width="36" height="36" alt="" />
            <span>ACHA</span>
          </a>
          <nav className="main-nav" aria-label="Primary navigation">
            <a href="/" aria-current={home ? 'page' : undefined}>Overview</a>
            <a href="/measurements" aria-current={page === 'measurements' ? 'page' : undefined}>Measurements</a>
            <a href="/assessments" aria-current={page === 'assessment' || page === 'assessments' ? 'page' : undefined}>Assessments</a>
            <a href="/mission" aria-current={page === 'mission' ? 'page' : undefined}>Mission</a>
            <a href="/guides" aria-label="Emergency guides" aria-current={page === 'guides' ? 'page' : undefined}>Guides</a>
          </nav>
        </div>
      </header>
      <main ref={main} id="main-content" className={`main-content ${home ? 'home' : 'inner-page'}`} tabIndex={-1}>
        <div className="route-content">
          {home && <Home mission={mission} />}
          {page === 'assessment' && (
            <>
              <header className="page-title">
                <h1>Self-assessment</h1>
                <p className="crew-context">{mission.selected?.display_name}</p>
              </header>
              {!mission.selected && (mission.connection !== 'checking' || !mission.online) && <p className="notice" role="status">
                <Radio size={18} aria-hidden="true" /> A crew member must be loaded before saving.
                <a className="text-link" href="/mission">Open mission profile</a>
              </p>}
              <AssessmentForm key={initialMeasurementId} initialMeasurementId={initialMeasurementId}
                crew={mission.selected} measurements={mission.measurements} measurementsPending={mission.measurementsPending}
                reachable={mission.reachable} onSubmit={async input => {
                  await mission.submit(input)
                  navigate(`/assessments/${input.id}`)
                }} />
            </>
          )}
          {page === 'assessments' && (id ? <AssessmentResult key={`${mission.selected?.id}:${id}`} id={id}
            crewId={mission.selected?.id} reachable={mission.reachable} pending={mission.historyPending}
            record={mission.history.find(record => record.id === id)}
            queued={mission.queued.find(entry => entry.input.id === id)}
            syncIssue={mission.syncIssues[id]} onRecord={mission.remember} onDiscard={mission.discard} />
            : <AssessmentHistory {...assessmentRecords} />)}
          {page === 'guides' && <Guidance profile={mission.profile} guideId={id} />}
          {page === 'mission' && <MissionProfiles mission={mission} />}
          {page === 'measurements' && <Measurements crew={mission.selected} measurements={mission.measurements}
            pending={mission.measurementsPending} reachable={mission.reachable} onSave={mission.recordMeasurement} />}
          {page === 'research' && <Research />}
        </div>
      </main>
      <footer className="site-footer">
        <span>Autonomous Crew Health Assistant</span>
        <a className="text-link" href="/research">Research data</a>
      </footer>
    </div>
  )
}
