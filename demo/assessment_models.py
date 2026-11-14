from datetime import timezone
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator

Code = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$")]
NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Minutes = Annotated[int, Field(strict=True, ge=1, le=5256000)]
Reading = Annotated[FiniteFloat, Field(strict=True, ge=-1e12, le=1e12)]
Metric = Literal["heart_rate", "pulse_rate", "respiratory_rate", "spo2",
                 "systolic_bp", "diastolic_bp", "temperature"]
Status = Literal["urgent", "review", "insufficient_data", "no_flags"]
UNITS = {"heart_rate": "bpm", "pulse_rate": "bpm", "respiratory_rate": "breaths/min",
         "spo2": "%", "systolic_bp": "mmHg", "diastolic_bp": "mmHg", "temperature": "C"}


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Measurement(Schema):
    value: Reading
    measured_at: AwareDatetime
    unit: str | None = None
    quality: Literal["accepted", "suspect"] = "accepted"

    @model_validator(mode="after")
    def normalize_timestamp(self):
        self.measured_at = self.measured_at.astimezone(timezone.utc)
        return self


class MeasurementFailure(Schema):
    measured_at: AwareDatetime
    reason: Literal["equipment_unavailable", "unable_to_obtain"]
