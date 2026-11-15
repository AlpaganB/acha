from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from .schemas import ApiModel, Code, Name, Reading, Timestamp

Nonnegative = Annotated[Reading, Field(ge=0, le=1e12)]


class RadiationContext(ApiModel):
    kind: Literal["radiation"] = "radiation"
    source_ref: Name
    geometry_ref: Name
    shielding_ref: Name
    particle_class: Name


class DoseEstimateContext(ApiModel):
    kind: Literal["dose_estimate"]
    source_ref: Name
    model_version: Name
    tissue: Name | None = None


class RadiationAssessment(ApiModel):
    kind: Literal["radiation_assessment"]
    basis: Literal["nasa_career_effective", "organ_gray_equivalent", "hippocampal_absorbed", "lifetime_cancer_risk"]
    model: Name
    model_version: Name
    source_ref: Name
    input_manifest_ref: Name
    review_ref: Name
    exposure_start: Timestamp
    exposure_end: Timestamp
    lower: Nonnegative
    upper: Nonnegative
    interval_description: Name
    tissue: Literal["lens", "skin", "blood_forming_organs", "circulatory_system", "hippocampus"] | None = None
    complete_history: bool = False
    includes_mission_projection: bool = False
    excludes_medical_exposure: bool = False

    @model_validator(mode="after")
    def check_interval(self) -> Self:
        if self.exposure_end <= self.exposure_start or self.lower > self.upper:
            raise ValueError("Provide chronological exposure dates and ordered uncertainty bounds.")
        return self


class SleepEpisode(ApiModel):
    kind: Literal["sleep_episode"]
    method: Literal["self_report", "actigraphy", "polysomnography"]
    attempted_sleep_at: Timestamp
    sleep_onset_at: Timestamp
    final_wake_at: Timestamp
    out_of_bed_at: Timestamp
    awake_after_onset_minutes: Nonnegative
    interruptions: Annotated[int, Field(strict=True, ge=0, le=1440)]
    shift: Code
    utc_offset_minutes: Annotated[int, Field(strict=True, ge=-840, le=840)]
    illuminance_lux: Nonnegative | None = None
    workload: Annotated[Reading, Field(ge=0, le=10)] | None = None

    @model_validator(mode="after")
    def check_episode(self) -> Self:
        if not (self.attempted_sleep_at <= self.sleep_onset_at < self.final_wake_at <= self.out_of_bed_at):
            raise ValueError("The sleep episode timestamps are out of order.")
        if self.time_in_bed_minutes > 1440 or self.sleep_minutes < 0:
            raise ValueError("The sleep episode duration is inconsistent.")
        return self

    @property
    def time_in_bed_minutes(self) -> float:
        return (self.out_of_bed_at - self.attempted_sleep_at).total_seconds() / 60

    @property
    def sleep_minutes(self) -> float:
        return (self.final_wake_at - self.sleep_onset_at).total_seconds() / 60 - self.awake_after_onset_minutes


class ProtocolContext(ApiModel):
    kind: Literal["protocol"]
    protocol: Code
    version: Code
    source_ref: Name
    body_site: Name | None = None
    specimen: Name | None = None


class ReadingContext(ApiModel):
    kind: Literal["reading"]
    posture: Literal["unknown", "seated", "supine", "standing", "restrained", "free_floating"]
    timing: Literal["unknown", "resting", "after_exercise", "before_meal", "after_meal"]


class RecordedInterval(ApiModel):
    start: Timestamp
    end: Timestamp

    @model_validator(mode="after")
    def chronological(self) -> Self:
        if self.end <= self.start:
            raise ValueError("The interval end must follow its start.")
        return self

    @property
    def minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60


class ExerciseInterval(RecordedInterval):
    kind: Literal["exercise_interval"]
    mode: Literal["aerobic", "resistance", "mixed", "mobility"]
    intensity: Literal["low", "moderate", "high", "unknown"]


class GravityInterval(RecordedInterval):
    kind: Literal["gravity_interval"]
    regime: Literal["microgravity", "partial_gravity", "one_g", "unknown"]
    source_ref: Name


class PerformanceContext(ApiModel):
    kind: Literal["performance"]
    protocol: Code
    version: Code
    trials: Annotated[int, Field(strict=True, gt=0, le=10000)]
    valid_trials: Annotated[int, Field(strict=True, gt=0, le=10000)]
    shift: Code
    utc_offset_minutes: Annotated[int, Field(strict=True, ge=-840, le=840)]
    illuminance_lux: Nonnegative | None = None
    workload: Annotated[Reading, Field(ge=0, le=10)] | None = None

    @model_validator(mode="after")
    def check_trials(self) -> Self:
        if self.valid_trials > self.trials:
            raise ValueError("Valid trials cannot outnumber attempted trials.")
        return self


ObservationContext = Annotated[
    RadiationContext | DoseEstimateContext | SleepEpisode | ProtocolContext | PerformanceContext
    | ReadingContext | ExerciseInterval | GravityInterval | RadiationAssessment,
    Field(discriminator="kind"),
]

PERSONAL_RATES = {"personal_absorbed_dose_rate": ("mGy", 0.1), "personal_dose_equivalent_rate": ("mSv", None)}
PERSONAL_TOTALS = {"personal_absorbed_dose_total": ("mGy", 0.1), "personal_equivalent_dose_total": ("mSv", None)}
RADIATION_RATES = {"absorbed_dose_rate", "dose_equivalent_rate"} | PERSONAL_RATES.keys()
RADIATION_CHANNELS = RADIATION_RATES | PERSONAL_TOTALS.keys()
RADIATION_ESTIMATES = {"organ_equivalent_dose_estimate", "effective_dose_estimate"}
RADIATION_ASSESSMENTS = {
    "nasa_career_effective_dose": "nasa_career_effective",
    "organ_gray_equivalent_30d": "organ_gray_equivalent",
    "hippocampal_absorbed_30d": "hippocampal_absorbed",
    "radiation_reid": "lifetime_cancer_risk",
    "radiation_reic": "lifetime_cancer_risk",
}
ORGAN_GRAY_EQ_TISSUES = {"lens", "skin", "blood_forming_organs", "circulatory_system"}
SITE_PARAMETERS = {"bone_mineral_density", "intraocular_pressure", "retinal_thickness"}
REQUIRED_PROTOCOL_PARAMETERS = {"vo2_peak", "skeletal_strength", "serum_creatinine", "urine_creatinine",
                                "blood_glucose", "c_reactive_protein", "fev1", "forced_vital_capacity",
                                "exercise_recovery_heart_rate"}
LAB_PARAMETERS = {"urine_specific_gravity", "white_blood_cells", "serum_creatinine", "urine_creatinine",
                  "blood_glucose", "c_reactive_protein"}
PROTOCOL_PARAMETERS = REQUIRED_PROTOCOL_PARAMETERS | SITE_PARAMETERS | LAB_PARAMETERS | {"grip_strength", "resting_hrv_rmssd", "urine_volume"}
REQUIRED_PERFORMANCE_PARAMETERS = {"sustained_attention_lapses", "working_memory_accuracy"}
PERFORMANCE_PARAMETERS = REQUIRED_PERFORMANCE_PARAMETERS | {"reaction_time", "task_accuracy"}
READING_PARAMETERS = {"heart_rate", "spo2", "respiratory_rate", "systolic_bp", "diastolic_bp", "core_temperature", "body_mass"}

CONTEXTS = {
    **dict.fromkeys(RADIATION_CHANNELS, "radiation"),
    **dict.fromkeys(RADIATION_ESTIMATES, "dose_estimate"),
    **dict.fromkeys(RADIATION_ASSESSMENTS, "radiation_assessment"),
    **dict.fromkeys(PROTOCOL_PARAMETERS, "protocol"),
    **dict.fromkeys(PERFORMANCE_PARAMETERS, "performance"),
    **dict.fromkeys(READING_PARAMETERS, "reading"),
    "sleep_episode_minutes": "sleep_episode",
    "exercise_minutes": "exercise_interval",
    "gravity_exposure_minutes": "gravity_interval",
}
