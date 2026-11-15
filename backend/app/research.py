import csv
import logging
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
logger = logging.getLogger(__name__)
RECORD = Path(__file__).resolve().parents[2] / "demo" / "bidmc_01_Numerics.csv"
SOURCE = "https://physionet.org/content/bidmc/1.0.0/"
DOWNLOAD = "https://physionet.org/files/bidmc/1.0.0/bidmc_csv/bidmc_01_Numerics.csv"
METRICS = {"heart_rate": "HR", "pulse_rate": "PULSE", "respiratory_rate": "RESP", "spo2": "SpO2"}

RR6_SOURCE = "https://osdr.nasa.gov/bio/repo/data/payloads/RR-6"
RR6_START = "2017-12-15T00:00:00Z"
RR6_END = "2017-12-16T00:00:00Z"
RR6_WEEK_END = "2017-12-22T00:00:00Z"
RR6_DOWNLOAD = "https://visualization.osdr.nasa.gov/eda/api/missions/RR-6/telemetry_data/?" + urlencode(
    {"start": RR6_START, "end": RR6_END, "format": "json"}
)
RR6_WEEK_DOWNLOAD = RR6_DOWNLOAD.replace("2017-12-16", "2017-12-22")


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
RADLAB_DAILY_DOWNLOAD = RADLAB_DOWNLOAD.replace("T23%3A00", "T00%3A00").replace("T01%3A05", "T00%3A00")


@router.get("/research/nasa-dostel1")
def dostel_record(window: Literal["sample", "day"] = "sample") -> dict:
    daily = window == "day"
    download = RADLAB_DAILY_DOWNLOAD if daily else RADLAB_DOWNLOAD
    since = datetime(2022, 4, 1, 0 if daily else 23)
    until = datetime(2022, 4, 2, 0) if daily else datetime(2022, 4, 2, 1, 5)
    try:
        with urlopen(download, timeout=6) as response:
            data = response.read(160_001)
        if len(data) > 160_000:
            raise ValueError("Unexpected RadLab file size.")
        rows = csv.DictReader(StringIO(data.decode("utf-8"), newline=""))
        if rows.fieldnames != ["timestamp", "instrument_id", "absorbed_dose_rate", "dose_equivalent_rate"]:
            raise ValueError("Unexpected RadLab header.")
        by_time = {}
        conflicting = set()
        duplicates = 0
        for row in rows:
            stamp = datetime.strptime(row["timestamp"], "%Y-%m-%dT%H:%M:%S")
            if row["instrument_id"] != "DosTel1" or not since <= stamp < until:
                raise ValueError("Unexpected RadLab instrument or timestamp.")
            sample = {"timestamp": row["timestamp"]}
            for key in ("absorbed_dose_rate", "dose_equivalent_rate"):
                value = float(row[key]) if row[key] != "" else None
                if value is not None and (not isfinite(value) or value < 0):
                    raise ValueError("Invalid RadLab rate.")
                sample[key] = value
            previous = by_time.get(stamp)
            if previous is None:
                by_time[stamp] = sample
            elif previous != sample:
                conflicting.add(stamp)
            else:
                duplicates += 1
        samples = [item if stamp not in conflicting else {
            **item, "absorbed_dose_rate": None, "dose_equivalent_rate": None,
        } for stamp, item in sorted(by_time.items())]
        if not samples or len(conflicting) == len(samples):
            raise ValueError("Empty RadLab response.")
        return {"dataset_id": "DosTel1", "provenance": "SPACE_AGENCY_REAL", "source": RADLAB_SOURCE,
                "download": download, "samples": samples, "identical_duplicates": duplicates,
                "conflicting_timestamps": len(conflicting)}
    except (OSError, ValueError, TypeError, csv.Error) as exc:
        logger.warning("RadLab DosTel1 archive failed for window %s (%s)", window, type(exc).__name__)
        raise HTTPException(502, "RadLab DosTel1 observations are currently unavailable.") from exc


@router.get("/research/nasa-rr6-iss")
def iss_rr6_record(window: Literal["day", "week"] = "day") -> IssResearchRecord:
    # Use a fixed window and host. Keep ground observations and milestones out of the ISS series.
    download, end = (RR6_WEEK_DOWNLOAD, RR6_WEEK_END) if window == "week" else (RR6_DOWNLOAD, RR6_END)
    try:
        with urlopen(download, timeout=6 if window == "week" else 4) as response:
            data = response.read(600_001)
        if len(data) > 600_000:
            raise ValueError("NASA response exceeded the expected size.")
        samples = ISS_SAMPLES.validate_json(data, strict=True, extra="ignore")
        samples.sort(key=lambda sample: sample.recorded_at)
        record = IssResearchRecord(download=download, since=RR6_START, until=end, samples=samples)
        times = [sample.recorded_at for sample in samples]
        if not times or len(times) != len(set(times)) or times[0] < record.since or times[-1] > record.until:
            raise ValueError("NASA response had an unexpected observation timeline.")
        return record
    except (OSError, ValueError) as exc:
        logger.warning("NASA RR-6 archive failed for window %s (%s)", window, type(exc).__name__)
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
