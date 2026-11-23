# Competition evidence and source rights

ACHA was built for the 2026 NASA Space Apps Challenge brief on astronaut health monitoring. The [demo walkthrough](../demo/SUBMISSION.md) shows how to present the connected check-in and the three mission exercises. The [desktop replay](assets/screenshots/lunar-fatigue.png) and [mobile replay](assets/screenshots/lunar-fatigue-mobile.png) were captured from a local build using synthetic data.

## Verification and reproduction

The [local development guide](development.md) covers setup, the frontend and Python suites, and the Chromium smoke test. The [engine verification report](../demo/VALIDATION.md) documents the standalone reference-rule checks, mutation testing and BIDMC replay.

On 23 November 2026, the hosted health endpoint returned HTTP 200. The hosted Research API returned **288 RR-6 cabin observations** for the selected day, **84 DosTel1 readings** for the short archive, and **481 BIDMC observations** for record 01. These were read-only checks of the public service.

The connected API persists inputs and assessment snapshots in PostgreSQL. Browser training keeps its fictional follow-up in local storage and can replay offline after shell installation. The standalone demo runs the Python evaluation locally and uses SQLite. Each mode has its own verification path.

## Provenance and licensing

| Material | Attribution and use |
| --- | --- |
| PhysioNet BIDMC, v1.0.0 | Numerical CSV records 01–10 are redistributed under ODC Attribution 1.0. [Dataset citation, terms and transformations](../demo/DATA_SOURCE.md) |
| PhysioNet Sleep-EDF Expanded, v1.0.0 | Bob Kemp’s Sleep Cassette hypnograms are bundled as derived relative-time annotations under ODC Attribution 1.0. [License](https://physionet.org/content/sleep-edfx/view-license/1.0.0/) · [Import method](health-monitoring.md#sleep-well-being-and-extended-telemetry) |
| PhysioNet QoL_Stress, v1.0.0 | Calvo, Cejudo and Martín Andonegui’s study is represented by derived cohort aggregates under CC BY 4.0. [Dataset](https://doi.org/10.13026/vqtz-pm70) · [License](https://physionet.org/content/qol-stress/view-license/1.0.0/) · [Import method](health-monitoring.md#sleep-well-being-and-extended-telemetry) |
| NASA OSDR | The Research API fetches historical RR-6 and DosTel1 archives on demand and links the original exports. The archives describe ISS conditions and a fixed instrument. [OSDR terms](https://science.nasa.gov/reference/osdr-help-terms-and-conditions/) · [Scientific source registry](health-monitoring.md#scientific-source-registry) |
| Royal College of Physicians NEWS2 | Terrestrial reference arithmetic. [RCP publication and terms](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/) · [Source-to-code notes](../demo/NEWS2_SOURCES.md) |
| Libraries and fonts | Package licenses apply to bundled dependencies. [React](https://github.com/facebook/react/blob/main/LICENSE) · [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) · [Lucide](https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE) · [Geist](https://github.com/vercel/geist-font) · [Instrument Sans](https://github.com/Instrument/instrument-sans) |

The project-wide code license and redistribution permissions for the anatomy illustrations, lunar backdrop and ACHA mark are pending confirmation by the rights holders. That confirmation also applies to screenshots showing those assets. The cited datasets and dependencies retain their own licenses. Confirm the use of contributor names in fictional crew examples before public distribution.
