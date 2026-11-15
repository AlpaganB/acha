import { ArrowLeft, ArrowRight } from 'lucide-react'
import { missionScenarios } from './missionScenarioData'
import { ScenarioConsole } from './ScenarioConsole'
import type { ScenarioPlayer } from './useScenarioPlayer'
import './mission-scenarios.css'

function ScenarioLibrary({ missing }: { missing: boolean }) {
  return <div className="scenario-page">
    <header className="page-title">
      <h1>Training scenarios</h1>
      <p>Replays use synthetic crew data.</p>
    </header>
    {missing && <p className="notice" role="status">This scenario was not found. Choose a replay below.</p>}
    <div className="scenario-catalog" aria-label="Available mission scenarios">
      {missionScenarios.map(scenario => {

        return <a className={`scenario-card surface ${scenario.id}`} href={`/scenarios/${scenario.id}`} key={scenario.id}>
          <p className="scenario-meta">{scenario.environment} · {scenario.duration}</p>
          <h2>{scenario.title}</h2>
          <p>{scenario.intro}</p>
          <span className="scenario-card-action">Open scenario <ArrowRight size={16} aria-hidden="true" /></span>
        </a>
      })}
    </div>
  </div>
}

export function MissionScenarios({ id, player }: { id?: string; player: ScenarioPlayer }) {
  const scenario = missionScenarios.find(item => item.id === id)
  if (!scenario) return <ScenarioLibrary missing={Boolean(id)} />
  if (player.scenario?.id !== id) return null

  return <div className={`scenario-page ${scenario.id}`}>
    <header className="scenario-replay-header">
      <a className="text-link scenario-back" href="/scenarios"><ArrowLeft size={15} aria-hidden="true" /> All scenarios</a>
      <div className="scenario-title-row">
        <div><p className="scenario-meta">{scenario.environment} · {scenario.duration} · Synthetic data</p><h1>{scenario.title}</h1></div>
      </div>
      <p>{scenario.intro}</p>
    </header>
    <ScenarioConsole player={player} />
  </div>
}
