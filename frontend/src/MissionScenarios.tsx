import { ArrowLeft, ArrowRight, Clock3, Gauge, Moon, Radio } from 'lucide-react'
import { missionScenarios } from './missionScenarioData'
import { ScenarioConsole } from './ScenarioConsole'
import type { ScenarioPlayer } from './useScenarioPlayer'
import './mission-scenarios.css'

const icons = { 'lunar-fatigue': Moon, 'orbital-pressure': Gauge, 'solar-event': Radio }

function ScenarioLibrary({ missing }: { missing: boolean }) {
  return <div className="scenario-page">
    <header className="scenario-library-header surface">
      <p className="eyebrow">ACHA · Mission training</p>
      <h1>Space mission scenarios</h1>
      <p>Replay three fictional missions to see how ACHA brings together measurements, crew observations, and follow-up over time.</p>
      <span className="scenario-chip">Synthetic data · Runs in this browser</span>
    </header>
    {missing && <p className="notice" role="status">This scenario was not found. Choose a replay below.</p>}
    <div className="scenario-catalog" aria-label="Available mission scenarios">
      {missionScenarios.map(scenario => {
        const Icon = icons[scenario.id]
        return <a className={`scenario-card surface ${scenario.id}`} href={`/scenarios/${scenario.id}`} key={scenario.id}>
          <div className="scenario-card-top"><span className="scenario-icon"><Icon size={22} aria-hidden="true" /></span>
            <span className="scenario-duration"><Clock3 size={14} aria-hidden="true" /> {scenario.duration}</span></div>
          <p className="eyebrow">{scenario.environment}</p>
          <h2>{scenario.title}</h2>
          <p>{scenario.intro}</p>
          <ul className="scenario-topics" aria-label="Topics">{scenario.topics.map(topic => <li key={topic}>{topic}</li>)}</ul>
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
  const Icon = icons[scenario.id]
  return <div className={`scenario-page ${scenario.id}`}>
    <header className="scenario-replay-header">
      <a className="text-link scenario-back" href="/"><ArrowLeft size={15} aria-hidden="true" /> Overview console</a>
      <div className="scenario-title-row"><span className="scenario-icon"><Icon size={25} aria-hidden="true" /></span>
        <div><p className="eyebrow">{scenario.environment} · {scenario.duration} · Synthetic replay</p><h1>{scenario.title}</h1></div>
      </div>
      <p>{scenario.intro}</p>
    </header>
    <ScenarioConsole player={player} />
  </div>
}
