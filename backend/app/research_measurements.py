import csv
from functools import lru_cache
from io import StringIO
from math import isfinite
from typing import Annotated, Literal
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(tags=["Research data"])
BIDMC_SOURCE = "https://physionet.org/content/bidmc/1.0.0/"
SIGNALS = "https://physionet.org/files/bidmc/1.0.0/bidmc_csv/bidmc_01_Signals.csv"
SIGNAL_HEADER = "https://physionet.org/files/bidmc/1.0.0/bidmc01.hea"
SIGNAL_RATE = 125
SIGNAL_NAMES = ("II", "PLETH", "RESP")
SIGNAL_COLUMNS = ("Time [s]", "RESP", "PLETH", "V", "AVR", "II")
SIGNAL_UNITS = {"II": "mV", "PLETH": "NU", "RESP": "pm"}

OSDR = "https://osdr.nasa.gov"
ASSAYS = {
    "OSD-575": "LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv",
    "OSD-656": "LSDS-64_Multiplex_urine.immune.AlamarPanel_TRANSFORMED.csv",
}
SERUM_COLUMNS = {
    "albumin_value_gram_per_deciliter": ("Albumin", "g/dL"),
    "albumin_to_globulin_ratio_value": ("Albumin to globulin ratio", "ratio"),
    "alkaline_phosphatase_value_units_per_liter": ("Alkaline phosphatase", "U/L"),
    "alt_value_units_per_liter": ("ALT", "U/L"),
    "ast_value_units_per_liter": ("AST", "U/L"),
    "total_bilirubin_value_milligram_per_deciliter": ("Total bilirubin", "mg/dL"),
    "bun_to_creatinine_ratio_value": ("Urea nitrogen to creatinine ratio", "ratio"),
    "calcium_value_milligram_per_deciliter": ("Calcium", "mg/dL"),
    "carbon_dioxide_value_millimol_per_liter": ("Carbon dioxide", "mmol/L"),
    "chloride_value_millimol_per_liter": ("Chloride", "mmol/L"),
    "creatinine_value_milligram_per_deciliter": ("Creatinine", "mg/dL"),
    "egfr_african_american_value_milliliter_per_minute_per_1.73_meter_squared":
        ("eGFR, source African American calculation", "mL/min/1.73 m²"),
    "egfr_non_african_american_value_milliliter_per_minute_per_1.73_meter_squared":
        ("eGFR, source non-African American calculation", "mL/min/1.73 m²"),
    "globulin_value_gram_per_deciliter": ("Globulin", "g/dL"),
    "glucose_value_milligram_per_deciliter": ("Glucose", "mg/dL"),
    "potassium_value_millimol_per_liter": ("Potassium", "mmol/L"),
    "sodium_value_millimol_per_liter": ("Sodium", "mmol/L"),
    "total_protein_value_gram_per_deciliter": ("Total protein", "g/dL"),
    "urea_nitrogen_bun_value_milligram_per_deciliter": ("Urea nitrogen", "mg/dL"),
}


def csv_text(url: str, limit: int) -> StringIO:
    with urlopen(url, timeout=12) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Research file exceeded its expected size.")
    return StringIO(data.decode("utf-8-sig"), newline="")


def numeric_cell(value: str) -> float | None:
    try:
        number = float(value)
    except ValueError:
        return None
    return number if isfinite(number) else None


@lru_cache(maxsize=1)
def bidmc_signals() -> tuple[tuple[float | None, ...], ...]:
    with csv_text(SIGNALS, 3_000_000) as file:
        rows = csv.DictReader(file, skipinitialspace=True)
        if rows.fieldnames != list(SIGNAL_COLUMNS):
            raise ValueError("Unexpected BIDMC waveform header.")
        values = []
        for index, row in enumerate(rows):
            if None in row or None in row.values():
                raise ValueError("Unexpected BIDMC waveform timing or columns.")
            timestamp = numeric_cell(row["Time [s]"])
            # The source rounds later timestamps to hundredths. WFDB fixes the timeline at 125 Hz.
            if timestamp is None or abs(timestamp - index / SIGNAL_RATE) > 0.005001:
                raise ValueError("Unexpected BIDMC waveform timing or columns.")
            values.append(tuple(numeric_cell(row[name]) for name in SIGNAL_NAMES))
    if len(values) != 60_001:
        raise ValueError("Incomplete BIDMC waveform record.")
    return tuple(values)


@router.get("/research/bidmc-01-waveforms")
def bidmc_waveform_window(start: Annotated[int, Query(ge=0, le=475)] = 0) -> dict:
    try:
        offset = start * SIGNAL_RATE
        rows = bidmc_signals()[offset:offset + 5 * SIGNAL_RATE]
        return {"record": "BIDMC 01", "source": BIDMC_SOURCE, "download": SIGNALS, "header": SIGNAL_HEADER,
                "sample_rate_hz": SIGNAL_RATE, "start_seconds": start,
                "channels": [{"code": name, "unit": SIGNAL_UNITS[name], "values": [row[i] for row in rows]}
                             for i, name in enumerate(SIGNAL_NAMES)]}
    except (OSError, ValueError, csv.Error) as error:
        raise HTTPException(502, "The PhysioNet waveform record is currently unavailable.") from error


def urine_column(header: str) -> tuple[str, str] | None:
    for suffix, unit in (("_concentration_npq", "NPQ"), ("_percent_normalized_value", "%")):
        if header.endswith(suffix):
            return header.removesuffix(suffix).upper(), unit
    return None


@lru_cache(maxsize=2)
def assay_coverage(study: str) -> dict:
    source = f"{OSDR}/bio/repo/data/studies/{study}"
    download = f"{OSDR}/geode-py/ws/studies/{study}/download?source=datamanager&file={ASSAYS[study]}"
    with csv_text(download, 150_000) as file:
        rows = csv.reader(file)
        header = next(rows, [])
        if not header or header[0] != "Sample Name":
            raise ValueError("Unexpected assay file header.")
        labels = [(index, label) for index, key in enumerate(header[1:], 1)
                  if (label := SERUM_COLUMNS.get(key) if study == "OSD-575" else urine_column(key))]
        if not labels or len({label for _, label in labels}) != len(labels):
            raise ValueError("No unambiguous assay fields were found.")
        if study == "OSD-575" and len(labels) != len(SERUM_COLUMNS):
            raise ValueError("One or more expected serum fields are absent.")
        counts = [0] * len(labels)
        row_count = 0
        for row in rows:
            if len(row) != len(header):
                raise ValueError("Unexpected assay row width.")
            row_count += 1
            for position, (index, _) in enumerate(labels):
                if numeric_cell(row[index]) is not None:
                    counts[position] += 1
        if not row_count:
            raise ValueError("The assay file is empty.")
    return {"study": study, "source": source, "download": download, "rows": row_count,
            "specimen": "Serum" if study == "OSD-575" else "Urine",
            "fields": [{"name": name, "unit": unit, "numeric_rows": count, "other_rows": row_count - count}
                       for (_, (name, unit)), count in zip(labels, counts, strict=True)]}


@router.get("/research/osdr-assays/{study}")
def osdr_assay(study: Literal["OSD-575", "OSD-656"]) -> dict:
    try:
        return assay_coverage(study)
    except (OSError, ValueError, csv.Error) as error:
        raise HTTPException(502, "The NASA OSDR assay file is currently unavailable.") from error
