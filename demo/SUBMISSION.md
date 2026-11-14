# Autonomous Crew Health Assistant

**Challenge** — Create Health Monitoring Software for Astronauts on Space Missions

## High-level summary

ACHA helps a crew record health observations, compare them with a personal reference, and respond to concerning symptoms during communication gaps. A check-in combines vital signs and symptom reports. A deterministic Python engine explains its findings, flags incomplete observations, and opens the relevant response guide. A local workstation performs the assessment without an Earth connection. The browser retains guides and queues observations when the onboard service temporarily goes away. Ground handover is simulated through a separate logical inbox and can be retried safely.

## How we address the challenge

| Challenge goal | ACHA demonstration |
| --- | --- |
| Gather health indicators | Manual entry with units, instrument availability, quality checks, timestamps and persistent history |
| Evaluate health status | Personal baseline comparison, time-window trends, symptoms, and optional NEWS2 reference calculation |
| Act on a result | Visible rationale and immediate access to cached emergency and review guidance |
| Operate during communications outages | Local assessment, cached guides, persistent queued browser entries and a simulated ground receipt |

## Data and references

- [NASA Space Apps 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/) frames the design.
- [NASA autonomous clinical decision support research](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/) supports the onboard decision workflow.
- [SpaceX Inspiration4 crew study](https://www.nature.com/articles/s41586-024-07648-x) informs monitoring context and personal comparisons. Crew records in the interactive demo are synthetic.
- [Royal College of Physicians NEWS2](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/) supplies reference score arithmetic.
- [PhysioNet BIDMC](https://physionet.org/content/bidmc/1.0.0/) supplies real hospital observations for calculation verification. The dataset contains no mission-specific outcomes supporting clinical validation.

## Demo narration

“ACHA helps astronauts gather, evaluate and act on health observations when Earth communication is delayed. We log a routine check-in locally, then watch the explanation change as pulse moves away from the personal reference. An incomplete check-in reporting chest pain still opens the emergency guide. The onboard app keeps observations and guidance available through the communication gap.”

Live sequence and setup are in START_HERE.md. Use the demo link provided by the team when entering the official project page. This bundle has no public hosting or submission receipt.
