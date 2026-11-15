const evidence = [
  { title: 'NASA Space Apps challenge', use: 'Collect indicators, review changes, and act through a crew check-in.',
    source: 'https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/' },
  { title: 'Spaceflight Standard Measures', use: 'Sleep and light, cognition, immune and metabolic chemistry, orthostatic response, balance, and team processes inform the observation catalog.',
    source: 'https://www.nasa.gov/reference/standard-measures/' },
  { title: 'NASA-STD-3001', use: 'Volume 1 informs crew health review. Volume 2 informs atmosphere recording and display. Program procedures and approved protocols govern operational use.',
    source: 'https://www.nasa.gov/ochmo/human-spaceflight-and-aviation-standards/' },
  { title: 'Human Research Program evidence reports', use: 'Risk-specific studies provide context for interpreting crew measurements and planning what information to collect.',
    source: 'https://humanresearchroadmap.nasa.gov/Evidence/' },
  { title: 'Life Sciences Data Archive', use: 'Study metadata and data-access requirements for human spaceflight and analog research.',
    source: 'https://data.nasa.gov/dataset/nasa-life-sciences-portal-nlsp' },
]

export function Evidence() {
  return <section className="surface form-panel observation-stack" aria-labelledby="evidence-heading">
    <h2 id="evidence-heading">NASA sources used by ACHA</h2>
    <dl className="detail-list">{evidence.map(item => <div key={item.title}>
      <dt>{item.title}</dt><dd>{item.use} <a className="text-link" href={item.source}>Open source</a></dd>
    </div>)}</dl>
    <h3>Dataset populations</h3>
    <dl className="detail-list">
      <div><dt>Human spaceflight</dt><dd>OSDR assay coverage summarizes Inspiration4 serum and urine files from four private astronauts. <a className="text-link" href="/research?view=laboratory">Laboratory archive</a></dd></div>
      <div><dt>ISS environment</dt><dd>RR-6 records cabin measurements from a rodent research mission. DosTel1 records historical values at a fixed radiation instrument. <a className="text-link" href="/research">Cabin archive</a> · <a className="text-link" href="/research?view=radiation">Radiation archive</a></dd></div>
      <div><dt>Terrestrial research</dt><dd>BIDMC replays hospital measurements, Sleep-EDF uses scored terrestrial sleep recordings, and QoL_Stress summarizes controlled tasks. <a className="text-link" href="/research?view=waveforms">Waveforms</a> · <a className="text-link" href="/research?view=sleep">Sleep</a> · <a className="text-link" href="/research?view=wellbeing">Well-being</a></dd></div>
      <div><dt>Crew baselines</dt><dd>Calculated from the selected crew member’s own history in the current workspace.</dd></div>
    </dl>
  </section>
}
