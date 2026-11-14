# Autonomous Crew Health Assistant

**Challenge** — Create Health Monitoring Software for Astronauts on Space Missions

## High-level summary

ACHA helps a crew record health observations, compare them with a personal reference, and respond to concerning symptoms during communication gaps. A check-in combines vital signs and symptom reports. A deterministic Python engine explains its findings, flags incomplete observations, and opens the relevant response guide. A local workstation performs the assessment without an Earth connection. The browser retains guides and queues observations when the onboard service temporarily goes away. Ground handover is simulated through a separate logical inbox and can be retried safely.

## How we address the challenge

| Challenge goal | Public React site | Local onboard demo |
| --- | --- | --- |
| Gather health indicators | Enter symptoms or record heart rate, oxygen saturation, blood pressure and temperature for later review and assessment | Manual observations with units, timestamps, instrument availability, quality checks and persistent history |
| Evaluate health status | Rule-based evaluation of symptoms and supported readings, plus a descriptive comparison with the same crew member’s recent history | Symptom and vital-sign rules, a synthetic baseline and time-window trends, and optional NEWS2 reference scoring |
| Act on a result | Visible rationale and access to cached demonstration guidance | Visible rationale, demonstration guidance and simulated ground handover |
| Operate during communications outages | Cached records and guides, plus an assessment queue that syncs when the API returns | Local evaluation while the onboard server is running, with no Earth connection required |

## Data and references

- [NASA Space Apps 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/) frames the design.
- [NASA's five spaceflight hazards](https://www.nasa.gov/hrp/hazards/) connects distance from Earth to the need for an onboard workflow. [NASA's spaceflight risks](https://www.nasa.gov/hrp/risks/) provides cardiovascular context for tracking heart rate and blood pressure.
- [Ongoing NASA HRP research](https://www.nasa.gov/hrp/ongoing-hrp-research/) describes studies such as Standard Measures and ARCHeR. They provide research context for consistent observations and possible future sleep and well-being indicators.
- [CSA research on the ISS](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp) describes how experiments investigate health changes in space. [CSA radiation monitoring](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp) describes the specialized instruments used for radiation exposure, which is outside the current ACHA measurement set.
- [NASA autonomous clinical decision support research](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/) supports the onboard decision workflow.
- [SpaceX Inspiration4 crew study](https://www.nature.com/articles/s41586-024-07648-x) informs monitoring context and personal comparisons. Crew records in the interactive demo are synthetic.
- [Royal College of Physicians NEWS2](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/) supplies reference score arithmetic.
- [PhysioNet BIDMC](https://physionet.org/content/bidmc/1.0.0/) supplies real hospital observations for calculation verification. The dataset contains no mission-specific outcomes supporting clinical validation.

## Demo narration

“ACHA helps astronauts gather, evaluate and act on health observations when Earth communication is delayed. We log a routine check-in locally, then watch the explanation change as pulse moves away from the personal reference. An incomplete check-in reporting chest pain still opens the emergency guide. The onboard app keeps observations and guidance available through the communication gap.”

Live sequence and setup are in START_HERE.md. Use the demo link provided by the team when entering the official project page. This bundle has no public hosting or submission receipt.
