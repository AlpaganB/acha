import csv
from datetime import datetime
from io import StringIO
from math import isfinite
from pathlib import Path
from statistics import median
from typing import Annotated, Literal
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException
from pydantic import Field, FiniteFloat, TypeAdapter

from .schemas import ApiModel, Timestamp

router = APIRouter(tags=["Research data"])
RECORD = Path(__file__).resolve().parents[2] / "demo" / "bidmc_01_Numerics.csv"
SOURCE = "https://physionet.org/content/bidmc/1.0.0/"
DOWNLOAD = "https://physionet.org/files/bidmc/1.0.0/bidmc_csv/bidmc_01_Numerics.csv"
METRICS = {"heart_rate": "HR", "pulse_rate": "PULSE", "respiratory_rate": "RESP", "spo2": "SpO2"}

RR6_SOURCE = "https://osdr.nasa.gov/bio/repo/data/payloads/RR-6"
RR6_START = "2017-12-15T00:00:00Z"
RR6_END = "2017-12-16T00:00:00Z"
RR6_DOWNLOAD = "https://visualization.osdr.nasa.gov/eda/api/missions/RR-6/telemetry_data/?" + urlencode(
    {"start": RR6_START, "end": RR6_END, "format": "json"}
)


class IssSample(ApiModel):
    recorded_at: Timestamp = Field(validation_alias="time")
    temperature_c: FiniteFloat | None = Field(validation_alias="temperature_iss")
    relative_humidity_pct: Annotated[FiniteFloat, Field(ge=0, le=100)] | None = Field(
        validation_alias="humidity_iss"
    )
    carbon_dioxide_ppm: Annotated[FiniteFloat, Field(ge=0)] | None = Field(validation_alias="co2_iss")


ISS_SAMPLES = TypeAdapter(list[IssSample])


class IssResearchRecord(ApiModel):
    dataset_id: Literal["RR-6"] = "RR-6"
    provenance: Literal["NASA_REAL"] = "NASA_REAL"
    source: str = RR6_SOURCE
    download: str = RR6_DOWNLOAD
    since: Timestamp
    until: Timestamp
    samples: list[IssSample]


RADLAB_SOURCE = "https://visualization.osdr.nasa.gov/radlab/gui/knowledgebase/dostel1"
RADLAB_DOWNLOAD = (
    "https://visualization.osdr.nasa.gov/radlab/api/?instrument_id=DosTel1"
    "&timestamp%3E=2022-04-01T23%3A00&timestamp%3C2022-04-02T01%3A05"
    "&absorbed_dose_rate&dose_equivalent_rate&format=csv"
)


@router.get("/research/nasa-dostel1")
def dostel_record() -> dict:
    try:
        with urlopen(RADLAB_DOWNLOAD, timeout=6) as response:
            data = response.read(32_001)
        if len(data) > 32_000:
            raise ValueError("Unexpected RadLab file size.")
        rows = csv.DictReader(StringIO(data.decode("utf-8"), newline=""))
        if rows.fieldnames != ["timestamp", "instrument_id", "absorbed_dose_rate", "dose_equivalent_rate"]:
            raise ValueError("Unexpected RadLab header.")
        samples = []
        seen = set()
        for row in rows:
            stamp = datetime.strptime(row["timestamp"], "%Y-%m-%dT%H:%M:%S")
            if (row["instrument_id"] != "DosTel1" or stamp in seen
                    or not datetime(2022, 4, 1, 23) <= stamp < datetime(2022, 4, 2, 1, 5)):
                raise ValueError("Unexpected RadLab instrument or timestamp.")
            sample = {"timestamp": row["timestamp"]}
            for key in ("absorbed_dose_rate", "dose_equivalent_rate"):
                value = float(row[key]) if row[key] != "" else None
                if value is not None and (not isfinite(value) or value < 0):
                    raise ValueError("Invalid RadLab rate.")
                sample[key] = value
            samples.append(sample)
            seen.add(stamp)
        if not samples:
            raise ValueError("Empty RadLab response.")
        return {"dataset_id": "DosTel1", "provenance": "SPACE_AGENCY_REAL", "source": RADLAB_SOURCE,
                "download": RADLAB_DOWNLOAD, "samples": sorted(samples, key=lambda sample: sample["timestamp"])}
    except (OSError, ValueError, TypeError, csv.Error) as exc:
        raise HTTPException(502, "RadLab DosTel1 observations are currently unavailable.") from exc


@router.get("/research/nasa-rr6-iss")
def iss_rr6_record() -> IssResearchRecord:
    # Use a fixed window and host. Keep ground observations and milestones out of the ISS series.
    try:
        with urlopen(RR6_DOWNLOAD, timeout=4) as response:
            data = response.read(200_001)
        if len(data) > 200_000:
            raise ValueError("NASA response exceeded the expected size.")
        samples = ISS_SAMPLES.validate_json(data, strict=True, extra="ignore")
        samples.sort(key=lambda sample: sample.recorded_at)
        record = IssResearchRecord(since=RR6_START, until=RR6_END, samples=samples)
        times = [sample.recorded_at for sample in samples]
        if not times or len(times) != len(set(times)) or times[0] < record.since or times[-1] > record.until:
            raise ValueError("NASA response had an unexpected observation timeline.")
        return record
    except (OSError, ValueError) as exc:
        raise HTTPException(502, "NASA RR-6 telemetry is currently unavailable.") from exc


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
