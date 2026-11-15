import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, ChevronDown, Radio, WifiOff, LayoutDashboard, Activity,
  Orbit, FlaskConical, HeartPulse, Plus, Menu, UserRound, BookOpen, ClipboardList, Droplets, Gauge, Moon, Wind, Clapperboard,
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
import { environmentLabels, formatDate, humanize, measurementLabels } from './content'
import { navigate } from './navigation'
import { useMission } from './useMission'
import { readLocal, saveLocal } from './storage'
import { openScenario, readScenario, scenarioAssessmentId } from './localScenario'
import type { Measurement, MissionProfile } from './api'

type Mission = ReturnType<typeof useMission>


const vitalIcons = { heart_rate: HeartPulse, spo2: Droplets, blood_pressure: Gauge, respiratory_rate: Wind, sleep_duration: Moon }
const menuIcons = { overview: LayoutDashboard, monitoring: HeartPulse, measurements: Activity, assessments: ClipboardList, guides: BookOpen, mission: Orbit, scenarios: Clapperboard, research: FlaskConical }
function MenuIcon({ name, pulse }: { name: keyof typeof menuIcons; pulse: number }) {
  const Icon = menuIcons[name]
  return <Icon key={pulse} size={19} aria-hidden="true" className={`nav-icon nav-icon-${name}${pulse ? ' nav-icon-play' : ''}`} >
    {name === 'guides' && <path className="nav-book-page" d="M12 7c2-3 5-3 8-3v12c-3 0-6 1-8 5" />}
  </Icon>
}

function Sparkline({ readings }: { readings: Measurement[] }) {
  const values = [...readings].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at)).map(reading => reading.value)
  if (!values.length) return <span className="sparkline-empty">Waiting for a reading</span>
  const min = Math.min(...values), range = Math.max(...values) - min || 1
  const coordinates = values.map((value, index) => `${values.length === 1 ? 110 : 8 + index / (values.length - 1) * 204},${36 - (value - min) / range * 26}`)
  return <svg className="vital-sparkline" viewBox="0 0 220 46" aria-hidden="true">
    <line x1="0" x2="220" y1="40" y2="40" className="sparkline-base" />
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
      <div><h1>Crew monitoring</h1><p>{mission.profile?.name ?? 'Demo workspace'}</p></div>
      <div className="overview-actions">
        {import.meta.env.VITE_RESTRICTED_WORKSPACE_URL && <a className="button secondary" href={import.meta.env.VITE_RESTRICTED_WORKSPACE_URL}>Restricted workspace</a>}
        <a className="button secondary" href="/guides"><BookOpen size={16} aria-hidden="true" /> Emergency guides</a>
        <a className="button secondary" href="/assessment"><ClipboardList size={16} aria-hidden="true" /> Start assessment</a>
        <a className="button primary" href="/measurements"><Plus size={17} /> Record measurement</a>
      </div>
    </header>
    {mission.local ? <section className="surface form-panel scenario-intro">
      <h2>Lunar habitat · Early-shift check-in</h2>
      <p>Emirhan reports fatigue after shorter sleep. Review the recorded change, check the limits of the evidence, and log a simulated repeat reading.</p>
      <a className="button primary" href={`/assessments/${scenarioAssessmentId}`}>Open scenario check-in <ArrowRight size={16} aria-hidden="true" /></a>
    </section> : <section className="surface form-panel scenario-intro">
      <h2>Explore space mission scenarios</h2>
      <p>Replay three fictional missions, or open a hands-on lunar check-in to record and link a repeat measurement.</p>
      <div className="overview-actions">
        <a className="button primary" href="/scenarios">Explore scenarios <ArrowRight size={16} aria-hidden="true" /></a>
        <button className="button secondary" onClick={onOpenScenario}>Open synthetic scenario</button>
      </div>
    </section>}
    {mission.crew.length > 0 && <nav className="crew-roster" aria-label="Crew members">
      {mission.crew.map(crew => <button type="button" key={crew.id} className="button secondary"
        aria-pressed={crew.id === mission.selected?.id} onClick={() => mission.selectCrew(crew.id)}>
        <UserRound size={17} aria-hidden="true" /> {crew.display_name}
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

function LatestMeasurements({ measurements, pending, available, local, profile }: {
  measurements: Measurement[]; pending: boolean; available: boolean; local: boolean; profile?: MissionProfile
}) {
  const latest = new Map<string, Measurement>()
  for (const reading of measurements) {
    const previous = latest.get(reading.kind)
    if (!previous || Date.parse(reading.recorded_at) > Date.parse(previous.recorded_at)) {
      latest.set(reading.kind, reading)
    }
  }

  return (
    <section className="telemetry-strip" aria-labelledby="measurements-heading">
      <div className="section-heading"><h2 id="measurements-heading"><span className="technical-label">01 /</span> Latest recorded measurements</h2>
        <a className="text-link" href="/measurements">View readings</a>
      </div>
      <dl className="vital-grid surface" aria-busy={pending}>
        {Object.keys(vitalIcons).map(kind => {
          const label = measurementLabels[kind]
          const reading = latest.get(kind)
          const Icon = vitalIcons[kind as keyof typeof vitalIcons]
          const interval = profile?.measurement_schedules?.find(schedule => schedule.kind === kind)?.interval_minutes
          const age = reading ? Math.floor((Date.now() - Date.parse(reading.recorded_at)) / 60_000) : null
          const overdue = interval != null && age != null && age >= interval
          return (
            <div key={kind}>
              <dt><span className="vital-icon"><Icon size={18} aria-hidden="true" /></span>{label}<a href={`/measurements?kind=${kind}`} aria-label={`Open ${label.toLowerCase()} history`}><ArrowRight size={15} /></a></dt>
              {reading ? (
                <dd>
                  <span className="vital-value">
                    {reading.value}{reading.diastolic !== null && `/${reading.diastolic}`}
                    <small>{reading.unit}</small>
                  </span>
                  <time dateTime={reading.recorded_at}>{formatDate(reading.recorded_at)}</time>
                  <small className="recorded-provenance">{local ? 'Fictional training record' : 'Recorded spot measurement'}{overdue ? ' · Past scheduled interval' : ''}</small>
                  <Sparkline readings={measurements.filter(item => item.kind === kind)} />
                </dd>
              ) : <dd className="missing-reading">
                {pending ? <span className="reading-placeholder" aria-hidden="true" />
                  : available ? 'No recent reading' : 'Unavailable'}
                {!pending && <a className="text-link" href={`/measurements?kind=${kind}`}><Plus size={14} /> Add reading</a>}
              </dd>}
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function Home({ mission, player }: { mission: Mission; player: ScenarioPlayer }) {
  const active = player.state.mode === 'scenario'
  const review = mission.history[0]
  const unavailable = Object.keys(vitalIcons).filter(kind => !mission.measurements.some(record => record.kind === kind)).length
  return (
    <>
      <header className="overview-heading">
        <div>
          <h1>Mission Health Command Center</h1>
          <p>{active ? player.scenario?.title : 'Record crew observations, run an assessment and document follow-up.'}</p>
        </div>
      </header>
      {active && <ScenarioConsole player={player} embedded />}
      <div hidden={active}>
      {!active && <RecordedWorkflow mission={mission} onStartTraining={() => player.dispatch({ type: 'open', id: 'lunar-fatigue', play: true })} />}
      <section className="recorded-actions" aria-label="Recorded workspace status">
        {!!mission.measurements.length && <span>{unavailable} of {Object.keys(vitalIcons).length} observation channels without a reading</span>}
        {review ? <a className="text-link" href={`/assessments/${review.id}`}>Latest assessment · {humanize(review.status)}</a>
          : <span>{mission.historyPending ? 'Checking assessments' : mission.historyAvailable ? 'No assessments recorded' : 'Assessment status unavailable'}</span>}
        {!!mission.queued.length && <span>{mission.queued.length} waiting to sync</span>}
        {mission.lastSync && <span>Workspace synced <time dateTime={mission.lastSync}>{formatDate(mission.lastSync)}</time></span>}
      </section>
      <LatestMeasurements measurements={mission.measurements} pending={mission.measurementsPending}
        available={mission.measurementsAvailable} local={mission.local} profile={mission.profile} />
      <div className="console-grid">
        <AnatomyDashboard crewId={mission.selected?.id} measurements={mission.measurements} assessments={mission.history}
          reachable={mission.reachable} load={mission.records.measurements} suspended={active} />
        <aside className="console-briefing" aria-label="Mission briefing">
        <section className="surface briefing-records" aria-labelledby="recent-heading">
          <div className="section-heading">
            <h2 id="recent-heading"><span className="technical-label">03 /</span> Crew log</h2>
            <a className="text-link" href="/assessments">View all</a>
          </div>
          <div>
            <Records records={mission.history} queued={mission.queued} limit={3} pending={mission.historyPending}
              available={mission.historyAvailable} syncIssues={mission.syncIssues} />
          </div>
        </section>
        <section className="surface mission-summary" aria-labelledby="mission-summary-heading">
          <div className="section-heading"><h2 id="mission-summary-heading"><span className="technical-label">04 /</span> Mission context</h2></div>
          <div className="mission-emblem"><Orbit size={24} aria-hidden="true" /><span>{mission.profile?.name ?? 'No mission selected'}<small>{mission.profile ? environmentLabels[mission.profile.environment] : 'Mission context unavailable'}</small></span></div>
          <dl className="detail-list"><div><dt>Crew member</dt><dd>{mission.selected?.display_name ?? 'Not selected'}</dd></div><div><dt>Equipment</dt><dd>{mission.profile?.equipment.join(', ') || 'No equipment listed'}</dd></div></dl>
          <a className="text-link" href="/mission">View mission profile <ArrowRight size={14} /></a>
        </section>
        <a className="surface guide-shortcut" href="/guides"><BookOpen size={20} /><span><span className="technical-label">Reference / procedures</span><strong>Medical guides</strong><small>Procedures and emergency contacts</small></span><ArrowRight size={17} /></a>
        </aside>
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
      <header className="page-title split"><h1>Mission profile</h1>
        <div className="overview-actions">
          <a className="button secondary" href="/mission/devices">Device upload</a>
            <a className="button secondary" href="/mission/monitoring">Health monitoring</a>
          <a className="button secondary" href="/mission/pressure">Review cabin pressure</a>
          <a className="button secondary" href="/mission/observations">Mission observations <ArrowRight size={17} aria-hidden="true" /></a>
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
  const [navPulse, setNavPulse] = useState({ href: '', sequence: 0 })
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
      if (sidebar.current?.contains(anchor)) setNavPulse(current => ({ href: anchor.pathname, sequence: current.sequence + 1 }))
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
            <span className="brand-symbol" aria-hidden="true"><HeartPulse size={23} /></span>
            <span className="brand-copy"><span className="brand-name">ACHA</span><small>Crew Health Assistant</small></span>
          </a>
        </div>
          <span className="sidebar-section-label technical-label">Operations</span>
          <nav className="main-nav" aria-label="Primary navigation">
            <a href="/" aria-label="Overview" title="Overview" aria-current={home ? 'page' : undefined}><MenuIcon name="overview" pulse={navPulse.href === '/' ? navPulse.sequence : 0} /><span>Overview</span></a>
            <a href="/monitoring" aria-label="Crew monitoring" title="Crew monitoring" aria-current={page === 'monitoring' ? 'page' : undefined}><MenuIcon name="monitoring" pulse={navPulse.href === '/monitoring' ? navPulse.sequence : 0} /><span>Crew monitoring</span></a>
            <a href="/measurements" aria-label="Measurements" title="Measurements" aria-current={page === 'measurements' ? 'page' : undefined}><MenuIcon name="measurements" pulse={navPulse.href === '/measurements' ? navPulse.sequence : 0} /><span>Measurements</span></a>
            <a href="/assessments" aria-label="Assessments" title="Assessments" aria-current={page === 'assessment' || page === 'assessments' ? 'page' : undefined}><MenuIcon name="assessments" pulse={navPulse.href === '/assessments' ? navPulse.sequence : 0} /><span>Assessments</span></a>
            <a href="/guides" aria-label="Emergency guides" title="Guides" aria-current={page === 'guides' ? 'page' : undefined}><MenuIcon name="guides" pulse={navPulse.href === '/guides' ? navPulse.sequence : 0} /><span>Guides</span></a>
            <a href="/mission" aria-label="Mission" title="Mission" aria-current={page === 'mission' ? 'page' : undefined}><MenuIcon name="mission" pulse={navPulse.href === '/mission' ? navPulse.sequence : 0} /><span>Mission</span></a>
            <a href="/scenarios" aria-label="Scenarios" title="Scenarios" aria-current={scenarios ? 'page' : undefined}><MenuIcon name="scenarios" pulse={navPulse.href === '/scenarios' ? navPulse.sequence : 0} /><span>Scenarios</span></a>
            <a href="/research" aria-label="Research" title="Research" aria-current={page === 'research' ? 'page' : undefined}><MenuIcon name="research" pulse={navPulse.href === '/research' ? navPulse.sequence : 0} /><span>Research</span></a>
          </nav>
          <a className="sidebar-user" href="/crew" aria-label={`Crew${mission.selected ? `: ${mission.selected.display_name}` : ''}`} title="Crew" aria-current={page === 'crew' ? 'page' : undefined}>
            <span className="sidebar-user-avatar"><UserRound size={19} aria-hidden="true" /></span>
            <span className="sidebar-user-details"><strong>{mission.selected?.display_name ?? 'Crew'}</strong><small>{mission.profile?.name ?? 'Select a crew member'}</small></span>
          </a>
      </aside>
      <main ref={main} id="main-content" className={`main-content ${home ? 'home' : 'inner-page'}`} tabIndex={-1} inert={isMobile && mobileMenuOpen}>
        <div className="console-statusbar" aria-label="Mission service status">
          <span className="console-identity"><Radio size={13} aria-hidden="true" /> ACHA <span>/</span> CREW HEALTH OPERATIONS</span>
          <div className="console-context"><span>{replay ? `${replay.subject} · ${missionElapsed(player.simulatedTime!)}` : mission.selected?.display_name ?? 'Crew not selected'}</span><span className="service-state" data-state={replay || local ? 'simulation' : !mission.online ? 'offline' : mission.connection}>
            {replay ? 'Synthetic training' : local ? 'Synthetic local records' : !mission.online ? 'Offline · cached workspace' : mission.connection === 'connected' ? 'Service connected · sample workspace' : mission.connection === 'checking' ? 'Connecting' : 'Service unavailable'}
          </span></div>
        </div>
        {local && !scenarios && !replay && <div className="connection-notice scenario-banner"><strong>Synthetic scenario</strong><span>Fictional crew records · Stored on this device</span>
          <button className="text-link" onClick={() => changeMode(false)}>Return to mission service</button></div>}
        {!scenarios && !replay && !mission.reachable && (mission.connection !== 'checking' || !mission.online) && <div className="connection-notice" role="status"><WifiOff size={15} />{mission.online ? 'Couldn’t refresh mission-service records.' : 'You’re offline. This device can show any records it has cached.'}{mission.online && <button className="text-link" onClick={() => void mission.refreshWorkspace()}>Retry</button>}{!home && <button className="text-link" onClick={() => changeMode(true)}>Open synthetic scenario</button>}</div>}
        {modeError && <p className="notice error" role="alert">{modeError}</p>}
        <div className="route-content">
          {home && <Home mission={mission} player={player} />}
          {page === 'monitoring' && <CrewMonitoring mission={mission} onOpenScenario={() => changeMode(true)} />}
          {scenarios && <MissionScenarios id={rawId} player={player} />}
          {page === 'assessment' && (
            <>
              <header className="page-title">
                <h1>Self-assessment</h1>
                <p className="crew-context">{mission.selected?.display_name}</p>
                <p>Use sample data in this public workspace. <a className="text-link" href="/mission/observations">Open mission observations</a></p>
              </header>
              {!mission.selected && (mission.connection !== 'checking' || !mission.online) && <p className="notice" role="status">
                <Radio size={18} aria-hidden="true" /> A crew member must be loaded before saving.
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
