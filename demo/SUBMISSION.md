# Autonomous Crew Health Assistant

**Challenge** — Create Health Monitoring Software for Astronauts on Space Missions

## High-level summary

ACHA helps crew members record health observations, compare measurements with their personal reference values, and find guidance during communication outages. A check-in can contain vital signs, symptoms, or both. A rule-based Python engine explains its findings, identifies missing information, and links to a relevant training guide when one is available. The standalone demo evaluates check-ins on a local workstation without a connection to Earth. If the onboard service becomes unavailable, the browser keeps guides accessible and queues check-ins for later submission. The standalone demo simulates handover to ground support and accepts retries without duplicating records.

## How we address the challenge

| Challenge goal | Public React site | Local onboard demo |
| --- | --- | --- |
| Gather health indicators | Report symptoms or record heart rate, respiratory rate, blood oxygen saturation, blood pressure, body temperature, and sleep duration | Record observations with units and timestamps, report unavailable instruments, and review saved readings |
| Evaluate health status | Rule-based evaluation of symptoms and supported readings, plus a descriptive comparison with the same crew member’s recent history | Symptom and vital-sign rules, a synthetic baseline and time-window trends, and optional NEWS2 reference scoring |
| Act on a result | Visible rationale and access to cached demonstration guidance | Visible rationale, demonstration guidance and simulated ground handover |
| Operate during communications outages | Cached records and guides, plus an assessment queue that syncs when the API returns | Local evaluation while the onboard server is running, with no Earth connection required |

## Data and references

- [NASA Space Apps 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/) frames the design.
- NASA’s descriptions of spaceflight hazards and cardiovascular risks inform the onboard workflow and the choice to track heart rate and blood pressure. [Spaceflight hazards](https://www.nasa.gov/hrp/hazards/) · [Spaceflight risks](https://www.nasa.gov/hrp/risks/)
- [Ongoing NASA HRP research](https://www.nasa.gov/hrp/ongoing-hrp-research/) describes studies such as Standard Measures and ARCHeR. They provide research context for consistent observations and possible future sleep and well-being indicators.
- Canadian Space Agency resources describe research into health changes in space and the instruments used to monitor radiation exposure. ACHA can display historical ISS instrument readings and record personal dosimeter readings in the restricted log. [CSA research on the ISS](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp) · [CSA radiation monitoring](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp)
- [NASA autonomous clinical decision support research](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/) supports the onboard decision workflow.
- [SpaceX Inspiration4 crew study](https://www.nature.com/articles/s41586-024-07648-x) informs monitoring context and personal comparisons. Crew records in the interactive demo are synthetic.
- [Royal College of Physicians NEWS2](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/) supplies reference score arithmetic.
- [PhysioNet BIDMC](https://physionet.org/content/bidmc/1.0.0/) supplies real hospital observations for calculation verification. The dataset contains no mission-specific outcomes supporting clinical validation.

## Demo narration

“ACHA helps astronauts record and assess health observations when communication with Earth is delayed. In this training scenario, we record a check-in on the onboard workstation and see why a change in pulse is flagged. When a crew member reports chest pain, the result links to the emergency training guide even with missing measurements. The onboard app keeps the observations and guidance available during the outage.”

Follow the [onboard demo instructions](START_HERE.md) to run the scenario locally. The [live React app](https://acha.tr/) shows the connected workflow.
