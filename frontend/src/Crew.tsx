import { Check, UserRound } from 'lucide-react'
import { CreateCrew, CrewDetails } from './WorkspaceTools'
import type { CrewMember, MissionProfile } from './api'

export function Crew({ members, profiles, selectedId, pending, reachable, local = false, onCreated, onSelect }: {
  members: CrewMember[]; profiles: MissionProfile[]; selectedId?: string; pending: boolean
  local?: boolean; reachable: boolean; onCreated: () => Promise<void>
  onSelect: (id: string) => void
}) {
  return <>
    <header className="page-title"><h1>Crew</h1></header>
    <section className="crew-members" aria-label="Crew members" aria-busy={pending}>
      {members.map(member => <button key={member.id} className="surface crew-member-card" aria-pressed={selectedId === member.id} onClick={() => onSelect(member.id)}>
        <span className="crew-avatar" aria-hidden="true"><UserRound size={23} /></span>
        <span className="crew-member-name"><strong>{member.display_name}</strong><small>{profiles.find(profile => profile.id === member.mission_profile_id)?.name ?? 'No mission assigned'}</small></span>
        {selectedId === member.id && <span className="crew-member-selected"><Check size={15} />Selected</span>}
      </button>)}
      {!members.length && <p className="empty-state">{pending ? 'Loading crew…' : 'Crew members are unavailable.'}</p>}
    </section>
    {selectedId && <div className="form-actions"><a className="button primary" href="/">Open dashboard</a><a className="text-link" href="/mission">Mission profile</a></div>}
    {selectedId && !local && <CrewDetails key={selectedId} id={selectedId} profiles={profiles} reachable={reachable} />}
    {!local && <CreateCrew profiles={profiles} reachable={reachable} onCreated={onCreated} />}
  </>
}
