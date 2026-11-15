from dataclasses import dataclass
from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from .observation_context import ReadingContext
from .observation_registry import PARAMETERS
from .observations import Activity
from .schemas import ApiModel, Code, Name, Reading, Timestamp

NASA_STANDARD = "NASA-STD-3001 Vol. 1 Rev. C"
NASA_STANDARD_SOURCE = "https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf"
REFERENCE_VERSION = "nasa-3001-vol-1-rev-c-v1"

Comparator = Literal["minimum_inclusive", "maximum_inclusive", "maximum_exclusive"]


@dataclass(frozen=True)
class ReferenceRule:
    title: str
    requirement: str
    parameter: str
    comparator: Comparator
    limit: float
    unit: str
    required_evidence: str
    tissue: str | None = None
    body_sites: tuple[str, ...] = ()


REFERENCES = {
    "aerobic_capacity": ReferenceRule(
        "In-mission aerobic capacity", "V1 4003", "vo2_peak", "minimum_inclusive", 80, "% of preflight",
        "Use an approved direct or indirect aerobic-capacity protocol for both measurements.",
    ),
    "skeletal_strength": ReferenceRule(
        "In-mission skeletal muscle strength", "V1 4024", "skeletal_strength", "minimum_inclusive", 80, "% of preflight",
        "Use the approved strength test at the same site and protocol for both measurements.",
    ),
    "bmd_total_hip": ReferenceRule(
        "Total hip bone density", "V1 4027", "bone_mineral_density", "minimum_inclusive", 95, "% of preflight",
        "Use matched site-specific measurements from the approved bone-density protocol.",
        body_sites=("total_hip_left", "total_hip_right"),
    ),
    "bmd_lumbar_spine": ReferenceRule(
        "Lumbar spine bone density", "V1 4027", "bone_mineral_density", "minimum_inclusive", 95, "% of preflight",
        "Use matched L1–L4 measurements from the approved bone-density protocol.",
        body_sites=("lumbar_spine_l1_l4",),
    ),
    "bmd_femoral_neck": ReferenceRule(
        "Femoral neck bone density", "V1 4027", "bone_mineral_density", "minimum_inclusive", 90, "% of preflight",
        "Use matched femoral-neck measurements from the approved bone-density protocol.",
        body_sites=("femoral_neck_left", "femoral_neck_right"),
    ),
    "career_effective_dose": ReferenceRule(
        "Career spaceflight effective dose", "V1 4030", "nasa_career_effective_dose", "maximum_exclusive", 600, "mSv",
        "Use NASA Q with the 35-year-old female reference convention, all past spaceflight exposures and the upcoming "
        "mission projection. Exclude medical and biomedical research exposures from this limit calculation.",
    ),
    "lens_30d": ReferenceRule(
        "Lens dose over 30 days", "Table 4.8-1", "organ_gray_equivalent_30d", "maximum_inclusive", 1000, "mGy-Eq",
        "Use a reviewed lens gray-equivalent result with the documented non-cancer RBE convention.", tissue="lens",
    ),
    "skin_30d": ReferenceRule(
        "Skin dose over 30 days", "Table 4.8-1", "organ_gray_equivalent_30d", "maximum_inclusive", 1500, "mGy-Eq",
        "Use a reviewed skin gray-equivalent result with the documented non-cancer RBE convention.", tissue="skin",
    ),
    "blood_forming_organs_30d": ReferenceRule(
        "Blood-forming organs over 30 days", "Table 4.8-1", "organ_gray_equivalent_30d", "maximum_inclusive", 250, "mGy-Eq",
        "Use a reviewed blood-forming organ gray-equivalent result.", tissue="blood_forming_organs",
    ),
    "circulatory_system_30d": ReferenceRule(
        "Circulatory system over 30 days", "Table 4.8-1", "organ_gray_equivalent_30d", "maximum_inclusive", 250, "mGy-Eq",
        "Use the reviewed gray equivalent averaged over the heart muscle and adjacent arteries.", tissue="circulatory_system",
    ),
    "hippocampus_30d": ReferenceRule(
        "Hippocampal dose over 30 days", "Table 4.8-1", "hippocampal_absorbed_30d", "maximum_inclusive", 500, "mGy",
        "Use a reviewed absorbed-dose result at the hippocampus.", tissue="hippocampus",
    ),
}


class Approval(ApiModel):
    authority: Name
    reference: Name


class ReviewBinding(ApiModel):
    rule_id: Code
    max_age_minutes: Annotated[int, Field(strict=True, ge=1, le=525_600)]
    procedure_ref: Name


class RatioBinding(ReviewBinding):
    kind: Literal["ratio"]
    protocol: Code
    protocol_version: Code
    body_site: Code | None = None
    baseline_start: Timestamp
    baseline_end: Timestamp

    @model_validator(mode="after")
    def check_rule(self) -> Self:
        rule = REFERENCES.get(self.rule_id)
        if rule is None or rule.comparator != "minimum_inclusive":
            raise ValueError("Select a published preflight comparison.")
        if self.baseline_start >= self.baseline_end:
            raise ValueError("The approved preflight date range must be chronological.")
        if rule.body_sites and self.body_site not in rule.body_sites:
            raise ValueError("The anatomical site must match the published requirement.")
        if self.rule_id == "skeletal_strength" and self.body_site is None:
            raise ValueError("The strength protocol requires an anatomical site.")
        return self


class RadiationBinding(ReviewBinding):
    kind: Literal["radiation"]
    model: Name
    model_version: Name

    @model_validator(mode="after")
    def check_rule(self) -> Self:
        rule = REFERENCES.get(self.rule_id)
        if rule is None or rule.comparator == "minimum_inclusive":
            raise ValueError("Select a published dosimetry comparison.")
        return self


class VitalBinding(ReviewBinding):
    kind: Literal["vital"]
    parameter: Literal["heart_rate", "spo2", "respiratory_rate", "systolic_bp", "diastolic_bp", "core_temperature"]
    source_ref: Name
    device: Name
    calibration: Name
    location: Code
    activity: Activity
    conditions: ReadingContext
    lower: Reading | None = None
    upper: Reading | None = None
    consecutive: Annotated[int, Field(strict=True, ge=1, le=20)]
    maximum_gap_seconds: Annotated[int, Field(strict=True, ge=1, le=86_400)]

    @model_validator(mode="after")
    def check_rule(self) -> Self:
        if not self.rule_id.startswith("vital-"):
            raise ValueError("Use a vital- identifier for mission-defined thresholds.")
        if self.lower is None and self.upper is None:
            raise ValueError("Provide a documented lower or upper threshold.")
        if self.lower is not None and self.upper is not None and self.lower >= self.upper:
            raise ValueError("The lower threshold must be below the upper threshold.")
        parameter = PARAMETERS[self.parameter]
        for boundary in (self.lower, self.upper):
            if boundary is not None and ((parameter.minimum is not None and boundary < parameter.minimum)
                                        or (parameter.maximum is not None and boundary > parameter.maximum)
                                        or abs(boundary) > 1e12):
                raise ValueError("A threshold lies outside the parameter input domain.")
        return self


Binding = Annotated[RatioBinding | RadiationBinding | VitalBinding, Field(discriminator="kind")]


class ReviewPolicy(ApiModel):
    version: Code
    reference_version: Literal["nasa-3001-vol-1-rev-c-v1"] = REFERENCE_VERSION
    flight_medicine: Approval | None = None
    radiation_safety: Approval | None = None
    rules: Annotated[list[Binding], Field(min_length=1, max_length=40)]

    @model_validator(mode="after")
    def check_authorities(self) -> Self:
        if len({binding.rule_id for binding in self.rules}) != len(self.rules):
            raise ValueError("Each rule must appear once per policy version.")
        if any(not isinstance(binding, RadiationBinding) for binding in self.rules) and self.flight_medicine is None:
            raise ValueError("Record the flight-medicine authorization for clinical rules.")
        if any(isinstance(binding, RadiationBinding) for binding in self.rules) and self.radiation_safety is None:
            raise ValueError("Record the radiation-safety authorization for dosimetry rules.")
        return self
