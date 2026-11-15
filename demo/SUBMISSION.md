# Autonomous Crew Health Assistant

**Challenge** — Create Health Monitoring Software for Astronauts on Space Missions

## High-level summary

ACHA is a crew health research and training prototype for missions with delayed Earth support. Its Mission Health Command Center brings observations, a body systems illustration, data quality events, and follow-up together. In the Lunar Fatigue exercise, a crew member records short sleep, fatigue and a higher pulse. ACHA shows the comparison and its missing context, then lets the judge record a resting repeat, attach it to the original check-in and close the fictional workflow. Orbital Pressure and Solar Relay Outage show sensor gaps and simulated ground handover. The separate onboard Python demo runs assessment rules on a local workstation and can operate during an Earth link outage.

## How we address the challenge

| Challenge goal | Public React site | Local onboard demo |
| --- | --- | --- |
| Gather health indicators | Report symptoms or record heart rate, respiratory rate, blood oxygen saturation, blood pressure, body temperature, and sleep duration | Record observations with units and timestamps, report unavailable instruments, and review saved readings |
| Evaluate health status | Rule-based evaluation of symptoms and supported readings, plus a descriptive comparison with the same crew member’s recent history | Symptom and vital-sign rules, a synthetic baseline and time-window trends, and optional NEWS2 reference scoring |
| Act on a result | Visible rationale, linked repeat measurements, and recorded follow-up or check-in closure | Visible rationale, demonstration guidance and simulated ground handover |
| Operate during communications outages | Explicit local synthetic scenario with persistent follow-up, cached sample records and a separate assessment queue for mission-service mode | Local evaluation while the onboard server is running, with no Earth connection required |

## Data and references

- [NASA Space Apps 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/) frames the design.
- The Research interface uses [OSDR RR-6](https://osdr.nasa.gov/bio/repo/data/payloads/RR-6) for historical ISS cabin temperature, humidity and CO₂, and [OSDR RadLab DosTel1](https://visualization.osdr.nasa.gov/radlab/gui/knowledgebase/dostel1) for archived fixed-instrument radiation dose rates. These are separate from the fictional crew observations. See the [provenance and licensing sheet](../docs/competition-release.md#provenance-and-licensing).
- NASA’s descriptions of spaceflight hazards and cardiovascular risks inform the onboard workflow and the choice to track heart rate and blood pressure. [Spaceflight hazards](https://www.nasa.gov/hrp/hazards/) · [Spaceflight risks](https://www.nasa.gov/hrp/risks/)
- [Ongoing NASA HRP research](https://www.nasa.gov/hrp/ongoing-hrp-research/) describes studies such as Standard Measures and ARCHeR. They provide research context for consistent observations and possible future sleep and well-being indicators.
- Canadian Space Agency resources describe research into health changes in space and the instruments used to monitor radiation exposure. ACHA can display historical ISS instrument readings and record personal dosimeter readings in the restricted log. [CSA research on the ISS](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp) · [CSA radiation monitoring](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp)
- [NASA autonomous clinical decision support research](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/) supports the onboard decision workflow.
- [SpaceX Inspiration4 crew study](https://www.nature.com/articles/s41586-024-07648-x) informs monitoring context and personal comparisons. Crew records in the interactive demo are synthetic.
- [Royal College of Physicians NEWS2](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/) supplies reference score arithmetic.
- [PhysioNet BIDMC](https://physionet.org/content/bidmc/1.0.0/) supplies real hospital observations for calculation verification. The dataset contains no mission-specific outcomes supporting clinical validation.

## 90-second judge script

| Time | Show and say |
| --- | --- |
| 0–15 s | Open Overview in a fresh browser. Click **Try a 90-second training scenario** and pause at the first checkpoint. “This fictional crew starts with a resting pulse of 66 bpm. That matches the median of five prior training sessions.” |
| 15–35 s | Step to **Fatigue check-in**. “The crew reports five hours of sleep and slower task performance. Pulse is 83 bpm, 17 above the reference. Activity and posture were unavailable, so this is a provisional review item.” Click **Read why** to open the evidence and pulse trace. |
| 35–65 s | Open the fictional check-in, move to the next checkpoint, record the **72 bpm** repeat at rest, link it and close. “The original reading and the repeat remain linked. Closing records workflow completion. All practice changes stay in this browser.” |
| 65–82 s | Select **Solar relay outage** and step to the peak, then to receipt. “At the peak, the vehicle monitor shows 250 µGy/h and the separate personal instrument shows 430 µGy accumulated. The simulated handover progresses from queued to sent to acknowledged.” |
| 82–90 s | Show Research or an explicitly labeled capture. “ACHA also displays genuine NASA cabin environment and fixed-instrument archives. Each archive has its own source and units.” |

For a three-minute demonstration, give the pressure replay an extra 30 seconds. Show the 101.3 to 96.3 kPa drop, exercise overlap, missing telemetry and separate recovery; then reload the Lunar check-in offline to show persistence. Spend the final 30 seconds opening both NASA archives and pointing out the sample windows. If the archive is unavailable, use the labeled captures in the [competition handoff](../docs/competition-release.md#verification-and-reproduction). The 90-second and three-minute timings are rehearsal formats. Check the actual portal for the required media format and duration.

Use the [onboard demo instructions](START_HERE.md) to show local Python assessment during an Earth link outage. The [production site](https://acha.tr/) is on an earlier build. Verify the candidate URL and files before submission.
