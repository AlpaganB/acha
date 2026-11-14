from dataclasses import dataclass
from typing import Literal

STANDARD = "https://standards.nasa.gov/node/237"
CREW_HEALTH = "https://www.nasa.gov/reference/nasa-std-3001v1/"
SLEEP = "https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=100"
COGNITION = "https://ntrs.nasa.gov/citations/20240012108"
EVIDENCE = "https://humanresearchroadmap.nasa.gov/evidence/"
RADIATION = "https://visualization.osdr.nasa.gov/radlab/gui/data-api/"


@dataclass(frozen=True)
class Parameter:
    label: str
    category: str
    unit: str
    method: str
    cadence: str
    priority: str
    source: str
    minimum: float | None = 0
    maximum: float | None = None
    scope: str = "crew"
    input_kind: Literal["number", "event"] = "number"


def environment(label: str, unit: str, minimum: float | None = 0, maximum: float | None = None,
                source: str = STANDARD, priority: str = "P0") -> Parameter:
    return Parameter(label, "Atmosphere and operations", unit, "instrument_transcribed", "sensor spot reading",
                     priority, source, minimum, maximum, "environment")


def event(label: str, category: str, *, operations: bool = False) -> Parameter:
    return Parameter(label, category, "", "event_transcribed" if operations else "clinical_transcribed", "event",
                     "P1" if operations else "P2", STANDARD if operations else CREW_HEALTH, None, None,
                     "environment" if operations else "crew", "event")


PARAMETERS = {
    "cabin_pressure": environment("Cabin absolute pressure", "kPa"),
    "suit_pressure": environment("Suit absolute pressure", "kPa", priority="P2"),
    "cabin_ppo2": environment("Cabin oxygen partial pressure", "kPa"),
    "cabin_ppco2": environment("Cabin carbon dioxide partial pressure", "kPa"),
    "suit_ppo2": environment("Suit oxygen partial pressure", "kPa", priority="P2"),
    "suit_ppco2": environment("Suit carbon dioxide partial pressure", "kPa", priority="P2"),
    "ambient_co2": environment("Ambient carbon dioxide concentration", "ppm", 0, 1_000_000),
    "ambient_temperature": environment("Ambient temperature", "°C", -273.15),
    "relative_humidity": environment("Relative humidity", "%", 0, 100),
    "acceleration_magnitude": environment("Acceleration magnitude", "m/s²", priority="P2"),
    "pressure_event": event("Reported pressure transition", "Atmosphere and operations", operations=True),
    "eva_event": event("EVA or prebreathe record", "Atmosphere and operations", operations=True),
    "life_support_event": event("Life support observation", "Atmosphere and operations", operations=True),
    "absorbed_dose_rate": environment("Instrument absorbed dose rate", "µGy/h", source=RADIATION, priority="P1"),
    "dose_equivalent_rate": environment("Instrument dose equivalent rate", "µSv/h", source=RADIATION, priority="P1"),
    "heart_rate": Parameter("Heart rate", "Cardiorespiratory", "bpm", "instrument_transcribed", "spot", "P0", CREW_HEALTH),
    "spo2": Parameter("Blood oxygen saturation", "Cardiorespiratory", "%", "instrument_transcribed", "spot", "P0",
                      CREW_HEALTH, 0, 100),
    "respiratory_rate": Parameter("Respiratory rate", "Cardiorespiratory", "breaths/min", "manual_count", "spot", "P0", CREW_HEALTH),
    "systolic_bp": Parameter("Systolic arterial pressure", "Cardiorespiratory", "mmHg", "instrument_transcribed", "spot", "P0", CREW_HEALTH),
    "diastolic_bp": Parameter("Diastolic arterial pressure", "Cardiorespiratory", "mmHg", "instrument_transcribed", "spot", "P0", CREW_HEALTH),
    "resting_hrv_rmssd": Parameter("Resting heart rate variability (RMSSD)", "Cardiorespiratory", "ms", "instrument_transcribed", "protocol session", "P2", EVIDENCE),
    "end_tidal_co2": Parameter("End-tidal carbon dioxide", "Cardiorespiratory", "kPa", "instrument_transcribed",
                              "protocol session", "P2", CREW_HEALTH),
    "core_temperature": Parameter("Core temperature", "Thermal", "°C", "instrument_transcribed", "spot", "P1", CREW_HEALTH, -273.15),
    "skin_temperature": Parameter("Skin temperature", "Thermal", "°C", "instrument_transcribed", "spot", "P1", CREW_HEALTH, -273.15),
    "sleep_minutes": Parameter("Reported sleep duration", "Sleep", "min", "self_report", "daily", "P1", SLEEP, 0, 1440),
    "sleep_latency_minutes": Parameter("Reported sleep onset latency", "Sleep", "min", "self_report", "daily", "P1", SLEEP, 0, 1440),
    "sleep_interruptions": Parameter("Reported sleep interruptions", "Sleep", "count", "self_report", "daily", "P1", SLEEP),
    "reaction_time": Parameter("Median reaction time", "Cognition", "ms", "protocol_transcribed", "protocol session", "P1", COGNITION),
    "task_accuracy": Parameter("Task accuracy", "Cognition", "%", "protocol_transcribed", "protocol session", "P1", COGNITION, 0, 100),
    "perceived_workload": Parameter("Reported workload", "Well-being", "0–10", "self_report", "daily", "P1", SLEEP, 0, 10),
    "perceived_stress": Parameter("Reported stress", "Well-being", "0–10", "self_report", "daily", "P1", EVIDENCE, 0, 10),
    "reported_mood": Parameter("Reported mood (low to high)", "Well-being", "0–10", "self_report", "daily", "P1", EVIDENCE, 0, 10),
    "headache": Parameter("Reported headache severity", "Symptoms", "0–10", "self_report", "event", "P1", EVIDENCE, 0, 10),
    "ear_fullness": Parameter("Reported ear fullness severity", "Symptoms", "0–10", "self_report", "event", "P1", STANDARD, 0, 10),
    "dizziness": Parameter("Reported dizziness severity", "Symptoms", "0–10", "self_report", "event", "P1", EVIDENCE, 0, 10),
    "nausea": Parameter("Reported nausea severity", "Symptoms", "0–10", "self_report", "event", "P1", EVIDENCE, 0, 10),
    "exercise_minutes": Parameter("Exercise duration", "Performance", "min", "self_report", "session", "P1", EVIDENCE, 0, 1440),
    "grip_strength": Parameter("Grip strength", "Performance", "N", "protocol_transcribed", "protocol session", "P1", EVIDENCE),
    "fluid_intake": Parameter("Reported fluid intake", "Nutrition and renal", "mL", "self_report", "event", "P1", CREW_HEALTH),
    "energy_intake": Parameter("Reported energy intake", "Nutrition and renal", "kcal", "self_report", "event", "P1", CREW_HEALTH),
    "protein_intake": Parameter("Reported protein intake", "Nutrition and renal", "g", "self_report", "event", "P1", CREW_HEALTH),
    "sodium_intake": Parameter("Reported sodium intake", "Nutrition and renal", "mg", "self_report", "event", "P1", CREW_HEALTH),
    "body_mass": Parameter("Body mass", "Nutrition and renal", "kg", "instrument_transcribed", "periodic", "P1", CREW_HEALTH),
    "urine_volume": Parameter("Urine volume", "Nutrition and renal", "mL", "instrument_transcribed", "specimen or timed collection", "P1", EVIDENCE),
    "urine_specific_gravity": Parameter("Urine specific gravity", "Nutrition and renal", "ratio", "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "bone_mineral_density": Parameter("Bone mineral density (site-specific)", "Clinical and laboratory", "g/cm²", "clinical_transcribed", "periodic exam", "P2", EVIDENCE),
    "white_blood_cells": Parameter("White blood cell count", "Clinical and laboratory", "10⁹/L", "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "intraocular_pressure": Parameter("Intraocular pressure", "Clinical and laboratory", "mmHg", "clinical_transcribed", "periodic exam", "P2", EVIDENCE),
    "retinal_thickness": Parameter("Retinal thickness (OCT, site-specific)", "Clinical and laboratory", "µm", "clinical_transcribed", "periodic exam", "P2", EVIDENCE),
    "medical_encounter": event("Medical encounter or examination", "Clinical events"),
    "medical_history": event("Existing condition or injury history", "Clinical events"),
    "allergy_record": event("Allergy record", "Clinical events"),
    "medication_record": event("Medication administration or missed dose", "Clinical events"),
    "adverse_reaction": event("Observed adverse reaction", "Clinical events"),
}
