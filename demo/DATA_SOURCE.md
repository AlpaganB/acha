# BIDMC record attribution

The included CSV files contain records 01 through 10 of BIDMC PPG and Respiration Dataset version 1.0.0. Each has 481 samples, from second 0 through 480 inclusive. Authors are Marco Pimentel, Alistair Johnson, Peter Charlton, and David Clifton. Record 01 is at the package root and records 02 through 10 are under `data/`.

- Dataset DOI https://doi.org/10.13026/C2208R
- Dataset and access terms https://physionet.org/content/bidmc/1.0.0/
- Source CSV https://physionet.org/files/bidmc/1.0.0/bidmc_csv/bidmc_01_Numerics.csv
- License https://opendatacommons.org/licenses/by/1-0/
- Original dataset license notice https://physionet.org/files/bidmc/1.0.0/LICENSE

Original publication is Pimentel, M.A.F. et al., Towards a Robust Estimation of Respiratory Rate from Pulse Oximeters, IEEE Transactions on Biomedical Engineering, 64(8), pp.1914–1923. https://doi.org/10.1109/TBME.2016.2613124

PhysioNet citation is Pollard, T. et al. (2026), PhysioNet as a global platform for biomedical research, Nature Health. https://doi.org/10.1038/s44360-026-00096-z

Retrieved on 2026-11-14 through extraction of published CSV text or the site's rendered data table. For each record the relative second column was checked for exact continuity from 0 through 480. Values and missing-value tokens were retained. Whitespace and line endings were normalized. The JSON report hashes each local file. Byte identity with server downloads has not been established. The public HTML table routes follow `https://physionet.org/content/bidmc/1.0.0/bidmc_csv/bidmc_XX_Numerics.csv`, with XX from 01 through 10. This is a sequential convenience sample from 53 available records.

A direct comparison against the ten original download URLs confirmed that all 4,810 parsed rows match after trimming field whitespace. These files are used for replay and verification. The public React app displays record 01 on its Research page, where users can fetch the original record from PhysioNet and recalculate the medians. Crew records contain measurements entered through the ACHA API. The connected workspace seed adds its own synthetic measurement histories, independently of the BIDMC replay.

Trend replay uses HR and SpO2. It omits non-finite values and reconstructs timestamps using an arbitrary UTC anchor. Additional chart-component checks use PULSE, RESP and SpO2. PULSE and HR retain their distinct meanings. Scale 2 is tested as an arithmetic scenario, without asserting that a recorded patient meets its indication. The records lack the full NEWS2 inputs used by this package, so complete patient NEWS2 scores are not inferred. The patients were receiving hospital care. Clinical outcomes and astronaut validity are outside this evaluation.
