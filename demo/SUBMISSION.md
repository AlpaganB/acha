# ACHA demo walkthrough

ACHA follows the 2026 NASA Space Apps challenge to gather health indicators, help a crew evaluate them and document what they did next. [Official challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)

## 90-second walkthrough

| Time | Show |
| --- | --- |
| 0–20 s | Open the [Lunar Fatigue checkpoint](https://acha.tr/?scenario=lunar-fatigue&step=3). The crew member reports five hours of sleep. Heart rate is 83 bpm against a 66 bpm training reference. Open **Review evidence** and point out the missing activity and posture context. |
| 20–55 s | Open the fictional check-in. Advance to the resting repeat, record 72 bpm, link it and close the follow-up. The record preserves both readings and documents completion of the workflow. |
| 55–75 s | Switch to **Solar Relay Outage**. Show the vehicle monitor and the separate personal dosimeter, then follow the simulated ground handover from queued to acknowledged. |
| 75–90 s | Open **Research** to show where the historical ISS archives live. RR-6 describes cabin conditions and DosTel1 records a fixed instrument’s dose rates. The crew readings in the replay are fictional. |

## Longer demonstration

- **Connected check-in.** Select a sample crew member, save a measurement, submit an assessment from the saved reading and link a later repeat. The service stores both readings with the assessment and its follow-up.
- **Orbital Pressure.** Scrub through the cabin pressure drop, the missing samples and the recovery. Compare the chart’s measured coverage with the full exercise window.
- **Loss of Earth contact.** Open the [standalone onboard demo](START_HERE.md), run a local check-in and show the simulated ground inbox. The local Python engine evaluates the check-in while the onboard server is running.
- **Research.** Compare the ISS archive views with the terrestrial BIDMC, Sleep-EDF and QoL_Stress views. [Scientific source registry](../docs/health-monitoring.md#scientific-source-registry)

Use synthetic readings when presenting the shared workspace. The exercise documents a research workflow. Mission-specific clinical decisions require separately approved procedures and evidence.
