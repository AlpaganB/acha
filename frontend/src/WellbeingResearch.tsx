import archive from './data/qol-stress.json'

const results = [
  { name: 'Perceived Stress Scale (PSS-14)', values: archive.pss },
  { name: 'State anxiety after relaxation (STAI-S)', values: archive.relaxation },
  { name: 'State anxiety after task (STAI-S)', values: archive.task },
  { name: 'Within-participant change (task minus relaxation)', values: archive.pairedChange },
]

export function WellbeingResearch() {
  return <section className="surface form-panel" aria-labelledby="wellbeing-research">
    <h2 id="wellbeing-research">Stress and self-report research</h2>
    <p>QoL_Stress · A controlled study of 66 adult volunteers who completed relaxation and stress-induction tasks on Earth.</p>
    <div className="research-table" role="region" aria-label="Aggregate questionnaire scores" tabIndex={0}><table>
      <thead><tr><th scope="col">Published measure</th><th scope="col">People</th><th scope="col">Median</th><th scope="col">Observed min–max</th></tr></thead>
      <tbody>{results.map(({ name, values }) => <tr key={name}><th scope="row">{name}</th>
        <td>{values.count}</td><td>{values.median}</td><td>{values.low} to {values.high}</td></tr>)}</tbody>
    </table></div>
    <p className="muted">The paired row summarizes each person’s difference before taking the cohort median. Scores describe the study at group level. Flight validation and clinical thresholds require separate evidence.</p>
    <div className="form-actions"><a className="text-link" href="https://doi.org/10.13026/vqtz-pm70">Calvo, Cejudo and Martín Andonegui · PhysioNet</a>
      <a className="text-link" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></div>
  </section>
}
