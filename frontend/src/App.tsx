import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Check, ChevronDown, LayoutDashboard, Activity, Orbit, FlaskConical, HeartPulse,
  Menu, UserRound, BookOpen, ClipboardList, Clapperboard,
} from 'lucide-react'
import { AssessmentForm } from './AssessmentForm'
import { AssessmentHistory, AssessmentResult, Records } from './AssessmentResults'
import { Guidance } from './Guidance'
import { HealthMonitoring } from './HealthMonitoring'
import { AnatomyDashboard } from './AnatomyDashboard'
import { Measurements } from './Measurements'
import { MissionScenarios } from './MissionScenarios'
import { ScenarioConsole } from './ScenarioConsole'
import { RecordedWorkflow } from './RecordedWorkflow'
import { missionElapsed } from './missionScenarioData'
import { useScenarioPlayer, type ScenarioPlayer } from './useScenarioPlayer'
import { DemoMonitoring } from './PersonalIndicators'
import { Observations } from './Observations'
import { Pressure } from './Pressure'
import { Crew } from './Crew'
import { MeasurementDetails, ProfileTools } from './WorkspaceTools'
import { DeviceIngest } from './DeviceIngest'
import { Research } from './Research'
import { environmentLabels, formatDate, measurementLabels } from './content'
import { navigate } from './navigation'
import { useMission } from './useMission'
import { readLocal, saveLocal } from './storage'
import { openScenario, readScenario, scenarioAssessmentId } from './localScenario'
import type { Measurement, MissionProfile } from './api'

type Mission = ReturnType<typeof useMission>


const overviewKinds = ['heart_rate', 'spo2', 'blood_pressure', 'respiratory_rate', 'body_temperature', 'sleep_duration']
const overviewLabels: Record<string, string> = { spo2: 'Blood oxygen', body_temperature: 'Temperature', sleep_duration: 'Sleep' }
const menuIcons = { overview: LayoutDashboard, monitoring: HeartPulse, measurements: Activity, assessments: ClipboardList, guides: BookOpen, mission: Orbit, scenarios: Clapperboard, research: FlaskConical }
function MenuIcon({ name }: { name: keyof typeof menuIcons }) {
  const Icon = menuIcons[name]
  return <Icon size={18} aria-hidden="true" className="nav-icon" />
}

function Sparkline({ readings }: { readings: Measurement[] }) {
  const values = [...readings].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at)).map(reading => reading.value)
  if (values.length < 2) return null
  const min = Math.min(...values), range = Math.max(...values) - min
  const coordinates = values.map((value, index) => `${4 + index / (values.length - 1) * 104},${range ? 23 - (value - min) / range * 18 : 14}`)
  return <svg className="vital-sparkline" viewBox="0 0 112 28" aria-hidden="true">
    <polyline points={coordinates.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx={coordinates.at(-1)!.split(',')[0]} cy={coordinates.at(-1)!.split(',')[1]} r="3" fill="currentColor" />
  </svg>
}

function locationPath() {
  const legacy = window.location.hash.match(/^#(assessment|results|guides|mission)(\/[a-zA-Z0-9_-]+)?$/)
  if (legacy) return `/${legacy[1] === 'results' ? 'assessments' : legacy[1]}${legacy[2] ?? ''}`
  return (window.location.pathname.replace(/\/+$/, '') || '/') + window.location.search
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

function CrewMonitoring({ mission, onOpenScenario }: { mission: Mission; onOpenScenario: () => void }) {
  return <>
    <header className="overview-heading">
      <div><h1>Crew monitoring</h1><p>{mission.profile?.name ?? 'No mission assigned'}</p></div>
      <div className="overview-actions">
        {import.meta.env.VITE_RESTRICTED_WORKSPACE_URL && <a className="button secondary" href={import.meta.env.VITE_RESTRICTED_WORKSPACE_URL}>Restricted workspace</a>}
        <a className="button secondary" href="/monitoring/anatomy">Body systems</a>
        <a className="button primary" href="/measurements">Record measurement</a>
      </div>
    </header>
    {mission.local
      ? <p className="monitoring-scenario-link"><a className="text-link" href={`/assessments/${scenarioAssessmentId}`}>Open training check-in</a></p>
      : <p className="monitoring-scenario-link"><button className="text-link" onClick={onOpenScenario}>Open synthetic check-in</button></p>}
    {mission.crew.length > 0 && <nav className="crew-roster" aria-label="Crew members">
      {mission.crew.map(crew => <button type="button" key={crew.id} className="button secondary"
        aria-pressed={crew.id === mission.selected?.id} onClick={() => mission.selectCrew(crew.id)}>
        {crew.display_name}
      </button>)}
    </nav>}
    {mission.selected ? <DemoMonitoring key={mission.selected.id} crewId={mission.selected.id} reachable={mission.reachable}
      refreshKey={mission.measurements[0]?.id} load={mission.records.monitoring} /> : <p className="notice" role="status">
      {mission.connection === 'checking' ? 'Loading crew…' : 'No crew member is available.'}
    </p>}
    <section className="surface form-panel scenario-intro" aria-labelledby="recent-check-ins">
      <div className="section-heading"><h2 id="recent-check-ins">Recent check-ins</h2><a className="text-link" href="/assessments">All assessments</a></div>
      <Records records={mission.history} queued={mission.queued} syncIssues={mission.syncIssues}
        available={mission.historyAvailable} pending={mission.historyPending} limit={3} />
    </section>
  </>
}

function LatestMeasurements({ measurements, pending, available, profile }: {
  measurements: Measurement[]; pending: boolean; available: boolean; profile?: MissionProfile
}) {
  return (
    <section className="overview-measurements" aria-labelledby="measurements-heading">
      <div className="section-heading">
        <h2 id="measurements-heading">Latest measurements</h2>
        <a className="text-link" href="/measurements">View history</a>
      </div>
      <dl className="surface overview-readings" aria-busy={pending}>
        {overviewKinds.map(kind => {
          const readings = measurements.filter(item => item.kind === kind)
            .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
          const reading = readings[0]
          const label = overviewLabels[kind] ?? measurementLabels[kind]
          const interval = profile?.measurement_schedules?.find(schedule => schedule.kind === kind)?.interval_minutes
          const overdue = reading && interval != null && Date.now() - Date.parse(reading.recorded_at) >= interval * 60_000
          return <div className="overview-reading" key={kind}>
            <dt><a href={`/measurements?kind=${kind}`}>{label}</a>{overdue && <span className="reading-due">Due</span>}</dt>
            {reading ? <dd>
              <span className="vital-value">{reading.value}{reading.diastolic !== null && `/${reading.diastolic}`}<small>{reading.unit}</small></span>
              <time dateTime={reading.recorded_at}>{formatDate(reading.recorded_at)}</time>
              <Sparkline readings={readings.slice(0, 12)} />
            </dd> : <dd>
              <span className="reading-caption">{pending ? 'Loading…' : available ? 'No reading' : 'Unavailable'}</span>
            </dd>}
          </div>
        })}
      </dl>
    </section>
  )
}

function Home({ mission, player }: { mission: Mission; player: ScenarioPlayer }) {
  const active = player.state.mode === 'scenario'
  const review = mission.history[0]
  const reviewRequired = review && ['urgent', 'review', 'needs_attention'].includes(review.status)
  return <>
    <header className="overview-heading overview-header">
      <div>
        <h1>{active ? player.scenario?.title ?? 'Training scenario' : 'Health overview'}</h1>
        {!active && <p>Record crew observations, run an assessment and document follow-up.</p>}
      </div>
    </header>
    {active && <ScenarioConsole player={player} embedded />}
    <div hidden={active} className="overview-workspace">
      {reviewRequired && <a className="overview-alert" data-urgent={review.status === 'urgent'} href={`/assessments/${review.id}`}>
        <strong>{review.status === 'urgent' ? 'Urgent assessment' : 'Assessment needs review'}</strong>
        <span>Open assessment</span>
      </a>}
      <LatestMeasurements measurements={mission.measurements} pending={mission.measurementsPending}
        available={mission.measurementsAvailable} profile={mission.profile} />
      <section className="surface briefing-records overview-records" aria-labelledby="recent-heading">
        <div className="section-heading">
          <h2 id="recent-heading">Recent assessments</h2>
          <a className="text-link" href="/assessments">View all</a>
        </div>
        <Records records={mission.history} queued={mission.queued} limit={3} pending={mission.historyPending}
          available={mission.historyAvailable} syncIssues={mission.syncIssues} />
      </section>
      <RecordedWorkflow mission={mission} onStartTraining={() => player.dispatch({ type: 'open', id: 'lunar-fatigue', play: true })} />
    </div>
  </>
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
      <header className="page-title split"><h1>Mission profile</h1>
        <div className="overview-actions">
          <a className="button secondary" href="/mission/devices">Device upload</a>
            <a className="button secondary" href="/mission/monitoring">Health monitoring</a>
          <a className="button secondary" href="/mission/pressure">Review cabin pressure</a>
          <a className="button secondary" href="/mission/observations">Mission observations</a>
        </div>
      </header>
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
        Connect to the mission service to change the active profile.
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
      {!mission.local && <ProfileTools selectedId={mission.profile?.id} reachable={mission.reachable} onCreated={mission.refreshWorkspace} />}
    </>
  )
}

export function App() {
  const [local, setLocal] = useState(() => readLocal<boolean>('use-synthetic-scenario') === true && Boolean(readScenario()))
  const [modeError, setModeError] = useState('')
  async function changeMode(next: boolean, path?: string) {
    setModeError('')
    if (next && !await openScenario().catch(() => false)) {
      setModeError('This browser could not save the synthetic scenario. Enable site storage to use it.')
      return
    }
    saveLocal('use-synthetic-scenario', next)
    setLocal(next)
    navigate(path ?? (next ? '/monitoring' : '/'))
  }
  return <MissionApp key={String(local)} local={local} changeMode={changeMode} modeError={modeError} />
}

function MissionApp({ local, changeMode, modeError }: { local: boolean; changeMode: (local: boolean, path?: string) => void; modeError: string }) {
  const mission = useMission(local)
  const route = useRoute()
  useOfflineShell()
  const main = useRef<HTMLElement>(null)
  const previousRoute = useRef(route)
  const sidebar = useRef<HTMLElement>(null)
  const menuToggle = useRef<HTMLButtonElement>(null)
  const restoreMenuFocus = useRef(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocal<boolean>('sidebar-collapsed') ?? false)
  const [isMobile, setIsMobile] = useState(() => matchMedia('(max-width: 760px)').matches)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuOpen = isMobile ? mobileMenuOpen : !sidebarCollapsed

  useEffect(() => { saveLocal('sidebar-collapsed', sidebarCollapsed) }, [sidebarCollapsed])
  useEffect(() => {
    const media = matchMedia('(max-width: 760px)')
    const update = () => { setIsMobile(media.matches); setMobileMenuOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!isMobile || !mobileMenuOpen) return
    restoreMenuFocus.current = true
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const items = () => Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])
    const focusTimer = window.setTimeout(() => sidebar.current?.querySelector<HTMLButtonElement>('.sidebar-close')?.focus(), 240)
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileMenuOpen(false) }
      if (event.key !== 'Tab') return
      const focusable = items()
      const first = focusable[0], last = focusable.at(-1)
      if (!sidebar.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', handleKey)
      if (restoreMenuFocus.current) menuToggle.current?.focus()
    }
  }, [isMobile, mobileMenuOpen])
  const [pathname, query] = route.split('?')
  const [, page, rawId] = pathname.split('/')
  const id = rawId && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId) ? rawId : undefined
  const params = new URLSearchParams(query)
  const initialMeasurementId = params.get('measurement') ?? undefined
  const rawFollowUp = params.get('follow-up') ?? ''
  const followUpId = /^[a-zA-Z0-9_-]{1,64}$/.test(rawFollowUp) ? rawFollowUp : undefined
  const requestedKind = params.get('kind') ?? ''
  const restrictedLog = params.get('source') === 'restricted'
  const researchView = params.get('view') ?? ''
  const initialKind = Object.hasOwn(measurementLabels, requestedKind) ? requestedKind : ''
  const scenarios = page === 'scenarios'
  const home = !scenarios && !['assessment', 'assessments', 'measurements', 'guides', 'mission', 'research', 'crew', 'monitoring'].includes(page)
  const player = useScenarioPlayer(route, home || (scenarios && Boolean(rawId)))
  const replay = player.scenario && (home || (scenarios && rawId === player.scenario.id)) ? player.scenario : undefined
  const [attached, setAttached] = useState<{ crewId: string; record?: Measurement; error?: string }>()
  const listedMeasurement = mission.measurements.some(item => item.id === initialMeasurementId)
  const activeCrewId = mission.selected?.id
  const loadMeasurement = mission.records.measurement
  useEffect(() => {
    if (page !== 'assessment' || !initialMeasurementId || !activeCrewId || listedMeasurement || !mission.reachable) return
    let active = true
    void loadMeasurement(activeCrewId, initialMeasurementId).then(record => {
      if (active) setAttached({ crewId: activeCrewId, record })
    }, () => {
      if (active) setAttached({ crewId: activeCrewId, error: initialMeasurementId })
    })
    return () => { active = false }
  }, [page, initialMeasurementId, activeCrewId, listedMeasurement, loadMeasurement, mission.reachable])
  const attachment = attached?.crewId === activeCrewId ? attached : undefined
  const extraMeasurement = !listedMeasurement && attachment?.record?.id === initialMeasurementId ? attachment?.record : undefined

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
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-nav-open' : ''}`} onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/"]') : null
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return
      if (isMobile && sidebar.current?.contains(anchor)) { restoreMenuFocus.current = false; setMobileMenuOpen(false) }
      event.preventDefault()
      navigate(anchor.pathname + anchor.search)
    }}>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
      {isMobile && mobileMenuOpen && <button className="sidebar-backdrop" aria-label="Dismiss navigation" tabIndex={-1} onClick={() => setMobileMenuOpen(false)} />}
      {isMobile && <button ref={menuToggle} className="mobile-menu-trigger menu-toggle" aria-controls="app-sidebar" aria-expanded={mobileMenuOpen} aria-label="Open menu" inert={mobileMenuOpen} aria-hidden={mobileMenuOpen ? true : undefined} onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button>}
      <aside ref={sidebar} id="app-sidebar" className="app-sidebar" role={isMobile ? 'dialog' : undefined} aria-label="Navigation" aria-modal={isMobile && mobileMenuOpen ? true : undefined} aria-hidden={isMobile && !mobileMenuOpen ? true : undefined} inert={isMobile && !mobileMenuOpen}>
        <div className="sidebar-brand-row">
          <button ref={isMobile ? undefined : menuToggle} className={`menu-toggle sidebar-menu-toggle ${isMobile ? 'sidebar-close' : ''}`} aria-controls="app-sidebar" aria-expanded={menuOpen}
            aria-label={isMobile ? 'Close menu' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => isMobile ? setMobileMenuOpen(false) : setSidebarCollapsed(value => !value)}><Menu size={20} /></button>
          <a href="/" className="brand" aria-label="ACHA home">
            <span className="brand-name">ACHA</span>
          </a>
        </div>
          <nav className="main-nav" aria-label="Primary navigation">
            {([
              ['overview', '/', 'Overview', home],
              ['monitoring', '/monitoring', 'Crew monitoring', page === 'monitoring'],
              ['measurements', '/measurements', 'Measurements', page === 'measurements'],
              ['assessments', '/assessments', 'Assessments', page === 'assessment' || page === 'assessments'],
              ['guides', '/guides', 'Emergency guides', page === 'guides'],
              ['mission', '/mission', 'Mission', page === 'mission'],
              ['scenarios', '/scenarios', 'Training', scenarios],
              ['research', '/research', 'Research', page === 'research'],
            ] as const).map(([icon, href, label, active]) => (
              <a key={href} href={href} aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
                {sidebarCollapsed && !isMobile && <MenuIcon name={icon} />}
                <span>{label}</span>
              </a>
            ))}
          </nav>
          <a className="sidebar-user" href="/crew" aria-label={`Crew${mission.selected ? `: ${mission.selected.display_name}` : ''}`} title="Crew" aria-current={page === 'crew' ? 'page' : undefined}>
            {sidebarCollapsed && !isMobile && <span className="sidebar-user-avatar"><UserRound size={19} aria-hidden="true" /></span>}
            <span className="sidebar-user-details"><strong>{mission.selected?.display_name ?? 'Crew'}</strong><small>{mission.profile?.name ?? 'Select a crew member'}</small></span>
          </a>
      </aside>
      <main ref={main} id="main-content" className={`main-content ${home ? 'home' : 'inner-page'}`} tabIndex={-1} inert={isMobile && mobileMenuOpen}>
        {(replay || !mission.online || !!mission.queued.length) && <div className="console-statusbar" aria-label="Workspace status">
          <div className="console-context">
            {replay && <span className="replay-context">{replay.subject} · {missionElapsed(player.simulatedTime!)}</span>}
            {!mission.online && <span className="service-state" data-state="offline">Offline</span>}
            {!!mission.queued.length && <a className="text-link" href="/assessments">{mission.queued.length} pending sync</a>}
          </div>
        </div>}
        {local && !scenarios && !replay && <div className="connection-notice scenario-banner"><strong>Training workspace</strong>
          <button className="text-link" onClick={() => changeMode(false)}>Return to mission service</button></div>}
        {!scenarios && !replay && !mission.reachable && (mission.connection !== 'checking' || !mission.online) && <div className="connection-notice" role="status">{mission.online ? 'Couldn’t refresh mission-service records.' : 'You’re offline. This device can show any records it has cached.'}{mission.online && <button className="text-link" onClick={() => void mission.refreshWorkspace()}>Retry</button>}{!home && <button className="text-link" onClick={() => changeMode(true)}>Open synthetic scenario</button>}</div>}
        {modeError && <p className="notice error" role="alert">{modeError}</p>}
        <div className="route-content">
          {home && <Home mission={mission} player={player} />}
          {page === 'monitoring' && id !== 'anatomy' && <CrewMonitoring mission={mission} onOpenScenario={() => changeMode(true)} />}
          {page === 'monitoring' && id === 'anatomy' && <>
            <a className="back-link" href="/monitoring">Back to crew monitoring</a>
            <AnatomyDashboard crewId={mission.selected?.id} measurements={mission.measurements} assessments={mission.history}
              reachable={mission.reachable} load={mission.records.measurements} />
          </>}
          {scenarios && <MissionScenarios id={rawId} player={player} />}
          {page === 'assessment' && (
            <>
              <header className="page-title">
                <h1>Self-assessment</h1>
                <p className="crew-context">{mission.selected?.display_name}</p>
                <p>Use sample data in this public workspace.</p>
              </header>
              {!mission.selected && (mission.connection !== 'checking' || !mission.online) && <p className="notice" role="status">
                Select a crew member before saving.
                <a className="text-link" href="/mission">Open mission profile</a>
              </p>}
              {initialMeasurementId && !listedMeasurement && attachment?.error === initialMeasurementId && <p className="notice error" role="alert">The linked measurement could not be loaded for this crew member.</p>}
              <AssessmentForm key={`${mission.selected?.id}:${initialMeasurementId}`} initialMeasurementId={initialMeasurementId}
                crew={mission.selected} measurements={extraMeasurement ? [extraMeasurement, ...mission.measurements] : mission.measurements}
                measurementsPending={mission.measurementsPending}
                reachable={mission.reachable} onSubmit={async input => {
                  await mission.submit(input)
                  navigate(`/assessments/${input.id}`)
                }} />
            </>
          )}
          {page === 'assessments' && (id ? <AssessmentResult key={`${mission.selected?.id}:${id}`} id={id}
            crewId={mission.selected?.id} crewName={mission.selected?.display_name} reachable={mission.reachable} pending={mission.historyPending} local={local}
            measurements={mission.measurements} preferredMeasurement={initialMeasurementId} data={mission.records}
            record={mission.history.find(record => record.id === id)}
            queued={mission.queued.find(entry => entry.input.id === id)}
            syncIssue={mission.syncIssues[id]} onRecord={mission.remember} onDiscard={mission.discard} />
            : <AssessmentHistory {...assessmentRecords} />)}
          {page === 'guides' && <Guidance profile={mission.profile} guideId={id} />}
          {page === 'mission' && id === 'devices' && <><header className="page-title"><h1>Device integration</h1></header><DeviceIngest /></>}
          {page === 'mission' && id === 'pressure' && <Pressure />}
          {page === 'mission' && id === 'monitoring' && <HealthMonitoring crew={mission.selected} reachable={mission.reachable} load={mission.records.measurements} />}
          {page === 'mission' && id === 'observations' && <Observations key={String(restrictedLog)} restricted={restrictedLog} />}
          {page === 'mission' && !['pressure', 'observations', 'monitoring', 'devices'].includes(id ?? '') && <MissionProfiles mission={mission} />}
          {page === 'crew' && <Crew members={mission.crew} profiles={mission.profiles} selectedId={mission.selected?.id} local={local} pending={mission.connection === 'checking'} reachable={mission.reachable} onCreated={mission.refreshWorkspace} onSelect={mission.selectCrew} />}
          {page === 'measurements' && id && <MeasurementDetails key={`${mission.selected?.id}:${id}`} crewId={mission.selected?.id} id={id} reachable={mission.reachable} load={mission.records.measurement} />}
          {page === 'measurements' && !id && <Measurements key={`${mission.selected?.id}:${initialKind}:${followUpId}`} initialKind={initialKind} crew={mission.selected} measurements={mission.measurements}
            local={local} followUpId={followUpId} load={mission.records.measurements} pending={mission.measurementsPending} reachable={mission.reachable} onSave={mission.recordMeasurement} onReconnect={mission.refreshWorkspace} />}
          {page === 'research' && <Research view={researchView} />}
        </div>
      </main>
    </div>
  )
}
