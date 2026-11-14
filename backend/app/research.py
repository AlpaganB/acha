import csv
from io import StringIO
from math import isfinite
from pathlib import Path
from statistics import median
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["Research data"])
RECORD = Path(__file__).resolve().parents[2] / "demo" / "bidmc_01_Numerics.csv"
SOURCE = "https://physionet.org/content/bidmc/1.0.0/"
DOWNLOAD = "https://physionet.org/files/bidmc/1.0.0/bidmc_csv/bidmc_01_Numerics.csv"
METRICS = {"heart_rate": "HR", "pulse_rate": "PULSE", "respiratory_rate": "RESP", "spo2": "SpO2"}


@router.get("/research/bidmc-01")
def bidmc_record(refresh: bool = False) -> dict:
    samples = []
    series = {metric: [] for metric in METRICS}
    if refresh:
        try:
            with urlopen(DOWNLOAD, timeout=4) as response:
                data = response.read(100_001)
            if len(data) > 100_000:
                raise ValueError("PhysioNet response exceeded the expected size.")
            file = StringIO(data.decode("utf-8"), newline="")
        except (OSError, ValueError) as exc:
            raise HTTPException(502, "PhysioNet is currently unavailable.") from exc
    else:
        file = RECORD.open(encoding="utf-8", newline="")
    with file:
        rows = csv.DictReader(file, skipinitialspace=True)
        if rows.fieldnames != ["Time [s]", *METRICS.values()]:
            raise HTTPException(502, "The research file has an unexpected format.")
        for seconds, row in enumerate(rows):
            if row["Time [s]"] != str(seconds):
                raise HTTPException(502, "The research file has an unexpected timeline.")
            sample = {"seconds": seconds}
            for metric, column in METRICS.items():
                try:
                    value = float(row[column])
                except (TypeError, ValueError):
                    value = float("nan")
                sample[metric] = value if isfinite(value) else None
                if sample[metric] is not None:
                    series[metric].append(value)
            samples.append(sample)
    if len(samples) != 481:
        raise HTTPException(502, "The research record is incomplete.")
    return {
        "source": SOURCE,
        "record": "BIDMC 01",
        "retrieval": "physionet" if refresh else "bundled",
        "samples": samples,
        "medians": {metric: median(values) if values else None for metric, values in series.items()},
    }
