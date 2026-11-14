import { ArrowLeft, ArrowRight, BookOpen, HeartPulse, ShieldAlert, Wind } from 'lucide-react'
import type { MissionProfile } from './api'
import { guides, guideTopicId, humanize } from './content'

const guideIcons = { chest_pain: HeartPulse, shortness_of_breath: Wind, loss_of_consciousness: ShieldAlert }

export function EmergencyNotice() {
  return (
    <aside className="emergency-notice" aria-label="Emergency contact">
      <ShieldAlert size={22} aria-hidden="true" />
      <div>
        <strong>For an immediate emergency</strong>
        <p>Use your mission’s emergency communication channel and follow the approved onboard procedure.</p>
      </div>
    </aside>
  )
}

export function Guidance({ profile, guideId }: { profile?: MissionProfile; guideId?: string }) {
  const guide = guideId ? guides.find(item => item.id === guideTopicId(guideId)) : undefined
  const profileIds = [...new Set(profile?.guidance_protocol_ids.map(guideTopicId))]

  if (guideId) {
    return (
      <>
        <a className="back-link" href="#guides"><ArrowLeft size={16} aria-hidden="true" /> All emergency guides</a>
        <header className="page-title">
          <h1>{guide?.title ?? humanize(guideId)}</h1>
          <p>{guide?.description ?? 'Referenced by the mission or assessment service.'}</p>
        </header>
        {guide?.id !== 'demo-review' && <EmergencyNotice />}
        <section className="surface guide-detail">
          <BookOpen size={24} aria-hidden="true" />
          <div>
            {guide && guide.handoff.length > 0 && <>
              <h2>What to report</h2>
              <p>Relay the details you already have when you contact the crew.</p>
              <ul className="handoff-list">{guide.handoff.map(item => <li key={item}>{item}</li>)}</ul>
            </>}
            {guide ? <>
              <h2>Demonstration guidance</h2>
              <p>Training content. For an actual incident, follow the approved onboard procedure.</p>
              <ol className="handoff-list">{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
              <a className="text-link" href={guide.source} target="_blank" rel="noreferrer">Read source online</a>
            </> : <>
              <h2>Onboard procedure</h2>
              <p>Use the mission’s approved onboard medical reference. Procedure text for this topic is unavailable in ACHA.</p>
            </>}
            <dl className="detail-list">
              <div><dt>Protocol reference</dt><dd>{guide?.demoReference ?? guideId}</dd></div>
              {profile && <div><dt>Active mission profile</dt><dd>{profile.name}</dd></div>}
            </dl>
          </div>
        </section>
      </>
    )
  }

  const missionGuides = profileIds.filter(id => !guides.some(guide => guide.id === id))
  const displayGuides = [...guides].sort((a, b) =>
    Number(profileIds.includes(b.id)) - Number(profileIds.includes(a.id)))

  return (
    <>
      <header className="page-title">
        <h1>Emergency guides</h1>
        <p>Open a demonstration guide or find a reference for the active mission.</p>
      </header>
      <EmergencyNotice />
      <section className="surface guide-list" aria-label="Emergency topics">
        {[...displayGuides, ...missionGuides.map(id => ({
          id, title: humanize(id), description: 'Referenced by the active mission profile',
        }))].map(item => {
          const Icon = guideIcons[item.id as keyof typeof guideIcons] ?? BookOpen
          return (
            <a key={item.id} className="guide-row" href={`#guides/${encodeURIComponent(item.id)}`}>
              <span className="icon-tile"><Icon size={20} aria-hidden="true" /></span>
              <span><strong>{item.title}</strong><small>{item.description}</small></span>
              {profileIds.includes(item.id) && <span className="guide-profile">Mission profile</span>}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          )
        })}
      </section>
    </>
  )
}
