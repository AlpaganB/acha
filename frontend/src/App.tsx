import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, ArrowUpRight, BadgeCheck, BookOpen, ChevronDown,
  ClipboardList, CloudDownload, Orbit, Radio, ShieldAlert, UserRound, WifiOff,
} from 'lucide-react'
import { AssessmentForm } from './AssessmentForm'
import { AssessmentHistory, AssessmentResult, Records } from './AssessmentResults'
import { Guidance } from './Guidance'
import { environmentLabels } from './content'
import { useMission } from './useMission'
import type { MissionProfile } from './api'

type Mission = ReturnType<typeof useMission>

function useRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1))
  useEffect(() => {
    const update = () => setRoute(window.location.hash.slice(1))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

function useOfflineShell() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    const controllerChanged = () => setReady(Boolean(navigator.serviceWorker.controller))
    controllerChanged()
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    void navigator.serviceWorker.register('./service-worker.js').catch(() => {})
    return () => navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged)
  }, [])
  return ready
}

function safeRouteId(value: string | undefined) {
  if (!value) return undefined
  try {
    const decoded = decodeURIComponent(value)
    return /^[a-zA-Z0-9_-]{1,64}$/.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function Connection({ mission }: { mission: Mission }) {
  const label = !mission.online ? 'Offline' : mission.reachable ? 'Connected'
    : mission.connection === 'checking' ? 'Connecting' : 'Service unavailable'
  return (
    <span className={`connection ${mission.reachable ? 'connected' : ''}`} role="status">
      <span className="connection-dot" />{label}
    </span>
  )
}

function MissionSummary({ mission }: { mission: Mission }) {
  return (
    <aside className="surface mission-card">
      <div className="section-heading"><h2>Mission context</h2><Orbit size={20} aria-hidden="true" /></div>
      <dl>
        <div><dt>Active profile</dt><dd>{mission.profile?.name ?? 'Unavailable'}</dd></div>
        <div><dt>Crew member</dt><dd>{mission.selected?.display_name ?? 'Unavailable'}</dd></div>
      </dl>
      <a className="text-link" href="#mission">Manage mission profile <ArrowUpRight size={16} aria-hidden="true" /></a>
    </aside>
  )
}

function Home({ mission, offlineReady }: { mission: Mission; offlineReady: boolean }) {
  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <p className="hero-context"><Orbit size={17} aria-hidden="true" />
            {mission.profile ? environmentLabels[mission.profile.environment] : 'Autonomous Crew Health Assistant'}
          </p>
          <h1>Crew health</h1>
          <p>Report symptoms, review an assessment, or open the emergency reference for your mission.</p>
          <a className="button hero-button" href="#assessment">
            Start assessment <ArrowRight size={19} aria-hidden="true" />
          </a>
        </div>
      </section>
      <div className="home-grid">
        <div className="home-primary">
          <section aria-labelledby="recent-heading">
            <div className="section-heading">
              <h2 id="recent-heading">Recent assessments</h2>
              <a className="text-link" href="#results">View history <ArrowRight size={16} aria-hidden="true" /></a>
            </div>
            <div className="surface">
              <Records records={mission.history.slice(0, 3)} queued={mission.queued}
                crewAvailable={Boolean(mission.selected)} syncIssues={mission.syncIssues} />
            </div>
          </section>
          <a href="#guides" className="emergency-card">
            <span className="icon-tile"><BookOpen size={21} aria-hidden="true" /></span>
            <span><strong>Emergency guides</strong><small>Response guidance and protocol references</small></span>
            <ArrowRight size={20} aria-hidden="true" />
          </a>
        </div>
        <div className="home-aside">
          <MissionSummary mission={mission} />
          {offlineReady && <p className="offline-ready"><CloudDownload size={17} aria-hidden="true" /> Demo guides saved on this device</p>}
        </div>
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
      <header className="page-title"><h1>Mission profile</h1><p>Choose a crew member and set their active mission environment.</p></header>
      <section className="surface crew-panel">
        <span className="icon-tile"><UserRound size={20} aria-hidden="true" /></span>
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
      {!mission.reachable && <p className="notice" role="status">
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
                <div className="section-heading">
                  <span className="icon-tile"><Orbit size={20} aria-hidden="true" /></span>
                  {active && <span className="active-profile"><BadgeCheck size={17} aria-hidden="true" /> Active</span>}
                </div>
                <h2>{profile.name}</h2><p>{environmentLabels[profile.environment]}</p>
                <dl className="detail-list">
                  <div><dt>Equipment</dt><dd>{profile.equipment.join(', ') || 'None listed'}</dd></div>
                  {profile.constraints.length > 0 && <div><dt>Constraints</dt><dd>{profile.constraints.join(', ')}</dd></div>}
                </dl>
                <div className="form-actions">
                  {active ? <a className="text-link" href="#guides">View guides <ArrowRight size={16} aria-hidden="true" /></a>
                    : <button className="button secondary" disabled={!mission.reachable || !mission.selected || mission.changingProfile}
                      onClick={() => void change(profile)}>Use this profile</button>}
                </div>
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
  const offlineReady = useOfflineShell()
  const main = useRef<HTMLElement>(null)
  const [page, rawId] = route.split('/')
  const id = safeRouteId(rawId)
  const home = !['assessment', 'results', 'guides', 'mission'].includes(page)

  useEffect(() => {
    window.scrollTo(0, 0)
    if (route) main.current?.focus({ preventScroll: true })
  }, [route])

  const assessmentRecords = {
    records: mission.history,
    queued: mission.queued,
    syncIssues: mission.syncIssues,
    crewAvailable: Boolean(mission.selected),
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
      <header className="site-header">
        <div className="header-inner">
          <a href="#" className="brand" aria-label="ACHA home">
            <img src={`${import.meta.env.BASE_URL}acha.svg`} width="36" height="36" alt="" />
            <span>ACHA</span>
          </a>
          <nav className="main-nav" aria-label="Primary navigation">
            <a href="#" aria-current={home ? 'page' : undefined}>Overview</a>
            <a href="#results" aria-current={page === 'assessment' || page === 'results' ? 'page' : undefined}>Assessments</a>
            <a href="#mission" aria-current={page === 'mission' ? 'page' : undefined}>Mission profile</a>
          </nav>
          <div className="header-actions">
            <Connection mission={mission} />
            <a className="emergency-button" href="#guides" aria-current={page === 'guides' ? 'page' : undefined}>
              <ShieldAlert size={17} aria-hidden="true" /> <span>Emergency guides</span>
            </a>
          </div>
        </div>
      </header>
      <main ref={main} id="main-content" className={`main-content ${home ? 'home' : 'inner-page'}`} tabIndex={-1}>
        {home && <Home mission={mission} offlineReady={offlineReady} />}
        {page === 'assessment' && (
          <>
            <header className="page-title">
              <h1>Self-assessment</h1>
              <p>{mission.selected ? `Recording for ${mission.selected.display_name}.` : 'Report symptoms and attach recent measurements.'}</p>
            </header>
            {!mission.selected && <p className="notice" role="status">
              <Radio size={18} aria-hidden="true" /> A crew member must be loaded before saving.
              <a className="text-link" href="#mission">Open mission profile</a>
            </p>}
            <AssessmentForm key={mission.selected?.id} crew={mission.selected} measurements={mission.measurements}
              reachable={mission.reachable} onSubmit={async input => {
                await mission.submit(input)
                window.location.hash = `results/${input.id}`
              }} />
          </>
        )}
        {page === 'results' && (id ? <AssessmentResult key={`${mission.selected?.id}:${id}`} id={id}
          crewId={mission.selected?.id} reachable={mission.reachable}
          record={mission.history.find(record => record.id === id)}
          queued={mission.queued.find(entry => entry.input.id === id)}
          syncIssue={mission.syncIssues[id]} onRecord={mission.remember} onDiscard={mission.discard} />
          : <AssessmentHistory {...assessmentRecords} />)}
        {page === 'guides' && <Guidance profile={mission.profile} guideId={id} />}
        {page === 'mission' && <MissionProfiles mission={mission} />}
      </main>
      <footer className="site-footer">
        <span>Autonomous Crew Health Assistant</span>
        <span><ClipboardList size={14} aria-hidden="true" /> Prototype</span>
      </footer>
    </div>
  )
}
