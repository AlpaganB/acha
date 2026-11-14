from datetime import UTC
from enum import StrEnum
from typing import Annotated, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    StringConstraints,
    model_validator,
)

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120, pattern=r"^[^\x00]+$")
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000, pattern=r"^[^\x00]+$")
]
Code = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
Timestamp = Annotated[AwareDatetime, AfterValidator(lambda value: value.astimezone(UTC))]
Reading = Annotated[FiniteFloat, Field(strict=True)]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Environment(StrEnum):
    SPACECRAFT = "spacecraft"
    ORBITAL_STATION = "orbital_station"
    LUNAR_HABITAT = "lunar_habitat"
    DEEP_SPACE = "deep_space"


class MeasurementKind(StrEnum):
    HEART_RATE = "heart_rate"
    SPO2 = "spo2"
    BLOOD_PRESSURE = "blood_pressure"
    BODY_TEMPERATURE = "body_temperature"


MEASUREMENT_UNITS = {
    MeasurementKind.HEART_RATE: "bpm",
    MeasurementKind.SPO2: "%",
    MeasurementKind.BLOOD_PRESSURE: "mmHg",
    MeasurementKind.BODY_TEMPERATURE: "°C",
}


class MeasurementSchedule(ApiModel):
    kind: MeasurementKind
    interval_minutes: Annotated[int, Field(strict=True, gt=0, le=525_600)]


class MissionProfileCreate(ApiModel):
    name: Name
    environment: Environment
    equipment: list[Name] = Field(default_factory=list, max_length=50)
    constraints: list[Description] = Field(default_factory=list, max_length=50)
    measurement_schedules: list[MeasurementSchedule] = Field(default_factory=list, max_length=4)
    guidance_protocol_ids: list[Code] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_schedules(self) -> Self:
        if len({schedule.kind for schedule in self.measurement_schedules}) != len(self.measurement_schedules):
            raise ValueError("A measurement kind can have only one schedule.")
        return self


class MissionProfileRead(MissionProfileCreate):
    id: UUID
    created_at: Timestamp


class CrewMissionUpdate(ApiModel):
    mission_profile_id: UUID


class CrewMemberCreate(CrewMissionUpdate):
    display_name: Name


class CrewMemberRead(CrewMemberCreate):
    id: UUID
    created_at: Timestamp


class MeasurementCreate(ApiModel):
    id: UUID
    kind: MeasurementKind
    value: Reading
    diastolic: Reading | None = None
    recorded_at: Timestamp

    @model_validator(mode="after")
    def validate_reading(self) -> Self:
        if self.kind == MeasurementKind.BLOOD_PRESSURE:
            if self.diastolic is None or not 0 < self.diastolic <= self.value:
                raise ValueError("Blood pressure requires 0 < diastolic <= systolic.")
            return self
        if self.diastolic is not None:
            raise ValueError("Diastolic is only allowed for blood pressure.")
        if self.kind == MeasurementKind.SPO2 and not 0 <= self.value <= 100:
            raise ValueError("SpO2 must be a percentage from 0 to 100.")
        if self.kind == MeasurementKind.HEART_RATE and self.value <= 0:
            raise ValueError("Heart rate must be positive.")
        if self.kind == MeasurementKind.BODY_TEMPERATURE and self.value < -273.15:
            raise ValueError("Body temperature cannot be below absolute zero.")
        return self


class MeasurementRead(MeasurementCreate):
    crew_member_id: UUID
    created_at: Timestamp
    unit: str


class Symptom(ApiModel):
    code: Code
    severity: Annotated[int, Field(strict=True, ge=0, le=10)] | None = None


class AssessmentCreate(ApiModel):
    id: UUID
    mission_profile_id: UUID
    assessed_at: Timestamp
    symptoms: list[Symptom] = Field(default_factory=list, max_length=50)
    measurement_ids: list[UUID] = Field(default_factory=list, max_length=50)
    notes: Description | None = None

    @model_validator(mode="after")
    def validate_inputs(self) -> Self:
        if not self.symptoms and not self.measurement_ids:
            raise ValueError("Provide at least one symptom or measurement.")
        if len({symptom.code for symptom in self.symptoms}) != len(self.symptoms):
            raise ValueError("Symptom codes must be unique.")
        if len(set(self.measurement_ids)) != len(self.measurement_ids):
            raise ValueError("Measurement IDs must be unique.")
        self.symptoms.sort(key=lambda symptom: symptom.code)
        self.measurement_ids.sort()
        return self


class AssessmentResult(ApiModel):
    status: Annotated[Code, Field(max_length=32)]
    rationale: Description
    next_step: Description
    protocol_id: Code | None = None

    @model_validator(mode="after")
    def reject_pending_status(self) -> Self:
        if self.status == "pending":
            raise ValueError("Pending is reserved for assessments without a result.")
        return self


class AssessmentRead(AssessmentCreate):
    crew_member_id: UUID
    created_at: Timestamp
    status: str
    rationale: str | None
    next_step: str | None
    protocol_id: str | None
    engine_result: dict | None = None


class HistoryQuery(ApiModel):
    since: Timestamp | None = None
    until: Timestamp | None = None
    limit: Annotated[int, Field(ge=1, le=200)] = 50
    offset: Annotated[int, Field(ge=0)] = 0

    @model_validator(mode="after")
    def validate_window(self) -> Self:
        if self.since is not None and self.until is not None and self.since >= self.until:
            raise ValueError("Since must be earlier than until.")
        return self


class MeasurementHistoryQuery(HistoryQuery):
    kind: MeasurementKind | None = None
