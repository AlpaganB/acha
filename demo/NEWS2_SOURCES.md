# Rule sources and applicability

Reproduced from: Royal College of Physicians. National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS. Updated report of a working party. London: RCP, 2017.

| Implemented behavior | Primary source |
| --- | --- |
| Numeric bands, oxygen weighting and consciousness | [RCP Chart 1](https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf) |
| Single-red, medium and high triggers | [RCP Chart 2](https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf) |
| Population recommendations | [RCP 2017 report](https://www.rcp.ac.uk/media/a4ibkkbf/news2-final-report_0_0.pdf) |
| Scale 2 selection, unclear confusion onset and incomplete observations | [RCP additional implementation guidance, March 2020](https://www.rcp.ac.uk/media/umzn4ntq/news2_additional-guidance-002-_0.pdf) |
| Source index and attribution conditions | [RCP NEWS2 resource page](https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/) |

Reviewed on 2026-11-14. Numeric comparisons use a separately transcribed interval reference. Both implementations were prepared during this development effort. External clinical review remains outstanding. The original charts remain available from RCP.

Scale 2 requires the documented clinician decision and confirmation of hypercapnic respiratory failure specified in the guidance. The backend supplies the authorization reference. The engine cannot verify medical-record authenticity. COPD alone must not select Scale 2.

The prototype supports non-pregnant people aged 16 or older. RCP also notes limitations with some spinal cord injuries. Clinical concern can require escalation independently of the score. Symptom and emergency workflows remain important.

The additional guidance supports documenting incomplete scores and acting on available components. It distinguishes absent equipment from inability to obtain a measurement despite equipment use. ACHA preserves these reasons and exposes partial scores explicitly.

Timing limits, precision rejection, device bounds, profile hashing and mapping to ACHA status values are application decisions with software tests. Operational suitability requires mission review.

NASA's research supports the project's direction. It does not validate this implementation for flight. [NASA overview](https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/)

Pulse oximetry has measurement limitations. Accepted input flags cannot establish sensor accuracy. [FDA guidance](https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters)
