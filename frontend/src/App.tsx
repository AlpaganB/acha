import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, ChevronDown, Radio, WifiOff, LayoutDashboard, Activity,
  ClipboardList, Orbit, BookOpen, FlaskConical, HeartPulse, Droplets, Gauge, Thermometer, Plus, Menu, UserRound,
} from 'lucide-react'
import { AssessmentForm } from './AssessmentForm'
import { AssessmentHistory, AssessmentResult, Records } from './AssessmentResults'
import { Guidance } from './Guidance'
import { HealthMonitoring, MonitoringLinks } from './HealthMonitoring'
import { Measurements } from './Measurements'
import { AnatomyDashboard } from './AnatomyDashboard'
import { Observations } from './Observations'
import { Pressure } from './Pressure'
import { Crew } from './Crew'
import { Research } from './Research'
import { environmentLabels, formatDate, measurementLabels } from './content'
import { navigate } from './navigation'
import { useMission } from './useMission'
import { readLocal, saveLocal } from './storage'
import type { Measurement, MissionProfile } from './api'

type Mission = ReturnType<typeof useMission>

const vitalIcons = { heart_rate: HeartPulse, spo2: Droplets, blood_pressure: Gauge, body_temperature: Thermometer }

const menuIcons = { overview: LayoutDashboard, measurements: Activity, assessments: ClipboardList, mission: Orbit, guides: BookOpen, research: FlaskConical }
function MenuIcon({ name, pulse }: { name: keyof typeof menuIcons; pulse: number }) {
  const Icon = menuIcons[name]
  return <Icon key={pulse} size={19} aria-hidden="true" className={`nav-icon nav-icon-${name}${pulse ? ' nav-icon-play' : ''}`}>
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
        {Object.keys(vitalIcons).map(kind => {
          const label = measurementLabels[kind]
          const reading = latest.get(kind)
          const Icon = vitalIcons[kind as keyof typeof vitalIcons]
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

function Home({ mission, showIntro, onIntroStarted }: { mission: Mission; showIntro: boolean; onIntroStarted: () => void }) {
  return (
    <>
      <header className="overview-heading">
        <div>
          <h1>Health overview</h1>
        </div>
        <div className="overview-actions">
          <a className="button secondary" href="/assessment"><ClipboardList size={16} /> Start assessment</a>
          <a className="button primary" href="/measurements"><Plus size={17} /> Record measurement</a>
        </div>
      </header>
      <MonitoringLinks />
      <AnatomyDashboard crewId={mission.selected?.id} measurements={mission.measurements} assessments={mission.history}
        reachable={mission.reachable} showIntro={showIntro} onIntroStarted={onIntroStarted} />
      <LatestMeasurements measurements={mission.measurements} pending={mission.measurementsPending}
          available={mission.measurementsAvailable} />
      <div className="dashboard-support">
      <div className="overview-aside">
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
        <section className="surface mission-summary" aria-labelledby="mission-summary-heading">
          <div className="section-heading"><h2 id="mission-summary-heading">Mission</h2></div>
          <div className="mission-emblem"><Orbit size={30} aria-hidden="true" /><span>{mission.profile?.name ?? 'Unavailable'}<small>{mission.profile ? environmentLabels[mission.profile.environment] : ''}</small></span></div>
          <dl className="detail-list"><div><dt>Available equipment</dt><dd>{mission.profile?.equipment.join(', ') || 'No equipment listed'}</dd></div></dl>
          <a className="text-link" href="/mission">View mission profile <ArrowRight size={14} /></a>
        </section>
        <a className="surface guide-shortcut" href="/guides"><BookOpen size={20} /><span><strong>Emergency guides</strong><small>Training guides and onboard protocol references</small></span><ArrowRight size={17} /></a>
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
    </>
  )
}

export function App() {
  const mission = useMission()
  const route = useRoute()
  useOfflineShell()
  const main = useRef<HTMLElement>(null)
  const previousRoute = useRef(route)
  const anatomyIntroSeen = useRef(false)
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
  const requestedKind = params.get('kind') ?? ''
  const restrictedLog = params.get('source') === 'restricted'
  const researchView = params.get('view') ?? ''
  const initialKind = Object.hasOwn(measurementLabels, requestedKind) ? requestedKind : ''
  const home = !['assessment', 'assessments', 'measurements', 'guides', 'mission', 'research', 'crew'].includes(page)

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
          <nav className="main-nav" aria-label="Primary navigation">
            <a href="/" aria-label="Overview" title="Overview" aria-current={home ? 'page' : undefined}><MenuIcon name="overview" pulse={navPulse.href === '/' ? navPulse.sequence : 0} /><span>Overview</span></a>
            <a href="/measurements" aria-label="Measurements" title="Measurements" aria-current={page === 'measurements' ? 'page' : undefined}><MenuIcon name="measurements" pulse={navPulse.href === '/measurements' ? navPulse.sequence : 0} /><span>Measurements</span></a>
            <a href="/assessments" aria-label="Assessments" title="Assessments" aria-current={page === 'assessment' || page === 'assessments' ? 'page' : undefined}><MenuIcon name="assessments" pulse={navPulse.href === '/assessments' ? navPulse.sequence : 0} /><span>Assessments</span></a>
            <a href="/mission" aria-label="Mission" title="Mission" aria-current={page === 'mission' ? 'page' : undefined}><MenuIcon name="mission" pulse={navPulse.href === '/mission' ? navPulse.sequence : 0} /><span>Mission</span></a>
            <a href="/guides" aria-label="Emergency guides" title="Guides" aria-current={page === 'guides' ? 'page' : undefined}><MenuIcon name="guides" pulse={navPulse.href === '/guides' ? navPulse.sequence : 0} /><span>Guides</span></a>
            <a href="/research" aria-label="Research" title="Research" aria-current={page === 'research' ? 'page' : undefined}><MenuIcon name="research" pulse={navPulse.href === '/research' ? navPulse.sequence : 0} /><span>Research</span></a>
          </nav>
          <a className="sidebar-user" href="/crew" aria-label={`Crew${mission.selected ? `: ${mission.selected.display_name}` : ''}`} title="Crew" aria-current={page === 'crew' ? 'page' : undefined}>
            <span className="sidebar-user-avatar"><UserRound size={19} aria-hidden="true" /></span>
            <span className="sidebar-user-details"><strong>{mission.selected?.display_name ?? 'Crew'}</strong><small>{mission.profile?.name ?? 'Select a crew member'}</small></span>
          </a>
      </aside>
      <main ref={main} id="main-content" className={`main-content ${home ? 'home' : 'inner-page'}`} tabIndex={-1} inert={isMobile && mobileMenuOpen}>
        {!mission.reachable && (mission.connection !== 'checking' || !mission.online) && <p className="connection-notice" role="status"><WifiOff size={15} />{mission.online ? 'Couldn’t refresh your records.' : 'You’re offline. Any records saved on this device are still available.'}{mission.online && <button className="text-link" onClick={() => void mission.refreshWorkspace()}>Retry</button>}</p>}
        <div className="route-content">
          {home && <Home mission={mission} showIntro={!anatomyIntroSeen.current} onIntroStarted={() => { anatomyIntroSeen.current = true }} />}
          {page === 'assessment' && (
            <>
              <header className="page-title">
                <h1>Self-assessment</h1>
                <p className="crew-context">{mission.selected?.display_name}</p>
                <p>Use sample data in this public demo. <a className="text-link" href="/mission/observations">Open mission observations</a></p>
              </header>
              {!mission.selected && (mission.connection !== 'checking' || !mission.online) && <p className="notice" role="status">
                <Radio size={18} aria-hidden="true" /> A crew member must be loaded before saving.
                <a className="text-link" href="/mission">Open mission profile</a>
              </p>}
              <AssessmentForm key={`${mission.selected?.id}:${initialMeasurementId}`} initialMeasurementId={initialMeasurementId}
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
          {page === 'mission' && id === 'pressure' && <Pressure />}
          {page === 'mission' && id === 'monitoring' && <HealthMonitoring crew={mission.selected} reachable={mission.reachable} />}
          {page === 'mission' && id === 'observations' && <Observations key={String(restrictedLog)} restricted={restrictedLog} />}
          {page === 'mission' && !['pressure', 'observations', 'monitoring'].includes(id ?? '') && <MissionProfiles mission={mission} />}
          {page === 'crew' && <Crew members={mission.crew} profiles={mission.profiles} selectedId={mission.selected?.id} pending={mission.connection === 'checking'} onSelect={mission.selectCrew} />}
          {page === 'measurements' && <Measurements key={`${mission.selected?.id}:${initialKind}`} initialKind={initialKind} crew={mission.selected} measurements={mission.measurements}
            pending={mission.measurementsPending} reachable={mission.reachable} onSave={mission.recordMeasurement} onReconnect={mission.refreshWorkspace} />}
          {page === 'research' && <Research view={researchView} />}
        </div>
      </main>
    </div>
  )
}
