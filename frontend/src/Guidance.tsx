import { ArrowLeft, ChevronRight, ShieldAlert } from 'lucide-react'
import type { MissionProfile } from './api'
import { guides, guideTopicId, humanize } from './content'

export function EmergencyNotice() {
  return (
    <aside className="emergency-notice" aria-label="Emergency contact">
      <ShieldAlert size={22} aria-hidden="true" />
      <div>
        <strong>In an emergency</strong>
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
        <a className="back-link" href="/guides"><ArrowLeft size={16} aria-hidden="true" /> All emergency guides</a>
        <header className="page-title">
          <h1>{guide?.title ?? humanize(guideId)}</h1>
          <p>{guide?.description ?? 'This protocol is linked to a mission profile or an assessment.'}</p>
        </header>
        {guide?.id !== 'demo-review' && <EmergencyNotice />}
        <section className="surface guide-detail">
          <div>
            {guide && guide.handoff.length > 0 && <>
              <h2>What to report</h2>
              <p>When you contact the crew, share the details you already have.</p>
              <ul className="handoff-list">{guide.handoff.map(item => <li key={item}>{item}</li>)}</ul>
            </>}
            {guide ? <>
              <h2>Training guide</h2>
              <p>For an actual incident, follow the mission’s approved onboard procedure.</p>
              <ol className="handoff-list">{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
              <a className="text-link" href={guide.source} target="_blank" rel="noreferrer">Read the source online</a>
            </> : <>
              <h2>Onboard procedure</h2>
              <p>ACHA has the protocol reference only. Use the mission’s approved onboard medical reference for the full procedure.</p>
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
      </header>
      <EmergencyNotice />
      <section className="surface guide-list" aria-label="Emergency topics">
        {[...displayGuides, ...missionGuides.map(id => ({
          id, title: humanize(id), description: 'Referenced by the active mission profile',
        }))].map(item => (
            <a key={item.id} className="guide-row" href={`/guides/${encodeURIComponent(item.id)}`}>
              <span className="record-label"><strong>{item.title}</strong><small>{item.description}</small></span>
              {profileIds.includes(item.id) && <span className="guide-profile">Mission profile</span>}
              <ChevronRight size={17} aria-hidden="true" />
            </a>
        ))}
      </section>
    </>
  )
}
