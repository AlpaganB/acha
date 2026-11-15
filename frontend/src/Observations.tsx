import { useState } from 'react'
import { ObservationTrends } from './ObservationTrends'
import { ObservationHistory, RestrictedLog } from './RestrictedLog'
import { trainingParameters, trainingRecords } from './trainingObservations'

export function Observations({ restricted = false }: { restricted?: boolean }) {
  const [mode, setMode] = useState(restricted ? 'secure' : 'training')
  return <>
    <header className="page-title"><h1>Mission observations</h1>
      <p>{mode === 'training' ? 'Synthetic crew and habitat observations for offline training.' : 'Access-controlled mission records.'}</p>
    </header>
    <label className="observation-mode">Data source<select value={mode} onChange={event => setMode(event.target.value)}>
      <option value="training">Synthetic training scenario</option><option value="secure">Restricted mission log</option>
    </select></label>
    {mode === 'training' ? <>
      <ObservationTrends records={trainingRecords} definitions={trainingParameters} />
      <ObservationHistory records={trainingRecords} definitions={trainingParameters} />
    </> : <RestrictedLog />}
  </>
}
